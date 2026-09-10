from __future__ import annotations

import json
import math
import os
import sqlite3
import struct
from contextlib import contextmanager
from pathlib import Path
from threading import Lock
from typing import Any, Iterable

from fastembed import TextEmbedding

from .models import ExtractionDocument
from .storage import STATE_ROOT


MODEL_NAME = os.getenv("PDF_EMBEDDING_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
MODEL_CACHE = Path(os.getenv("PDF_EMBEDDING_CACHE_DIR", "/opt/pdf-embedding-model"))
INDEX_PATH = Path(os.getenv("PDF_VECTOR_DB", STATE_ROOT / "vectors.sqlite3"))
_model: TextEmbedding | None = None
_model_lock = Lock()


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


def _connect() -> sqlite3.Connection:
    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(INDEX_PATH)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS documents (
            document_id TEXT PRIMARY KEY,
            source_sha256 TEXT NOT NULL,
            chunk_count INTEGER NOT NULL
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
    """)
    return connection


@contextmanager
def _database():
    connection = _connect()
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def index_document(result: ExtractionDocument, chunks: list[dict[str, Any]]) -> None:
    texts = [str(chunk["text"]) for chunk in chunks]
    vectors = _embed(texts) if texts else []
    with _database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("DELETE FROM documents WHERE document_id = ?", (result.documentId,))
        connection.execute(
            "INSERT INTO documents(document_id, source_sha256, chunk_count) VALUES (?, ?, ?)",
            (result.documentId, result.source.sha256, len(chunks)),
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


def is_current(result: ExtractionDocument, chunk_count: int) -> bool:
    with _database() as connection:
        row = connection.execute(
            "SELECT source_sha256, chunk_count FROM documents WHERE document_id = ?",
            (result.documentId,),
        ).fetchone()
    return bool(row and row[0] == result.source.sha256 and row[1] == chunk_count)


def search_vectors(query: str, limit: int = 10, document_id: str | None = None, profile: str | None = None) -> list[dict[str, Any]]:
    query_vector = _embed([query])[0]
    clauses: list[str] = []
    values: list[Any] = []
    if document_id:
        clauses.append("document_id = ?")
        values.append(document_id)
    if profile:
        clauses.append("profile = ?")
        values.append(profile)
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
