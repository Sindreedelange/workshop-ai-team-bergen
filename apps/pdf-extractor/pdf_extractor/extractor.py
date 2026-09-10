from __future__ import annotations

import base64
import hashlib
import html
import json
import os
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import fitz
import httpx
import pdfplumber
import pytesseract
from PIL import Image

from . import SCHEMA_VERSION
from .models import Evidence, ExtractionDocument, Measurement, Profile, Rule, SourceMetadata

RULE = re.compile(r"^\s*(?:§\s*)?(\d+(?:[.-]\d+){0,5})[.)]?\s+(.+?)\s*$")
HEADING = re.compile(r"^\s*(?:\d+(?:\.\d+){0,4}\s+)?[^.!?]{3,100}\s*$")
MEASUREMENT = re.compile(r"(?<!\w)(\d+(?:[.,]\d+)?)\s*(m²|m2|m|cm|mm|km|ha|%|dB|timer|dager|år|boenheter|plasser)(?!\w)", re.I)
REFERENCE = re.compile(r"(?:[A-Za-zæøåÆØÅ-]+\s*)?§{1,2}\s*\d+(?:[-.]\d+)*(?:\s*(?:nr\.?|ledd|bokstav)\s*[\w.-]+)?", re.I)
ZONE = re.compile(r"\b(?:S|BY|Y|H\d{3}|#)\s*\d+(?:[_-]\d+)?\b", re.I)
TOPICS = {
    "byggehøyde": ("byggehøyde", "gesims", "møne"), "utnyttelse": ("utnytt", "%‑bra", "bebygd areal"),
    "avstand": ("avstand", "byggegrense", "nabogrense"), "parkering": ("parkering", "parkeringsplass"),
    "plankrav": ("plankrav", "reguleringsplan"), "kulturmiljø": ("kulturmin", "kulturmiljø"),
    "støy": ("støy", "db"), "naturfare": ("flom", "skred", "ras"),
    "plikt": ("skal", "må ", "plikter"), "forbud": ("forbudt", "kan ikke", "må ikke"),
    "unntak": ("unntak", "med mindre", "likevel"),
}


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _clean(text: str) -> str:
    return re.sub(r"[ \t]+", " ", text.replace("\u00ad", "")).strip()


def _block_role(block: tuple[Any, ...], height: float) -> str:
    _, y0, _, y1, *_ = block
    if float(y1) <= height * 0.125:
        return "header"
    if float(y0) >= height * 0.89:
        return "footer"
    return "content"


def _page_type(text: str) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    numbered_entries = sum(1 for line in lines if re.match(r"^(?:§\s*)?\d+(?:[.-]\d+)*[.)]?\s+\S", line))
    contents_headings = {"innhold", "innholdsfortegnelse", "contents", "table of contents"}
    if any(line.casefold() in contents_headings for line in lines) and numbered_entries >= 5:
        return "table-of-contents"
    if any(line.casefold().startswith(("brukerveiledning", "veiledning", "user guide")) for line in lines):
        return "guidance-introduction"
    return "content"


def _column_starts(blocks: list[tuple[Any, ...]], width: float, height: float) -> list[float]:
    starts = sorted(
        float(block[0])
        for block in blocks
        if len(block) >= 5 and str(block[4]).strip() and _block_role(block, height) == "content"
    )
    clusters: list[list[float]] = []
    threshold = width * 0.14
    for start in starts:
        if not clusters or start - sum(clusters[-1]) / len(clusters[-1]) > threshold:
            clusters.append([start])
        else:
            clusters[-1].append(start)
    return [sum(cluster) / len(cluster) for cluster in clusters]


