from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

SourceKind = Literal["provided", "provided-reference", "discovered"]
Profile = Literal["generic", "legal", "arealplan"]
Authority = Literal["binding", "guidance", "informative", "unknown"]
ExtractionMethod = Literal["text-layer", "ocr", "vision"]


class SourceMetadata(BaseModel):
    kind: SourceKind = "provided"
    filename: str
    canonicalUrl: str | None = None
    retrievedAt: str
    sha256: str


class Evidence(BaseModel):
    page: int
    bbox: list[float] = Field(min_length=4, max_length=4)
    text: str
    method: ExtractionMethod


class Measurement(BaseModel):
    raw: str
    value: float | None = None
    unit: str | None = None


class Rule(BaseModel):
    ruleId: str
    parentRuleId: str | None = None
    title: str | None = None
    authority: Authority = "unknown"
    text: str
    topics: list[str] = Field(default_factory=list)
    conditions: list[str] = Field(default_factory=list)
    exceptions: list[str] = Field(default_factory=list)
    references: list[str] = Field(default_factory=list)
    measurements: list[Measurement] = Field(default_factory=list)
    confidence: float = Field(default=0.7, ge=0, le=1)
    evidence: list[Evidence]
    aiInterpretation: dict[str, Any] | None = None


class ExtractionDocument(BaseModel):
    schemaVersion: str = "1.0"
    documentId: str
    profile: Profile = "generic"
    source: SourceMetadata
    document: dict[str, Any]
    pages: list[dict[str, Any]]
    sections: list[dict[str, Any]]
    rules: list[Rule]
    tables: list[dict[str, Any]]
    entities: list[dict[str, Any]]
    profileData: dict[str, Any]
    unclassified: list[dict[str, Any]]
    quality: dict[str, Any]
