from __future__ import annotations

import json
import hashlib
import math
import os
import sqlite3
import struct
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Iterable
from uuid import uuid4

from fastembed import TextEmbedding

from .models import ExtractionDocument
from .storage import STATE_ROOT


MODEL_NAME = os.getenv("PDF_EMBEDDING_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
MODEL_CACHE = Path(os.getenv("PDF_EMBEDDING_CACHE_DIR", "/opt/pdf-embedding-model"))
INDEX_PATH = Path(os.getenv("PDF_VECTOR_DB", STATE_ROOT / "vectors.sqlite3"))
INDEX_VERSION = 3
_model: TextEmbedding | None = None
_model_lock = Lock()
_index_lock = Lock()


def _embedding_model() -> TextEmbedding:
    global _model
    with _model_lock:
        if _model is None:
            _model = TextEmbedding(model_name=MODEL_NAME, cache_dir=str(MODEL_CACHE))
        return _model


def _embed(texts: Iterable[str]) -> list[list[float]]:
    return [vector.tolist() for vector in _embedding_model().embed(list(texts))]


def _pack(vector: list[float]) -> bytes:
    return struct.pack(f"<{len(vector)}f", *vector)


def _unpack(value: bytes) -> tuple[float, ...]:
    return struct.unpack(f"<{len(value) // 4}f", value)


def _connect(path: Path | None = None) -> sqlite3.Connection:
    path = path or INDEX_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    version = int(connection.execute("PRAGMA user_version").fetchone()[0])
    if version != INDEX_VERSION:
        connection.executescript("DROP TABLE IF EXISTS chunks; DROP TABLE IF EXISTS documents; DROP TABLE IF EXISTS retrieval_audit;")
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS documents (
            document_id TEXT PRIMARY KEY,
            fingerprint TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chunks (
            chunk_id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            profile TEXT NOT NULL,
            page INTEGER NOT NULL,
            text TEXT NOT NULL,
            metadata TEXT NOT NULL,
            embedding BLOB NOT NULL,
            FOREIGN KEY(document_id) REFERENCES documents(document_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS chunks_document ON chunks(document_id);
        CREATE INDEX IF NOT EXISTS chunks_profile ON chunks(profile);
        CREATE TABLE IF NOT EXISTS retrieval_audit (
            event_id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            operation TEXT NOT NULL,
            document_ids TEXT NOT NULL,
            chunk_ids TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS retrieval_audit_timestamp ON retrieval_audit(timestamp);
    """)
    connection.execute(f"PRAGMA user_version={INDEX_VERSION}")
    connection.commit()
    return connection


@contextmanager
def _database(path: Path | None = None):
    connection = _connect(path)
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def index_fingerprint(result: ExtractionDocument, chunks: list[dict[str, Any]]) -> str:
    content = json.dumps(
        {"version": INDEX_VERSION, "model": MODEL_NAME, "documentId": result.documentId, "chunks": chunks},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def index_document(result: ExtractionDocument, chunks: list[dict[str, Any]], path: Path | None = None) -> None:
    with _index_lock:
        texts = [str(chunk["text"]) for chunk in chunks]
        vectors = _embed(texts) if texts else []
        with _database(path) as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("DELETE FROM documents WHERE document_id = ?", (result.documentId,))
            connection.execute(
                "INSERT INTO documents(document_id, fingerprint) VALUES (?, ?)",
                (result.documentId, index_fingerprint(result, chunks)),
            )
            connection.executemany(
                "INSERT INTO chunks(chunk_id, document_id, profile, page, text, metadata, embedding) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [
                    (
                        chunk["chunkId"],
                        result.documentId,
                        result.profile,
                        int(chunk["page"]),
                        text,
                        json.dumps(chunk, ensure_ascii=False),
                        _pack(vector),
                    )
                    for chunk, text, vector in zip(chunks, texts, vectors, strict=True)
                ],
            )


def has_current_index(result: ExtractionDocument, chunks: list[dict[str, Any]]) -> bool:
    with _database() as connection:
        row = connection.execute(
            "SELECT fingerprint FROM documents WHERE document_id = ?",
            (result.documentId,),
        ).fetchone()
    return bool(row and row[0] == index_fingerprint(result, chunks))


def has_document(document_id: str) -> bool:
    with _database() as connection:
        return connection.execute("SELECT 1 FROM documents WHERE document_id = ?", (document_id,)).fetchone() is not None


def record_retrieval(operation: str, document_ids: list[str], chunk_ids: list[str] | None = None) -> None:
    """Record source use without retaining the user's query or extracted text."""
    with _database() as connection:
        connection.execute(
            "INSERT INTO retrieval_audit(event_id, timestamp, operation, document_ids, chunk_ids) VALUES (?, ?, ?, ?, ?)",
            (
                f"pdf-audit-{uuid4().hex}",
                datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                operation,
                json.dumps(document_ids, ensure_ascii=False),
                json.dumps(chunk_ids or [], ensure_ascii=False),
            ),
        )


def list_retrieval_audit(limit: int = 100) -> list[dict[str, Any]]:
    with _database() as connection:
        rows = connection.execute(
            "SELECT event_id, timestamp, operation, document_ids, chunk_ids FROM retrieval_audit ORDER BY timestamp DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [
        {
            "eventId": row[0],
            "timestamp": row[1],
            "operation": row[2],
            "documentIds": json.loads(row[3]),
            "chunkIds": json.loads(row[4]),
        }
        for row in rows
    ]


def search_vectors(query: str, limit: int = 10, document_id: str | None = None, profile: str | None = None, document_ids: list[str] | None = None) -> list[dict[str, Any]]:
    if document_ids is not None and not document_ids:
        return []
    query_vector = _embed([query])[0]
    clauses: list[str] = []
    values: list[Any] = []
    if document_id:
        clauses.append("document_id = ?")
        values.append(document_id)
    if profile:
        clauses.append("profile = ?")
        values.append(profile)
    if document_ids is not None:
        clauses.append(f"document_id IN ({','.join('?' for _ in document_ids)})")
        values.extend(document_ids)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    with _database() as connection:
        rows = connection.execute(f"SELECT metadata, embedding FROM chunks{where}", values).fetchall()
    query_norm = math.sqrt(sum(value * value for value in query_vector)) or 1.0
    hits: list[dict[str, Any]] = []
    for metadata, packed_vector in rows:
        vector = _unpack(packed_vector)
        vector_norm = math.sqrt(sum(value * value for value in vector)) or 1.0
        similarity = sum(left * right for left, right in zip(query_vector, vector, strict=True)) / (query_norm * vector_norm)
        hits.append({**json.loads(metadata), "score": round(float(similarity), 6)})
    hits.sort(key=lambda item: (-item["score"], item["documentId"], item["page"], item["chunkId"]))
    return hits[:max(1, min(limit, 100))]
