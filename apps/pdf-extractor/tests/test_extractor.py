from __future__ import annotations

import asyncio
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import fitz

from pdf_extractor.extractor import _rules_from_text, extract_pdf, file_sha256, utc_now
from pdf_extractor.knowledge import build_knowledge_chunks, build_knowledge_markdown
from pdf_extractor.models import SourceMetadata
from pdf_extractor.retrieval import rank_chunks
from pdf_extractor.service import ApprovalRequest, approve_document, review_status
from pdf_extractor.storage import atomic_write, write_json


class ExtractionProfilesTest(unittest.TestCase):
    def setUp(self) -> None:
        os.environ["PDF_EXTRACTOR_AI_ENABLED"] = "false"
        os.environ["PDF_EXTRACTOR_VISION_ENABLED"] = "false"
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.pdf = self.root / "rules.pdf"
        document = fitz.open()
        page = document.new_page()
        page.insert_text((72, 72), "Forskrift om eksempel\n1. Formaal\n1.1 Dersom tomten er liten, skal tiltaket ha avstand 4 m.\n1.2 Unntak gjelder etter pbl § 20-5.\n1000 m2 BRA 12 0 10")
        document.save(self.pdf)
        document.close()
        self.source = SourceMetadata(kind="provided", filename=self.pdf.name, retrievedAt=utc_now(), sha256=file_sha256(self.pdf))

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def extract(self, profile: str):
        return asyncio.run(extract_pdf(self.pdf, self.root / profile, "pdf-0123456789abcdef", self.source, "http://unavailable", profile))

    def test_generic_preserves_blocks_without_assuming_rules(self):
        result = self.extract("generic")
        self.assertEqual(result.rules, [])
        self.assertTrue(result.pages[0]["blocks"])
        self.assertEqual(result.pages[0]["blocks"][0]["method"], "text-layer")
        self.assertTrue(result.pages[0]["blocks"][0]["fonts"])
        self.assertIn("rawText", result.pages[0]["blocks"][0])
        self.assertFalse(result.quality["reviewRequired"])

    def test_legal_extracts_rules_with_source_evidence(self):
        result = self.extract("legal")
        self.assertGreaterEqual(len(result.rules), 1)
        rule = result.rules[0]
        self.assertEqual(rule.evidence[0].text, rule.text)
        self.assertEqual(rule.evidence[0].page, 1)
        self.assertTrue(rule.evidence[0].bbox)
        self.assertNotIn("1000", {item.ruleId for item in result.rules})
        self.assertTrue(any(item.conditions for item in result.rules))
        self.assertTrue(any(item.exceptions for item in result.rules))
        self.assertTrue(any(item.references for item in result.rules))
        self.assertTrue(result.quality["reviewRequired"])
        self.assertEqual(review_status(result)["status"], "required")

    def test_arealplan_metadata_is_profile_scoped(self):
        result = self.extract("arealplan")
        self.assertIn("arealplan", result.profileData)
        self.assertNotIn("arealplan", self.extract("legal").profileData)

    def test_arealplan_contents_page_keeps_three_column_reading_order(self):
        fixture = Path(__file__).resolve().parents[3] / "data" / "pdf" / "fixtures" / "b65270000.pdf"
        first_page = self.root / "arealplan-contents.pdf"
        source_document = fitz.open(fixture)
        document = fitz.open()
        document.insert_pdf(source_document, from_page=0, to_page=0)
        document.save(first_page)
        document.close()
        source_document.close()
        source = SourceMetadata(kind="provided", filename="b65270000.pdf", retrievedAt=utc_now(), sha256=file_sha256(first_page))

        result = asyncio.run(extract_pdf(first_page, self.root / "contents", "pdf-contents", source, "http://unavailable", "arealplan"))
        page = result.pages[0]
        markdown = build_knowledge_markdown(result)

        self.assertEqual(page["layout"]["estimatedColumns"], 3)
        self.assertEqual(page["layout"]["pageType"], "table-of-contents")
        self.assertTrue(page["layout"]["structurallyAmbiguous"])
        self.assertTrue(page["visionNeeded"])
        self.assertFalse(page["visionAttempted"])
        self.assertEqual(result.document["title"], "BESTEMMELSER OG RETNINGSLINJER")
        self.assertEqual(result.rules, [])
        self.assertTrue(all(block["authority"] == "informative" for block in page["blocks"]))
        self.assertTrue(all(block["readingOrder"] == index for index, block in enumerate(page["blocks"], start=1)))
        self.assertLess(markdown.index("§ 1"), markdown.index("§ 26"))
        self.assertLess(markdown.index("§ 26"), markdown.index("§ 31"))
        self.assertIn("Side 1 · Informasjon", markdown)
        self.assertNotIn("Side 1 · Bindende bestemmelser", markdown)
        self.assertTrue(any("Kompleks sidelayout" in warning for warning in result.quality["warnings"]))
        self.assertIn("§ 1 Formål og virkeområde", markdown)

    def test_arealplan_body_page_uses_geometry_for_authority(self):
        fixture = Path(__file__).resolve().parents[3] / "data" / "pdf" / "fixtures" / "b65270000.pdf"
        document = fitz.open(fixture)
        page = document[2]
        text = page.get_text("text", sort=True)
        blocks = page.get_text("blocks", sort=True)
        from pdf_extractor.extractor import _authority, _block_role, _layout

        layout = _layout(blocks, text, float(page.rect.width), float(page.rect.height))
        self.assertEqual(layout["estimatedColumns"], 2)
        left = next(block for block in blocks if "§ 1 Formål" in str(block[4]))
        right = next(block for block in blocks if "Arealformål i KPA" in str(block[4]))
        header = blocks[0]
        self.assertEqual(_authority(str(left[4]), float(left[0]), float(left[2]), float(page.rect.width), True, "arealplan", "content", "content"), "binding")
        self.assertEqual(_authority(str(right[4]), float(right[0]), float(right[2]), float(page.rect.width), True, "arealplan", "content", "content"), "guidance")
        self.assertEqual(_authority(str(header[4]), float(header[0]), float(header[2]), float(page.rect.width), True, "arealplan", "content", _block_role(header, float(page.rect.height))), "informative")
        self.assertEqual(_authority("Left column Right column", 40, 780, float(page.rect.width), True, "arealplan", "content", "content"), "informative")
        self.assertEqual(_authority("Merged body text " * 30, 40, 780, float(page.rect.width), True, "arealplan", "content", "content"), "unknown")
        document.close()

    def test_layout_detection_is_document_agnostic(self):
        from pdf_extractor.extractor import _layout, _reading_order

        blocks = [
            (40, 20, 560, 45, "Quarterly rules digest", 0, 0),
            (40, 80, 180, 200, "1. First topic\n2. Second topic", 1, 0),
            (220, 80, 360, 200, "3. Third topic\n4. Fourth topic", 2, 0),
            (400, 80, 560, 200, "5. Fifth topic\n6. Sixth topic", 3, 0),
            (40, 760, 560, 780, "Page 1", 4, 0),
        ]
        text = "Quarterly rules digest\nTABLE OF CONTENTS\n1. First topic\n2. Second topic\n3. Third topic\n4. Fourth topic\n5. Fifth topic\n6. Sixth topic"
        layout = _layout(blocks, text, 600, 800)
        ordered = _reading_order([blocks[0], blocks[3], blocks[1], blocks[2], blocks[4]], layout, 800)

        self.assertEqual(layout["estimatedColumns"], 3)
        self.assertEqual(layout["pageType"], "table-of-contents")
        self.assertEqual([item[1][4] for item in ordered[1:4]], [blocks[1][4], blocks[2][4], blocks[3][4]])

    def test_compact_knowledge_omits_forensic_layout_data(self):
        result = self.extract("legal")
        chunks = build_knowledge_chunks(result)
        markdown = build_knowledge_markdown(result, chunks)
        self.assertTrue(chunks)
        self.assertIn("avstand 4 m", markdown)
        self.assertNotIn("bbox", markdown)
        self.assertNotIn("fontSizes", markdown)
        self.assertNotIn("confidence", chunks[0])
        self.assertEqual(chunks[0]["knowledgeStatus"], "review-required")
        self.assertEqual(chunks[0]["page"], 1)

    def test_rule_parser_rejects_amounts_and_bulleted_cross_references(self):
        rules = _rules_from_text(
            "17.3\nParkering\nKravet gjelder alle tiltak.\n-\n§ 21 Handel\n2.000 plasser",
            14,
            [0, 0, 100, 100],
            "binding",
            "text-layer",
            0.98,
        )
        self.assertEqual([rule.ruleId for rule in rules], ["17.3"])
        self.assertIn("Kravet gjelder", rules[0].text)

    def test_deterministic_retrieval_ranks_rules_above_contents(self):
        candidates = [
            {"chunkId": "toc", "documentId": "pdf-a", "page": 1, "pageType": "table-of-contents", "chunkType": "section", "authority": "informative", "text": "§ 17 Parkering", "heading": None, "topics": [], "zoneCodes": []},
            {"chunkId": "rule", "documentId": "pdf-a", "page": 13, "pageType": "content", "chunkType": "rule", "authority": "binding", "text": "17.3 Krav til parkering ved nye tiltak.", "heading": "§ 17.3 Parkering", "topics": ["parkering"], "zoneCodes": ["BY1"]},
            {"chunkId": "other-zone", "documentId": "pdf-a", "page": 14, "pageType": "content", "chunkType": "rule", "authority": "binding", "text": "Parkering i en annen sone.", "heading": "§ 18", "topics": ["parkering"], "zoneCodes": ["Y2"]},
        ]
        hits = rank_chunks(candidates, query="Hva er reglene for parkering?", limit=10)
        self.assertEqual(hits[0]["chunkId"], "rule")
        self.assertLess([hit["chunkId"] for hit in hits].index("rule"), [hit["chunkId"] for hit in hits].index("toc"))
        zone_hits = rank_chunks(candidates, topic="parkering", zone_code="by 1", limit=10)
        self.assertEqual([hit["chunkId"] for hit in zone_hits], ["rule"])

    def test_scanned_legal_page_runs_ocr_text_through_rule_parser(self):
        scanned = self.root / "scanned.pdf"
        document = fitz.open()
        document.new_page()
        document.save(scanned)
        document.close()
        source = SourceMetadata(kind="provided", filename=scanned.name, retrievedAt=utc_now(), sha256=file_sha256(scanned))
        os.environ["PDF_EXTRACTOR_VISION_ENABLED"] = "true"
        try:
            with patch("pdf_extractor.extractor.pytesseract.image_to_string", return_value="2.1 Hvis tiltaket er stort, skal avstanden være 8 m."):
                result = asyncio.run(extract_pdf(scanned, self.root / "scanned", "pdf-scanned", source, "http://127.0.0.1:1", "legal"))
        finally:
            os.environ["PDF_EXTRACTOR_VISION_ENABLED"] = "false"
        self.assertEqual(result.pages[0]["method"], "ocr")
        self.assertEqual(result.rules[0].ruleId, "2.1")
        self.assertEqual(result.rules[0].evidence[0].method, "ocr")
        self.assertTrue(result.rules[0].conditions)
        self.assertTrue(any("Bildeanalyse var nødvendig" in warning for warning in result.quality["warnings"]))

    def test_rotated_page_and_atomic_write(self):
        rotated = self.root / "rotated.pdf"
        document = fitz.open()
        page = document.new_page()
        page.set_rotation(90)
        page.insert_text((72, 72), "3.1 Tiltaket skal dokumenteres.")
        document.save(rotated)
        document.close()
        source = SourceMetadata(kind="provided", filename=rotated.name, retrievedAt=utc_now(), sha256=file_sha256(rotated))
        result = asyncio.run(extract_pdf(rotated, self.root / "rotated", "pdf-rotated", source, "http://unavailable", "legal"))
        self.assertEqual(result.pages[0]["rotation"], 90)
        target = self.root / "atomic" / "result.json"
        atomic_write(target, "first")
        atomic_write(target, "second")
        self.assertEqual(target.read_text(encoding="utf-8"), "second")
        values = [f"value-{index}" for index in range(20)]
        with ThreadPoolExecutor(max_workers=8) as executor:
            list(executor.map(lambda value: atomic_write(target, value), values))
        self.assertIn(target.read_text(encoding="utf-8"), values)
        self.assertEqual(list(target.parent.glob("*.tmp")), [])

    def test_encrypted_and_malformed_pdfs_fail_explicitly(self):
        encrypted = self.root / "encrypted.pdf"
        document = fitz.open()
        document.new_page()
        document.save(encrypted, encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="secret")
        document.close()
        source = SourceMetadata(kind="provided", filename=encrypted.name, retrievedAt=utc_now(), sha256=file_sha256(encrypted))
        with self.assertRaisesRegex(ValueError, "Kryptert"):
            asyncio.run(extract_pdf(encrypted, self.root / "encrypted", "pdf-encrypted", source, "http://unavailable", "legal"))
        malformed = self.root / "malformed.pdf"
        malformed.write_bytes(b"%PDF-this-is-not-valid")
        malformed_source = SourceMetadata(kind="provided", filename=malformed.name, retrievedAt=utc_now(), sha256=file_sha256(malformed))
        with self.assertRaises(Exception):
            asyncio.run(extract_pdf(malformed, self.root / "malformed", "pdf-malformed", malformed_source, "http://unavailable", "generic"))

    def test_model_outage_keeps_rules_and_adds_review_warning(self):
        os.environ["PDF_EXTRACTOR_AI_ENABLED"] = "true"
        os.environ["PDF_EXTRACTOR_AI_TIMEOUT_SECONDS"] = "0.2"
        try:
            result = asyncio.run(extract_pdf(self.pdf, self.root / "outage", "pdf-outage", self.source, "http://127.0.0.1:1", "legal"))
        finally:
            os.environ["PDF_EXTRACTOR_AI_ENABLED"] = "false"
        self.assertTrue(result.rules)
        self.assertTrue(result.quality["requiresHumanReview"])
        self.assertTrue(any("KI-normalisering feilet" in warning for warning in result.quality["warnings"]))

    def test_browser_approval_publishes_reviewed_json(self):
        from pdf_extractor import storage

        state = self.root / "approval-state"
        approved = self.root / "approval-data"
        result = self.extract("legal")
        document = state / "documents" / result.documentId
        write_json(document / "document.json", result.model_dump(mode="json"))
        with patch.object(storage, "STATE_ROOT", state), patch.object(storage, "APPROVED_ROOT", approved):
            response = asyncio.run(approve_document(result.documentId, ApprovalRequest(reviewer="Test Kontrollør", note="Kontrollert mot siden.")))
        published = approved / f"{result.documentId}.json"
        self.assertTrue(published.exists())
        self.assertTrue((approved / f"{result.documentId}.knowledge.md").exists())
        self.assertTrue((approved / f"{result.documentId}.chunks.jsonl").exists())
        self.assertEqual(response["status"], "approved")
        self.assertEqual(response["review"]["reviewer"], "Test Kontrollør")


if __name__ == "__main__":
    unittest.main()
