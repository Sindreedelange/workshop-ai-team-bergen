from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any
from uuid import uuid4

ROOT = Path(os.getenv("WORKSPACE_ROOT", Path(__file__).resolve().parents[3]))
STATE_ROOT = Path(os.getenv("PDF_EXTRACTOR_STATE_DIR", ROOT / "state" / "pdf-extractor"))


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
    return runtime if runtime.exists() else None


def list_documents() -> list[dict[str, Any]]:
    documents: dict[str, dict[str, Any]] = {}
    runtime_root = STATE_ROOT / "documents"
    if runtime_root.exists():
        for directory in runtime_root.iterdir():
            metadata = directory / "metadata.json"
            if directory.is_dir() and metadata.exists():
                item = read_json(metadata)
                result_path = directory / "document.json"
                documents[directory.name] = {**item, "documentId": directory.name, "status": "extracted" if result_path.exists() else "uploaded"}
    return sorted(documents.values(), key=lambda item: item["documentId"])
