from __future__ import annotations

import json
import re
from collections import defaultdict
from typing import Any

from .models import ExtractionDocument

AUTHORITY_LABELS = {
    "binding": "Bindende bestemmelser",
    "guidance": "Retningslinjer",
    "informative": "Informasjon",
    "unknown": "Dokumentinnhold"
}


def knowledge_status(result: ExtractionDocument) -> str:
    if result.review and result.review.get("status") == "approved":
        return "approved"
    required = result.quality.get("reviewRequired", result.profile in {"legal", "arealplan"} or bool(result.quality.get("warnings")))
    return "review-required" if required else "draft"


def _split_text(text: str, limit: int = 3500, preserve_lines: bool = False) -> list[str]:
    # PDF text layers normally wrap visual lines in the middle of sentences.
    # Blocks remain paragraph boundaries; line wrapping inside a block does not.
    if preserve_lines:
        source_lines = [" ".join(line.split()) for line in text.splitlines() if line.strip()]
        lines: list[str] = []
        index = 0
        while index < len(source_lines):
            line = source_lines[index]
            if re.fullmatch(r"§\s*\d+(?:[.-]\d+)*", line) and index + 1 < len(source_lines) and not source_lines[index + 1].startswith("§"):
                lines.append(f"{line} {source_lines[index + 1]}")
                index += 2
            else:
                lines.append(line)
                index += 1
        chunks: list[str] = []
        current: list[str] = []
        length = 0
        for line in lines:
            if current and length + len(line) + 1 > limit:
                chunks.append("\n".join(current))
                current = []
                length = 0
            current.append(line)
            length += len(line) + 1
        if current:
            chunks.append("\n".join(current))
        return chunks
    else:
        paragraphs = [" ".join(paragraph.split()) for paragraph in text.split("\n\n") if paragraph.strip()]
    chunks: list[str] = []
    current: list[str] = []
    length = 0
    for paragraph in paragraphs:
        if current and length + len(paragraph) + 2 > limit:
            chunks.append("\n\n".join(current))
            current = []
            length = 0
        current.append(paragraph)
        length += len(paragraph) + 2
    if current:
        chunks.append("\n\n".join(current))
    return chunks


def _base_chunk(result: ExtractionDocument, page: int, page_type: str, authority: str, text: str) -> dict[str, Any]:
    return {
        "documentId": result.documentId,
        "profile": result.profile,
        "knowledgeStatus": knowledge_status(result),
        "sourceSha256": result.source.sha256,
        "title": result.document.get("title"),
        "page": page,
        "pageType": page_type,
        "authority": authority,
        "text": text,
    }


def build_knowledge_chunks(result: ExtractionDocument) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    page_types = {int(page["number"]): str(page.get("layout", {}).get("pageType", "content")) for page in result.pages}
    rule_authorities: set[tuple[int, str]] = set()
    rule_ids = {rule.ruleId for rule in result.rules}

    # Legal and planning documents are retrieved by clause. This gives agents a
    # compact answer unit and avoids feeding a whole page for a single rule.
    for rule_index, rule in enumerate(result.rules, start=1):
        if not rule.evidence:
            continue
        heading_text = f"{rule.ruleId} {rule.title or ''}".strip()
        normalized_rule_text = " ".join(rule.text.split()).lstrip("§ ")
        is_heading_only = normalized_rule_text == " ".join(heading_text.split())
        has_children = any(candidate.startswith(f"{rule.ruleId}.") or candidate.startswith(f"{rule.ruleId}-") for candidate in rule_ids)
        if is_heading_only and has_children:
            continue
        page_number = rule.evidence[0].page
        page_type = page_types.get(page_number, "content")
        rule_authorities.add((page_number, rule.authority))
        for part, text in enumerate(_split_text(rule.text), start=1):
            chunks.append({
                **_base_chunk(result, page_number, page_type, rule.authority, text),
                "chunkId": f"{result.documentId}:rule:{rule_index}:{part}",
                "chunkType": "rule",
                "heading": f"§ {rule.ruleId}" + (f" {rule.title}" if rule.title else ""),
                "ruleIds": [rule.ruleId],
            })

    # Preserve informative pages and any content that did not yield clauses.
    # Detailed block coordinates remain in document.json.
    for page in result.pages:
        page_type = str(page.get("layout", {}).get("pageType", "content"))
        groups: dict[str, list[str]] = defaultdict(list)
        for block in page.get("blocks", []):
            if block.get("role") in {"header", "footer"}:
                continue
            text = str(block.get("text", "")).strip()
            if text:
                groups[str(block.get("authority", "unknown"))].append(text)
        for authority in ("binding", "guidance", "informative", "unknown"):
            if (page["number"], authority) in rule_authorities:
                continue
            combined = "\n\n".join(groups.get(authority, []))
            if not combined:
                continue
            for part, text in enumerate(_split_text(combined, preserve_lines=page_type in {"table-of-contents", "guidance-introduction"}), start=1):
                chunks.append({
                    **_base_chunk(result, page["number"], page_type, authority, text),
                    "chunkId": f"{result.documentId}:p{page['number']}:{authority}:{part}",
                    "chunkType": "section",
                    "heading": None,
                    "ruleIds": [],
                })
    return chunks


def build_knowledge_markdown(result: ExtractionDocument, chunks: list[dict[str, Any]] | None = None) -> str:
    chunks = chunks if chunks is not None else build_knowledge_chunks(result)
    plan_id = result.profileData.get("arealplan", {}).get("planId")
    status_labels = {"approved": "godkjent", "review-required": "krever gjennomgang", "draft": "lokalt utkast"}
    lines = [
        f"# {result.document.get('title') or result.source.filename}",
        "",
        f"- Dokument-ID: `{result.documentId}`",
        f"- Profil: `{result.profile}`",
        f"- Kilde: `{result.source.filename}`",
        f"- Kunnskapsstatus: **{status_labels[knowledge_status(result)]}**",
        *([f"- Plan-ID: `{plan_id}`"] if plan_id else []),
        "",
        "> Dette er kompakt, kildebasert kunnskap for oppslag. Bruk document.json og kontrollrapporten for koordinater, konfidens og uttrekkskontroll.",
        ""
    ]
    for chunk in chunks:
        text = chunk["text"]
        if chunk.get("pageType") == "table-of-contents":
            text = text.replace("\n", "  \n")
        heading = chunk.get("heading")
        lines.extend([
            f"## Side {chunk['page']} · {heading or AUTHORITY_LABELS.get(chunk['authority'], chunk['authority'])}",
            "",
            text,
            ""
        ])
    return "\n".join(lines).strip() + "\n"


def chunks_jsonl(chunks: list[dict[str, Any]]) -> str:
    return "".join(json.dumps(chunk, ensure_ascii=False) + "\n" for chunk in chunks)
