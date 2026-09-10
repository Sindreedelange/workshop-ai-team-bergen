from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse
from pydantic import BaseModel, Field

from .extractor import build_review, extract_pdf, file_sha256, utc_now
from .knowledge import build_knowledge_chunks, build_knowledge_markdown, chunks_jsonl
from .models import ExtractionDocument, Profile, SourceKind, SourceMetadata
from .storage import STATE_ROOT, atomic_write, document_dir, find_result, list_documents, read_json, write_json
from .vector_store import MODEL_NAME, has_current_index, has_document, index_document, list_retrieval_audit, record_retrieval, search_vectors


AI_BASE_URL = os.getenv("AI_BASE_URL", "http://ai-gateway:8082")
OPENAPI_FILE = Path(__file__).resolve().parents[3] / "openapi" / "pdf-extractor.yaml"
MAX_BYTES = int(os.getenv("PDF_EXTRACTOR_MAX_UPLOAD_BYTES", str(100 * 1024 * 1024)))
jobs: dict[str, dict[str, Any]] = {}
queue: asyncio.Queue[tuple[str, str]] = asyncio.Queue()
index_repair: dict[str, Any] = {"status": "idle", "pending": 0, "errors": []}


class SearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=2000)
    documentId: str | None = None
    profile: Profile | None = None
    limit: int = Field(default=10, ge=1, le=100)


def knowledge_artifacts(result: ExtractionDocument) -> tuple[str, list[dict[str, Any]]]:
    chunks = build_knowledge_chunks(result)
    return build_knowledge_markdown(result, chunks), chunks


def write_knowledge_artifacts(directory: Path, result: ExtractionDocument) -> tuple[str, list[dict[str, Any]]]:
    markdown, chunks = knowledge_artifacts(result)
    atomic_write(directory / "knowledge.md", markdown)
    atomic_write(directory / "chunks.jsonl", chunks_jsonl(chunks))
    return markdown, chunks


def read_knowledge_artifacts(document_id: str, result_path: Path, result: ExtractionDocument) -> tuple[str, list[dict[str, Any]]]:
    markdown, chunks = knowledge_artifacts(result)
    runtime_directory = document_dir(document_id)
    if result_path == runtime_directory / "document.json":
        # Backfill compact artifacts for extractions made before this layer existed.
        atomic_write(runtime_directory / "knowledge.md", markdown)
        atomic_write(runtime_directory / "chunks.jsonl", chunks_jsonl(chunks))
    return markdown, chunks


async def run_job(job_id: str, document_id: str) -> None:
    job = jobs[job_id]
    job.update(status="running", startedAt=utc_now())
    directory = document_dir(document_id)
    write_json(directory / "job.json", job)
    try:
        metadata = read_json(directory / "metadata.json")
        source = SourceMetadata.model_validate(metadata["source"])
        result = await extract_pdf(directory / "source.pdf", directory, document_id, source, AI_BASE_URL, metadata.get("profile", "generic"))
        write_json(directory / "document.json", result.model_dump(mode="json"))
        _, chunks = write_knowledge_artifacts(directory, result)
        await asyncio.to_thread(index_document, result, chunks)
        atomic_write(directory / "review.html", build_review(result))
        job.update(status="completed", completedAt=utc_now(), warnings=result.quality.get("warnings", []))
    except Exception as error:
        job.update(status="failed", completedAt=utc_now(), error=str(error))
    try:
        write_json(directory / "job.json", job)
    except Exception as error:
        print(f"Kunne ikke lagre jobbstatus: {error}", flush=True)


async def worker() -> None:
    while True:
        job_id, document_id = await queue.get()
        try:
            await run_job(job_id, document_id)
        finally:
            queue.task_done()


async def repair_indexes() -> None:
    documents = [document for document in list_documents() if find_result(document["documentId"])]
    index_repair.update(status="running", pending=len(documents), errors=[])
    for document in documents:
        try:
            result_path = find_result(document["documentId"])
            if not result_path:
                continue
            result = ExtractionDocument.model_validate(read_json(result_path))
            chunks = build_knowledge_chunks(result)
            if not has_current_index(result, chunks):
                await asyncio.to_thread(index_document, result, chunks)
        except Exception as error:
            index_repair["errors"].append({"documentId": document["documentId"], "error": str(error)})
        finally:
            index_repair["pending"] -= 1
    index_repair["status"] = "completed" if not index_repair["errors"] else "completed-with-errors"