def _has_overlapping_columns(blocks: list[tuple[Any, ...]], width: float, height: float) -> bool:
    content = [block for block in blocks if len(block) >= 5 and str(block[4]).strip() and _block_role(block, height) == "content"]
    for index, first in enumerate(content):
        ax0, ay0, ax1, ay1, *_ = first
        for second in content[index + 1:]:
            bx0, by0, bx1, by1, *_ = second
            horizontal = min(float(ax1), float(bx1)) - max(float(ax0), float(bx0))
            vertical = min(float(ay1), float(by1)) - max(float(ay0), float(by0))
            narrower = min(float(ax1) - float(ax0), float(bx1) - float(bx0))
            shorter = min(float(ay1) - float(ay0), float(by1) - float(by0))
            separated_starts = abs(float(ax0) - float(bx0)) > width * 0.14
            if separated_starts and horizontal > narrower * 0.35 and vertical > shorter * 0.35:
                return True
    return False


def _layout(blocks: list[tuple[Any, ...]], text: str, width: float, height: float) -> dict[str, Any]:
    page_type = _page_type(text)
    starts = _column_starts(blocks, width, height)
    columns = max(1, min(len(starts), 4))
    overlaps = _has_overlapping_columns(blocks, width, height)
    return {
        "estimatedColumns": columns,
        "columnStarts": [round(start, 2) for start in starts],
        "pageType": page_type,
        "structurallyAmbiguous": columns >= 3 or overlaps,
    }


def _reading_order(blocks: list[tuple[Any, ...]], page_layout: dict[str, Any], height: float) -> list[tuple[int, tuple[Any, ...]]]:
    indexed = list(enumerate(blocks))
    if page_layout["estimatedColumns"] < 2:
        return indexed

    column_starts = [float(start) for start in page_layout.get("columnStarts", [])]

    def key(item: tuple[int, tuple[Any, ...]]) -> tuple[float, float, float, float, int]:
        source_index, block = item
        x0, y0, _, _, *_ = block
        role = _block_role(block, height)
        if role == "header":
            return (0, float(y0), float(x0), 0, source_index)
        if role == "footer":
            return (3, float(y0), float(x0), 0, source_index)
        if page_layout["pageType"] == "table-of-contents" and float(y0) >= height * 0.72:
            return (2, float(y0), float(x0), 0, source_index)
        column = min(range(len(column_starts)), key=lambda index: abs(float(x0) - column_starts[index]))
        return (1, column, float(y0), float(x0), source_index)

    return sorted(indexed, key=key)


def _authority(text: str, x0: float, x1: float, width: float, split_columns: bool, profile: Profile, page_type: str, role: str) -> str:
    lowered = text.lower()
    if role != "content" or page_type in {"table-of-contents", "guidance-introduction"}:
        return "informative"
    if profile == "arealplan" and split_columns:
        if x0 < width * 0.61 < x1 and x1 - x0 > width * 0.55:
            return "informative" if len(text) <= 300 and len(text.splitlines()) <= 6 else "unknown"
        return "guidance" if x0 >= width * 0.61 else "binding"
    if profile == "arealplan" and lowered.startswith("retningslinjer"):
        return "guidance"
    if profile == "arealplan" and lowered.startswith("bestemmelser"):
        return "binding"
    if profile == "legal" and any(word in lowered for word in ("skal", "må ", "forbudt", "plikter")):
        return "binding"
    if any(word in lowered for word in ("veiledning", "bakgrunn", "sammendrag", "merknad")):
        return "informative"
    return "unknown"


def _topics(text: str) -> list[str]:
    lowered = text.lower()
    return [topic for topic, needles in TOPICS.items() if any(needle in lowered for needle in needles)]


def _measurements(text: str) -> list[Measurement]:
    return [Measurement(raw=m.group(0), value=float(m.group(1).replace(",", ".")), unit=m.group(2).replace("m2", "m²")) for m in MEASUREMENT.finditer(text)]


def _sentences_matching(text: str, markers: tuple[str, ...]) -> list[str]:
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+|\n+", text) if part.strip()]
    return [sentence for sentence in sentences if any(marker in sentence.lower() for marker in markers)]


def _conditions(text: str) -> list[str]:
    return _sentences_matching(text, ("dersom", "hvis ", "når ", "forutsatt", "på vilkår"))


