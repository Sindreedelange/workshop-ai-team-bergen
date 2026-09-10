from __future__ import annotations

import argparse
import asyncio
import shutil
from pathlib import Path

from .extractor import build_review, extract_pdf, file_sha256, utc_now
from .knowledge import build_knowledge_chunks, build_knowledge_markdown, chunks_jsonl
from .models import SourceMetadata
from .storage import atomic_write, document_dir, read_json, write_json
from .vector_store import index_document


def main() -> None:
    parser = argparse.ArgumentParser(description="Trekk kildeforankret, strukturert informasjon ut av PDF-er.")
    commands = parser.add_subparsers(dest="command", required=True)
    extract = commands.add_parser("extract")
    extract.add_argument("pdf", type=Path)
    extract.add_argument("--source-kind", choices=["provided", "provided-reference", "discovered"], default="provided")
    extract.add_argument("--source-url")
    extract.add_argument("--profile", choices=["generic", "legal", "arealplan"], default="generic")
    args = parser.parse_args()

    pdf = args.pdf.resolve()
    digest = file_sha256(pdf)
    document_id = f"pdf-{digest[:16]}"
    directory = document_dir(document_id)
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / "source.pdf"
    if not target.exists():
        shutil.copy2(pdf, target)
    metadata_path = directory / "metadata.json"
    existing = read_json(metadata_path) if metadata_path.exists() else None
    if existing and Path(pdf) == target and existing.get("source", {}).get("sha256") == digest:
        source = SourceMetadata.model_validate(existing["source"])
    else:
        source = SourceMetadata(kind=args.source_kind, filename=pdf.name, canonicalUrl=args.source_url, retrievedAt=utc_now(), sha256=digest)
    write_json(directory / "metadata.json", {"documentId": document_id, "profile": args.profile, "source": source.model_dump(mode="json"), "uploadedAt": utc_now(), "size": pdf.stat().st_size})
    result = asyncio.run(extract_pdf(target, directory, document_id, source, "http://localhost:8082", args.profile))
    write_json(directory / "document.json", result.model_dump(mode="json"))
    chunks = build_knowledge_chunks(result)
    atomic_write(directory / "knowledge.md", build_knowledge_markdown(result, chunks))
    atomic_write(directory / "chunks.jsonl", chunks_jsonl(chunks))
    index_document(result, chunks)
    atomic_write(directory / "review.html", build_review(result))
    print(document_id)


if __name__ == "__main__":
    main()