@asynccontextmanager
async def lifespan(_: FastAPI):
    STATE_ROOT.mkdir(parents=True, exist_ok=True)
    for document in list_documents():
        path = document_dir(document["documentId"]) / "job.json"
        if not path.exists():
            continue
        job = read_json(path)
        if job.get("status") in {"queued", "running"}:
            job["status"] = "queued"
            jobs[job["jobId"]] = job
            write_json(path, job)
            queue.put_nowait((job["jobId"], document["documentId"]))
    task = asyncio.create_task(worker())
    repair_task = asyncio.create_task(repair_indexes())
    yield
    task.cancel()
    repair_task.cancel()


app = FastAPI(title="PDF extractor", version="0.1.0", lifespan=lifespan, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"])


@app.get("/helse")
async def health():
    return {"status": "ok", "tjeneste": "pdf-extractor", "tidspunkt": utc_now(), "koelengde": queue.qsize(), "indexRepair": index_repair, "profiler": ["generic", "legal", "arealplan"], "embeddingModel": MODEL_NAME, "visionModel": os.getenv("OLLAMA_VISION_MODEL"), "visionEnabled": os.getenv("PDF_EXTRACTOR_VISION_ENABLED", "true").lower() == "true"}


@app.get("/openapi.yaml")
async def openapi_yaml():
    return FileResponse(OPENAPI_FILE, media_type="text/yaml")


@app.get("/openapi-ruter.json")
async def openapi_routes():
    specification = app.openapi()
    components = specification.get("components", {}).get("schemas", {})

    def resolve_schema(schema: dict[str, Any]) -> dict[str, Any]:
        reference = schema.get("$ref")
        if reference and reference.startswith("#/components/schemas/"):
            return components.get(reference.rsplit("/", 1)[-1], {})
        return schema

    def field_shape(name: str, schema: dict[str, Any], required: bool) -> dict[str, Any]:
        resolved = resolve_schema(schema)
        alternatives = [item for item in resolved.get("anyOf", []) if item.get("type") != "null"]
        if alternatives:
            resolved = resolve_schema(alternatives[0])
        return {
            "navn": name,
            "type": resolved.get("type", "string"),
            "format": resolved.get("format"),
            "paakrevd": required,
            "eksempel": resolved.get("example", resolved.get("default")),
            "valg": resolved.get("enum", []),
            "beskrivelse": resolved.get("description")
        }

    routes = []
    for route in app.routes:
        for method in sorted(getattr(route, "methods", set()) - {"HEAD", "OPTIONS"}):
            operation = specification.get("paths", {}).get(route.path, {}).get(method.lower(), {})
            parameters = []
            for parameter in operation.get("parameters", []):
                schema = resolve_schema(parameter.get("schema", {}))
                parameters.append({
                    "navn": parameter.get("name"),
                    "plassering": parameter.get("in"),
                    "paakrevd": bool(parameter.get("required")),
                    "eksempel": schema.get("example", schema.get("default")),
                    "beskrivelse": parameter.get("description")
                })
            content = operation.get("requestBody", {}).get("content", {})
            body = None
            if content:
                content_type = "multipart/form-data" if "multipart/form-data" in content else next(iter(content))
                schema = resolve_schema(content[content_type].get("schema", {}))
                required = set(schema.get("required", []))
                body = {
                    "innholdstype": content_type,
                    "paakrevd": bool(operation.get("requestBody", {}).get("required")),
                    "felter": [field_shape(name, value, name in required) for name, value in schema.get("properties", {}).items()]
                }
            routes.append({
                "sti": route.path,
                "metode": method,
                "security": [],
                "scopes": [],
                "sammendrag": operation.get("summary") or getattr(route, "summary", None) or getattr(route, "name", ""),
                "beskrivelse": operation.get("description"),
                "parametere": parameters,
                **({"kropp": body} if body else {})
            })
    return {"tjeneste": "pdf-extractor", "beskrivelse": app.description, "server": "http://localhost:8089", "ruter": routes}


@app.get("/dokumenter")
async def documents():
    items = list_documents()
    return {"count": len(items), "dokumenter": items}


@app.post("/dokumenter", status_code=202)
async def upload_document(
    fil: UploadFile = File(...),
    kildeType: SourceKind = Form("provided"),
    kanoniskUrl: str | None = Form(None),
    profil: Profile = Form("generic"),
):
    temporary = STATE_ROOT / f"upload-{uuid4().hex}.tmp"
    temporary.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    with temporary.open("wb") as target:
        while chunk := await fil.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_BYTES:
                target.close()
                temporary.unlink(missing_ok=True)
                raise HTTPException(413, "PDF-en er større enn tillatt grense.")
            target.write(chunk)
    with temporary.open("rb") as uploaded:
        signature = uploaded.read(5)
    if signature != b"%PDF-":
        temporary.unlink(missing_ok=True)
        raise HTTPException(400, "Filen er ikke en PDF.")
    digest = file_sha256(temporary)
    document_id = f"pdf-{digest[:16]}"
    directory = document_dir(document_id)
    directory.mkdir(parents=True, exist_ok=True)
    source_path = directory / "source.pdf"
    if not source_path.exists():
        os.replace(temporary, source_path)
    else:
        temporary.unlink(missing_ok=True)
    source = SourceMetadata(kind=kildeType, filename=fil.filename or "document.pdf", canonicalUrl=kanoniskUrl, retrievedAt=utc_now(), sha256=digest)
    metadata = {"documentId": document_id, "profile": profil, "source": source.model_dump(mode="json"), "uploadedAt": utc_now(), "size": size}
    write_json(directory / "metadata.json", metadata)
    job = await enqueue(document_id)
    return {**metadata, "jobId": job["jobId"], "extractionStatus": job["status"]}


@app.post("/dokumenter/{document_id}/uttrekk", status_code=202)
async def enqueue(document_id: str):
    directory = document_dir(document_id)
    if not (directory / "source.pdf").exists():
        raise HTTPException(404, "Fant ikke dokumentet.")
    active = next((job for job in jobs.values() if job["documentId"] == document_id and job["status"] in {"queued", "running"}), None)
    if active:
        return active
    job_id = f"jobb-{uuid4().hex}"
    job = {"jobId": job_id, "documentId": document_id, "status": "queued", "createdAt": utc_now(), "warnings": []}
    jobs[job_id] = job
    write_json(directory / "job.json", job)
    await queue.put((job_id, document_id))
    return job


@app.get("/jobber/{job_id}")
async def get_job(job_id: str):
    if job_id in jobs:
        return jobs[job_id]
    for document in list_documents():
        path = document_dir(document["documentId"]) / "job.json"
        if path.exists():
            job = read_json(path)
            if job.get("jobId") == job_id:
                return job
    raise HTTPException(404, "Fant ikke jobben.")


@app.get("/dokumenter/{document_id}/uttrekk")
async def get_extraction(document_id: str):
    result_path = find_result(document_id)
    if not result_path:
        raise HTTPException(404, "Dokumentet har ikke et ferdig uttrekk.")
    result = ExtractionDocument.model_validate(read_json(result_path))
    await asyncio.to_thread(record_retrieval, "extraction", [document_id])
    return result.model_dump(mode="json")


@app.get("/dokumenter/{document_id}/kunnskap")
async def get_knowledge(document_id: str, maxChars: int | None = Query(default=None, ge=1000, le=2_000_000)):
    result_path = find_result(document_id)
    if not result_path:
        raise HTTPException(404, "Dokumentet har ikke et ferdig uttrekk.")
    result = ExtractionDocument.model_validate(read_json(result_path))
    markdown, chunks = read_knowledge_artifacts(document_id, result_path, result)
    truncated = maxChars is not None and len(markdown) > maxChars
    suffix = "\n\n[Innholdet er forkortet. Bruk /biter eller et større maxChars.]\n"
    content = markdown[:max(0, maxChars - len(suffix))].rstrip() + suffix if truncated and maxChars is not None else markdown
    await asyncio.to_thread(record_retrieval, "document", [document_id])
    check_recommended = any(chunk.get("checkRecommended") for chunk in chunks)
    return {
        "documentId": document_id,
        "content": content,
        "characters": len(content),
        "totalCharacters": len(markdown),
        "chunkCount": len(chunks),
        "truncated": truncated,
        "quality": {
            "checkRecommended": check_recommended,
            "warnings": result.quality.get("warnings", []),
            "qualityReasons": result.quality.get("qualityReasons", [])
        }
    }


@app.get("/dokumenter/{document_id}/kunnskap.md", response_class=PlainTextResponse)
async def get_knowledge_markdown(document_id: str):
    result_path = find_result(document_id)
    if not result_path:
        raise HTTPException(404, "Dokumentet har ikke et ferdig uttrekk.")
    result = ExtractionDocument.model_validate(read_json(result_path))
    markdown, _ = read_knowledge_artifacts(document_id, result_path, result)
    await asyncio.to_thread(record_retrieval, "document", [document_id])
    return PlainTextResponse(markdown, media_type="text/markdown; charset=utf-8")


@app.get("/dokumenter/{document_id}/biter")
async def get_chunks(document_id: str):
    result_path = find_result(document_id)
    if not result_path:
        raise HTTPException(404, "Dokumentet har ikke et ferdig uttrekk.")
    result = ExtractionDocument.model_validate(read_json(result_path))
    _, chunks = read_knowledge_artifacts(document_id, result_path, result)
    await asyncio.to_thread(record_retrieval, "chunks", [document_id], [str(chunk.get("chunkId")) for chunk in chunks])
    return {"documentId": document_id, "count": len(chunks), "biter": chunks, "quality": result.quality}


@app.get("/dokumenter/{document_id}/rapport", response_class=HTMLResponse)
async def get_report(document_id: str):
    result_path = find_result(document_id)
    if not result_path:
        raise HTTPException(404, "Dokumentet har ikke en ferdig rapport.")
    return HTMLResponse(build_review(ExtractionDocument.model_validate(read_json(result_path))))


@app.get("/dokumenter/{document_id}/sider/{page_number}.png")
async def get_page(document_id: str, page_number: int):
    image = document_dir(document_id) / "pages" / f"page-{page_number:04d}.png"
    if not image.exists():
        raise HTTPException(404, "Fant ikke siden.")
    return FileResponse(image, media_type="image/png")


@app.post("/sok")
async def search(request: SearchRequest):
    selected: list[tuple[dict[str, Any], ExtractionDocument]] = []
    for item in list_documents():
        if request.documentId and item["documentId"] != request.documentId:
            continue
        if request.profile and item.get("profile") != request.profile:
            continue
        path = find_result(item["documentId"])
        if not path:
            continue
        result = ExtractionDocument.model_validate(read_json(path))
        selected.append((item, result))
    if request.documentId and not selected:
        raise HTTPException(404, "Dokumentet finnes ikke eller har ikke et ferdig uttrekk.")
    searchable: list[ExtractionDocument] = []
    index_warnings: list[str] = []
    for _, result in selected:
        current = has_document(result.documentId) and has_current_index(result, build_knowledge_chunks(result))
        if current:
            searchable.append(result)
            continue
        message = f"{result.documentId} har ingen oppdatert vektorindeks."
        if request.documentId:
            raise HTTPException(409, f"{message} Vent på uttrekksjobben eller kjør reprosessering.")
        index_warnings.append(message)
    allowed_ids = [result.documentId for result in searchable]
    hits = await asyncio.to_thread(search_vectors, request.query, request.limit, request.documentId, request.profile, allowed_ids)
    await asyncio.to_thread(
        record_retrieval,
        "search",
        sorted({str(hit.get("documentId")) for hit in hits if hit.get("documentId")}),
        [str(hit.get("chunkId")) for hit in hits if hit.get("chunkId")],
    )
    return {"count": len(hits), "treff": hits, "warnings": index_warnings}


@app.get("/revisjon")
async def retrieval_audit(limit: int = Query(default=100, ge=1, le=1000)):
    return {"events": await asyncio.to_thread(list_retrieval_audit, limit)}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8089")))