def _exceptions(text: str) -> list[str]:
    return _sentences_matching(text, ("unntak", "gjelder ikke", "med mindre", "kan fravikes", "likevel"))


def _match_rule(line: str) -> re.Match[str] | None:
    match = RULE.match(line)
    if not match:
        return None
    rule_id = match.group(1)
    # A dotted thousands separator at the start of a table row is an amount,
    # not a numbered clause (for example "2.000 plasser").
    if not line.lstrip().startswith("§") and re.fullmatch(r"\d{1,3}\.\d{3}", rule_id):
        return None
    has_marker = line.lstrip().startswith("§") or "." in rule_id or "-" in rule_id or bool(re.match(r"^\s*\d+[.)]\s", line))
    return match if has_marker else None


def _rules_from_text(raw_text: str, page_number: int, bbox: list[float], authority: str, method: str, confidence: float) -> list[Rule]:
    source_lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    lines: list[str] = []
    index = 0
    while index < len(source_lines):
        line = source_lines[index]
        # PDF text layers often put the clause number and title in separate
        # blocks/lines. Join that general layout before recognising headings.
        if re.fullmatch(r"(?:§\s*)?\d+(?:[.-]\d+){0,5}", line) and index + 1 < len(source_lines):
            next_line = source_lines[index + 1]
            if next_line not in {"-", "•", "–", "—"}:
                lines.append(f"{line} {next_line}")
                index += 2
                continue
        lines.append(line)
        index += 1
    starts = [
        index for index, line in enumerate(lines)
        if _match_rule(line) and (index == 0 or lines[index - 1] not in {"-", "•", "–", "—"})
    ]
    rules: list[Rule] = []
    for position, line_index in enumerate(starts):
        match = _match_rule(lines[line_index])
        if not match:
            continue
        end = starts[position + 1] if position + 1 < len(starts) else len(lines)
        verbatim = "\n".join(lines[line_index:end])
        rule_text = _clean(verbatim)
        rule_id = match.group(1)
        rules.append(Rule(ruleId=rule_id, parentRuleId=re.split(r"[.-]", rule_id)[0] if re.search(r"[.-]", rule_id) else None, title=match.group(2)[:200], authority=authority, text=rule_text, topics=_topics(rule_text), conditions=_conditions(rule_text), exceptions=_exceptions(rule_text), references=sorted(set(REFERENCE.findall(rule_text))), measurements=_measurements(rule_text), confidence=confidence, evidence=[Evidence(page=page_number, bbox=bbox, text=verbatim, method=method)]))
    return rules


def _metadata(all_text: str, pdf_metadata: dict[str, Any], profile: Profile, pages: list[dict[str, Any]]) -> dict[str, Any]:
    lines = [line.strip() for line in all_text.splitlines() if len(line.strip()) > 3]
    title_candidates: list[tuple[float, str]] = []
    if pages:
        for block in pages[0].get("blocks", []):
            if block.get("role") != "content":
                continue
            max_size = max(block.get("fontSizes", [0]) or [0])
            for line in str(block.get("rawText", "")).splitlines():
                candidate = line.strip()
                if not 5 <= len(candidate) <= 200:
                    continue
                letters = [char for char in candidate if char.isalpha()]
                uppercase_bonus = 4 if letters and sum(char.isupper() for char in letters) / len(letters) > 0.8 else 0
                title_candidates.append((float(max_size) + uppercase_bonus, candidate))
    detected_title = max(title_candidates, default=(0, lines[0] if lines else "Ukjent PDF-dokument"), key=lambda item: item[0])[1]
    title = pdf_metadata.get("title") or detected_title
    return {"type": profile, "title": str(title)[:300], "language": "nb" if re.search(r"\b(og|ikke|skal|kommune)\b", all_text.lower()) else None, "pdfMetadata": {k: v for k, v in pdf_metadata.items() if v}}


