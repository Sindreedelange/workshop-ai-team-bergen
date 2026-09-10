from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any
from uuid import uuid4

from .knowledge import build_knowledge_chunks, build_knowledge_markdown, chunks_jsonl
from .models import ExtractionDocument

ROOT = Path(os.getenv("WORKSPACE_ROOT", Path(__file__).resolve().parents[3]))
STATE_ROOT = Path(os.getenv("PDF_EXTRACTOR_STATE_DIR", ROOT / "state" / "pdf-extractor"))
APPROVED_ROOT = Path(os.getenv("PDF_EXTRACTOR_APPROVED_DIR", ROOT / "data" / "pdf" / "approved"))


def atomic_write(path: Path, data: str | bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{uuid4().hex}.tmp")
    temporary.write_bytes(data) if isinstance(data, bytes) else temporary.write_text(data, encoding="utf-8")
    os.replace(temporary, path)


def document_dir(document_id: str) -> Path:
    if not document_id.startswith("pdf-") or not all(char.isalnum() or char == "-" for char in document_id):
        raise ValueError("Ugyldig dokument-ID.")
    return STATE_ROOT / "documents" / document_id


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    atomic_write(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def find_result(document_id: str) -> Path | None:
    runtime = document_dir(document_id) / "document.json"
    if runtime.exists():
        return runtime
    approved = APPROVED_ROOT / f"{document_id}.json"
    return approved if approved.exists() else None


def list_documents() -> list[dict[str, Any]]:
    documents: dict[str, dict[str, Any]] = {}
    if APPROVED_ROOT.exists():
        for path in APPROVED_ROOT.glob("pdf-*.json"):
            try:
                item = read_json(path)
                documents[item["documentId"]] = {"documentId": item["documentId"], "profile": item.get("profile", "generic"), "status": "approved", "source": item.get("source"), "document": item.get("document")}
            except Exception:
                continue
    runtime_root = STATE_ROOT / "documents"
    if runtime_root.exists():
        for directory in runtime_root.iterdir():
            metadata = directory / "metadata.json"
            if directory.is_dir() and metadata.exists():
                item = read_json(metadata)
                result_path = directory / "document.json"
                review = read_json(result_path).get("review") if result_path.exists() else None
                documents[directory.name] = {**item, "documentId": directory.name, "status": "approved" if review and review.get("status") == "approved" else "extracted" if result_path.exists() else "uploaded", "review": review}
    return sorted(documents.values(), key=lambda item: item["documentId"])


def publish(document_id: str) -> Path:
    source = document_dir(document_id) / "document.json"
    if not source.exists():
        raise FileNotFoundError("Dokumentet har ikke et ferdig uttrekk.")
    result = ExtractionDocument.model_validate(read_json(source))
    target = APPROVED_ROOT / f"{document_id}.json"
    write_json(target, result.model_dump(mode="json"))
    chunks = build_knowledge_chunks(result)
    atomic_write(APPROVED_ROOT / f"{document_id}.knowledge.md", build_knowledge_markdown(result, chunks))
    atomic_write(APPROVED_ROOT / f"{document_id}.chunks.jsonl", chunks_jsonl(chunks))
    return target