def _arealplan_data(all_text: str, filename: str) -> dict[str, Any]:
    plan = re.search(r"(?:nasjonal\s+)?arealplan[- ]?id\s*[: ]\s*(?:\d{4}_)?(\d{6,10})", all_text, re.I)
    scale = re.search(r"målestokk\s*[: ]\s*(1\s*:\s*\d+)", all_text, re.I)
    crs = re.search(r"\b(?:UTM\s*\d+|EUREF\s*89|NN2000|EPSG\s*:?\s*\d+)\b", all_text, re.I)
    filename_plan = re.search(r"(\d{8})", filename)
    return {"planId": plan.group(1) if plan else (filename_plan.group(1) if filename_plan else None), "municipality": "Bergen" if "bergen" in all_text.lower() else None, "map": {"scale": re.sub(r"\s", "", scale.group(1)) if scale else None, "coordinateSystem": crs.group(0) if crs else None, "zoneCodes": sorted({m.group(0).replace(" ", "") for m in ZONE.finditer(all_text)}), "geometryExtracted": False}}


def _tesseract_available() -> bool:
    try:
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


async def _ai_enrich(rules: list[Rule], ai_base_url: str, document_id: str, profile: Profile) -> tuple[str | None, list[str]]:
    if not rules or os.getenv("PDF_EXTRACTOR_AI_ENABLED", "true").lower() != "true":
        return None, []
    warnings: list[str] = []
    model: str | None = None
    async with httpx.AsyncClient(timeout=float(os.getenv("PDF_EXTRACTOR_AI_TIMEOUT_SECONDS", "180")), trust_env=False) as client:
        for offset in range(0, len(rules), 20):
            batch = rules[offset:offset + 20]
            try:
                response = await client.post(f"{ai_base_url}/ai/strukturer-dokument", json={"sporingsId": f"pdf-{document_id}", "profil": profile, "blokker": [{"ruleId": r.ruleId, "authority": r.authority, "text": r.text} for r in batch]})
                response.raise_for_status()
                body = response.json()
                model = body.get("modell") or model
                candidates = {str(item.get("ruleId")): item for item in body.get("rules", []) if isinstance(item, dict)}
                for rule in batch:
                    candidate = candidates.get(rule.ruleId)
                    if candidate:
                        rule.aiInterpretation = {k: candidate[k] for k in ("topics", "conditions", "exceptions", "applicability") if k in candidate}
            except Exception as error:
                warnings.append(f"KI-normalisering feilet for blokk {offset + 1}: {error}")
                break
    return model, warnings


async def _vision_page(image_path: Path, ai_base_url: str, document_id: str, page_number: int, profile: Profile) -> tuple[dict[str, Any] | None, str | None]:
    if os.getenv("PDF_EXTRACTOR_VISION_ENABLED", "true").lower() != "true":
        return None, None
    try:
        async with httpx.AsyncClient(timeout=float(os.getenv("PDF_EXTRACTOR_VISION_TIMEOUT_SECONDS", "240")), trust_env=False) as client:
            response = await client.post(f"{ai_base_url}/ai/les-dokumentside", json={"sporingsId": f"pdf-{document_id}", "profil": profile, "side": page_number, "bilde": base64.b64encode(image_path.read_bytes()).decode("ascii")})
            response.raise_for_status()
            return response.json(), None
    except Exception as error:
        return None, f"Lokal bildeanalyse feilet på side {page_number}: {error}"


async def _model_status(ai_base_url: str) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=10, trust_env=False) as client:
            response = await client.get(f"{ai_base_url}/helse")
            response.raise_for_status()
            body = response.json()
            return {"semanticModel": body.get("modell"), "semanticModelAvailable": body.get("modellNaaBar"), "visionModel": body.get("visionModel"), "visionModelAvailable": body.get("visionModelNaaBar")}
    except Exception:
        return {"semanticModel": None, "semanticModelAvailable": False, "visionModel": os.getenv("OLLAMA_VISION_MODEL"), "visionModelAvailable": False}


async def extract_pdf(pdf_path: Path, output_dir: Path, document_id: str, source: SourceMetadata, ai_base_url: str, profile: Profile = "generic") -> ExtractionDocument:
    output_dir.mkdir(parents=True, exist_ok=True)
    pages_dir = output_dir / "pages"
    pages_dir.mkdir(exist_ok=True)
    warnings: list[str] = []
    pages: list[dict[str, Any]] = []
    rules: list[Rule] = []
    sections: list[dict[str, Any]] = []
    unclassified: list[dict[str, Any]] = []
    all_text_parts: list[str] = []
    ambiguous_pages: list[int] = []
    model_status = await _model_status(ai_base_url)
    vision_enabled = os.getenv("PDF_EXTRACTOR_VISION_ENABLED", "true").lower() == "true"
    document = fitz.open(pdf_path)
    if document.needs_pass:
        raise ValueError("Kryptert PDF støttes ikke.")
    with pdfplumber.open(pdf_path) as plumber:
        for index, page in enumerate(document):
            page_number = index + 1
            image_name = f"page-{page_number:04d}.png"
            image_path = pages_dir / image_name
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            pixmap.save(image_path)
            page_text = _clean(page.get_text("text", sort=True))
            raw_blocks = page.get_text("blocks", sort=True)
            page_dictionary = page.get_text("dict", sort=True)
            spans = [span for block in page_dictionary.get("blocks", []) for line in block.get("lines", []) for span in line.get("spans", [])]
            page_layout = _layout(raw_blocks, page_text, float(page.rect.width), float(page.rect.height))
            method = "text-layer"
            vision = None
            needs_ocr = len(page_text) < 40
            needs_vision = needs_ocr or page_layout["structurallyAmbiguous"] or (bool(page.get_images(full=True)) and len(page_text) < 1000) or (len(page.get_drawings()) > 80 and len(raw_blocks) < 8)
            vision_attempted = needs_vision and vision_enabled and bool(model_status["visionModelAvailable"])
            if page_layout["structurallyAmbiguous"]:
                ambiguous_pages.append(page_number)
            if needs_ocr:
                try:
                    page_text = _clean(pytesseract.image_to_string(Image.open(image_path), lang="nor+eng"))
                except Exception as error:
                    warnings.append(f"OCR feilet på side {page_number}: {error}")
                method = "ocr"
            if vision_attempted:
                vision, warning = await _vision_page(image_path, ai_base_url, document_id, page_number, profile)
                if warning:
                    warnings.append(warning)
            split_columns = profile == "arealplan" and page_layout["estimatedColumns"] == 2 and page_layout["pageType"] == "content"
            blocks: list[dict[str, Any]] = []
            for reading_index, (source_index, raw) in enumerate(_reading_order(raw_blocks, page_layout, float(page.rect.height)), start=1):
                x0, y0, x1, y1, text, *_ = raw
                cleaned = _clean(str(text))
                if not cleaned:
                    continue
                role = _block_role(raw, float(page.rect.height))
                authority = _authority(cleaned, float(x0), float(x1), float(page.rect.width), split_columns, profile, page_layout["pageType"], role)
                bbox = [round(float(v), 2) for v in (x0, y0, x1, y1)]
                matching_spans = [span for span in spans if span.get("bbox") and float(span["bbox"][0]) < x1 and float(span["bbox"][2]) > x0 and float(span["bbox"][1]) < y1 and float(span["bbox"][3]) > y0]
                fonts = sorted({str(span.get("font")) for span in matching_spans if span.get("font")})
                sizes = sorted({round(float(span.get("size", 0)), 2) for span in matching_spans if span.get("size")})
                block = {"id": f"p{page_number}-b{source_index + 1}", "bbox": bbox, "text": cleaned, "rawText": str(text), "fonts": fonts, "fontSizes": sizes, "authority": authority, "role": role, "sourceOrder": source_index + 1, "readingOrder": reading_index, "method": method, "confidence": 0.98 if method == "text-layer" else 0.7}
                blocks.append(block)
                lines = [line.strip() for line in str(text).splitlines() if line.strip()]
                if lines and HEADING.match(lines[0]) and len(lines[0]) < 100:
                    sections.append({"id": block["id"], "title": lines[0], "page": page_number, "bbox": block["bbox"]})
                if profile not in {"legal", "arealplan"} and len(cleaned) > 30:
                    unclassified.append({"page": page_number, "blockId": block["id"], "text": cleaned, "reason": "generic-source-block"})
            if not blocks and page_text:
                bbox = [0, 0, round(page.rect.width, 2), round(page.rect.height, 2)]
                block = {"id": f"p{page_number}-ocr", "bbox": bbox, "text": page_text, "rawText": page_text, "fonts": [], "fontSizes": [], "authority": "unknown", "role": "content", "sourceOrder": 1, "readingOrder": 1, "method": method, "confidence": 0.65}
                blocks.append(block)
                if profile not in {"legal", "arealplan"} and len(page_text) > 30:
                    unclassified.append({"page": page_number, "blockId": block["id"], "text": page_text, "reason": "generic-source-block"})
            if profile in {"legal", "arealplan"} and page_layout["pageType"] == "content":
                authority_groups: dict[str, list[dict[str, Any]]] = {}
                for block in blocks:
                    if block["role"] != "content":
                        continue
                    authority_groups.setdefault(block["authority"], []).append(block)
                for authority, authority_blocks in authority_groups.items():
                    raw_text = "\n".join(str(block["rawText"]) for block in authority_blocks)
                    bbox = [
                        min(block["bbox"][0] for block in authority_blocks),
                        min(block["bbox"][1] for block in authority_blocks),
                        max(block["bbox"][2] for block in authority_blocks),
                        max(block["bbox"][3] for block in authority_blocks),
                    ]
                    group_confidence = min(float(block["confidence"]) for block in authority_blocks)
                    rules.extend(_rules_from_text(raw_text, page_number, bbox, authority, method, group_confidence))
            try:
                tables = plumber.pages[index].extract_tables() or []
            except Exception as error:
                tables = []
                warnings.append(f"Tabelluttrekk feilet på side {page_number}: {error}")
            pages.append({"number": page_number, "width": round(page.rect.width, 2), "height": round(page.rect.height, 2), "rotation": page.rotation, "image": f"pages/{image_name}", "method": method, "layout": page_layout, "blocks": blocks, "tables": tables, "visionNeeded": needs_vision, "visionAttempted": vision_attempted, "vision": vision})
            all_text_parts.append(page_text)
    all_text = "\n".join(all_text_parts)
    model, ai_warnings = await _ai_enrich(rules, ai_base_url, document_id, profile)
    warnings.extend(ai_warnings)
    profile_data = {"arealplan": _arealplan_data(all_text, source.filename)} if profile == "arealplan" else {}
    vision_pages = [p["number"] for p in pages if p["visionNeeded"]]
    vision_attempted_pages = [p["number"] for p in pages if p["visionAttempted"]]
    ocr_pages = [p["number"] for p in pages if p["method"] == "ocr"]
    if ambiguous_pages:
        warnings.append(f"Kompleks sidelayout må kontrolleres på sidene {', '.join(map(str, ambiguous_pages))}.")
    if vision_pages and vision_enabled and not model_status["visionModelAvailable"]:
        warnings.append(f"Bildeanalyse var nødvendig på {len(vision_pages)} side(r), men modellen {model_status['visionModel'] or 'ukjent'} er ikke tilgjengelig.")
    review_reasons = []
    if profile in {"legal", "arealplan"}:
        review_reasons.append("Juridiske dokumenter og plandokumenter krever menneskelig kontroll før de blir varig kunnskapsgrunnlag.")
    if ocr_pages:
        review_reasons.append(f"OCR ble brukt på {len(ocr_pages)} side(r).")
    if vision_pages:
        review_reasons.append(f"Bildeanalyse ble vurdert eller brukt på {len(vision_pages)} side(r).")
    if warnings:
        review_reasons.append(f"Uttrekket har {len(warnings)} kvalitetsadvarsel/advarsler.")
    if any(rule.confidence < 0.85 for rule in rules):
        review_reasons.append("Minst én regel har lav uttrekkskonfidens.")
    result = ExtractionDocument(schemaVersion=SCHEMA_VERSION, documentId=document_id, profile=profile, source=source, document=_metadata(all_text, document.metadata, profile, pages), pages=pages, sections=sections, rules=rules, tables=[{"page": p["number"], "rows": t} for p in pages for t in p["tables"]], entities=[], profileData=profile_data, unclassified=unclassified, quality={"warnings": warnings, "pageCount": len(pages), "textCharacters": sum(len(b["text"]) for p in pages for b in p["blocks"]), "ruleCount": len(rules), "semanticModel": model or model_status["semanticModel"], "semanticModelAvailable": model_status["semanticModelAvailable"], "ocrAvailable": _tesseract_available(), "ocrPages": ocr_pages, "visionModel": model_status["visionModel"], "visionModelAvailable": model_status["visionModelAvailable"], "visionRequestedPages": vision_pages, "visionAttemptedPages": vision_attempted_pages, "reviewRequired": bool(review_reasons), "reviewReasons": review_reasons, "requiresHumanReview": bool(review_reasons)})
    document.close()
    return result


def build_review(result: ExtractionDocument) -> str:
    rules_by_page: dict[int, list[Rule]] = {}
    for rule in result.rules:
        rules_by_page.setdefault(rule.evidence[0].page, []).append(rule)
    rows = []
    for page in result.pages:
        items = rules_by_page.get(page["number"], [])
        interpreted = "".join(f'<article class="{html.escape(item.authority)}"><h3>{html.escape(item.ruleId)} · {html.escape(item.authority)}</h3><p>{html.escape(item.text)}</p><small>bbox {html.escape(json.dumps(item.evidence[0].bbox))} · confidence {item.confidence:.2f}</small></article>' for item in items)
        raw = "".join(f'<article><p>{html.escape(block["text"])}</p><small>{block["method"]} · bbox {html.escape(json.dumps(block["bbox"]))}</small></article>' for block in page["blocks"])
        rows.append(f'<section><div><h2>Side {page["number"]}</h2><img src="sider/{page["number"]}.png" alt="Side {page["number"]}"></div><div>{interpreted or raw or "<p>Ingen tekst funnet.</p>"}</div></section>')
    warnings = "".join(f"<li>{html.escape(str(item))}</li>" for item in result.quality.get("warnings", []))
    model = html.escape(str(result.quality.get("visionModel") or "ikke konfigurert"))
    availability = "tilgjengelig" if result.quality.get("visionModelAvailable") else "ikke tilgjengelig"
    document_id_json = json.dumps(result.documentId)
    return f'''<!doctype html><html lang="nb"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>PDF-uttrekk – {html.escape(result.documentId)}</title><style>body{{font:16px system-ui;margin:0;color:#1f2a37}}header{{padding:24px;background:#eef6ff}}section{{display:grid;grid-template-columns:minmax(420px,1fr) 1fr;gap:24px;padding:24px;border-top:1px solid #ccd5df}}img{{width:100%;border:1px solid #9aa8b5}}article{{padding:12px;margin:0 0 12px;border-left:6px solid #777;background:#f7f8fa}}article.binding{{border-color:#9c2c2c}}article.guidance{{border-color:#1769aa}}small{{color:#596674}}.knowledge-links{{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}}.knowledge-links a{{padding:8px 12px;border:1px solid #66809a;border-radius:7px;background:#fff;color:#174d78;text-decoration:none;font-weight:600}}.review{{margin-top:20px;padding:16px;border:2px solid #66809a;border-radius:8px;background:#fff}}.review.required{{border-color:#b56b00;background:#fff7e6}}.review.approved{{border-color:#217a3c;background:#edf9f0}}.badge{{display:inline-block;padding:5px 10px;border-radius:999px;background:#dce8f3;font-weight:700}}.required .badge{{background:#f5cf83}}.approved .badge{{background:#aee0b8}}.review-form{{display:grid;grid-template-columns:minmax(180px,1fr) minmax(260px,2fr) auto;gap:10px;align-items:end;margin-top:14px}}.review-form label{{display:grid;gap:5px;font-weight:600}}input,button{{font:inherit;padding:9px}}button{{cursor:pointer}}@media(max-width:900px){{section{{grid-template-columns:1fr}}.review-form{{grid-template-columns:1fr}}}}</style></head><body><header><h1>{html.escape(str(result.document.get("title")))}</h1><p>Profil: {html.escape(result.profile)} · bildeanalysemodell: {model} ({availability}) · skjema {SCHEMA_VERSION}</p><nav class="knowledge-links" aria-label="Dokumentversjoner"><a href="/dokumenter/{html.escape(result.documentId)}/kunnskap.md">Kompakt kunnskap</a><a href="/dokumenter/{html.escape(result.documentId)}/biter">RAG-biter</a><a href="/dokumenter/{html.escape(result.documentId)}/uttrekk">Detaljert JSON</a></nav><ul>{warnings}</ul><div id="review" class="review"><span id="review-badge" class="badge">Laster godkjenningsstatus…</span><p id="review-message"></p><ul id="review-reasons"></ul><div id="review-form" class="review-form"><label>Kontrollert av<input id="reviewer" required maxlength="120" placeholder="Navn"></label><label>Merknad (valgfritt)<input id="review-note" maxlength="1000" placeholder="Hva ble kontrollert?"></label><button id="approve" type="button">Godkjenn og publiser</button></div><p id="review-result" role="status"></p></div></header>{''.join(rows)}<script>const documentId={document_id_json};const box=document.getElementById("review");const badge=document.getElementById("review-badge");const message=document.getElementById("review-message");const reasons=document.getElementById("review-reasons");const form=document.getElementById("review-form");const result=document.getElementById("review-result");async function refreshReview(){{const response=await fetch(`/dokumenter/${{documentId}}/godkjenning`);const data=await response.json();box.className=`review ${{data.status}}`;badge.textContent=data.status==="approved"?"Godkjent kunnskapsgrunnlag":data.required?"Gjennomgang kreves":"Gjennomgang er valgfri";message.textContent=data.status==="approved"?`Godkjent av ${{data.review.reviewer}} ${{data.review.approvedAt}}. Kunnskapsfilene ligger under data/pdf/approved/.`:data.required?"Dette uttrekket må kontrolleres før det brukes som varig, autoritativ kunnskap.":"Uttrekket kan brukes lokalt som utkast. Godkjenn bare hvis det skal inn i varig kunnskapsgrunnlag.";reasons.replaceChildren(...(data.reasons||[]).map((text)=>{{const li=document.createElement("li");li.textContent=text;return li;}}));form.hidden=data.status==="approved";}}document.getElementById("approve").addEventListener("click",async()=>{{const reviewer=document.getElementById("reviewer").value.trim();if(!reviewer){{result.textContent="Skriv hvem som har kontrollert dokumentet.";return;}}result.textContent="Publiserer…";const response=await fetch(`/dokumenter/${{documentId}}/godkjenning`,{{method:"POST",headers:{{"Content-Type":"application/json"}},body:JSON.stringify({{reviewer,note:document.getElementById("review-note").value}})}});const data=await response.json();result.textContent=response.ok?`Publiserte ${{data.publishedArtifacts.length}} kunnskapsfiler.`:(data.detail||"Godkjenning feilet.");if(response.ok)await refreshReview();}});refreshReview().catch((error)=>{{badge.textContent="Kunne ikke hente godkjenningsstatus";message.textContent=String(error);}});</script></body></html>'''
