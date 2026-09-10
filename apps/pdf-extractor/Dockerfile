FROM python:3.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl poppler-utils tesseract-ocr tesseract-ocr-nor \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/apps/pdf-extractor
COPY apps/pdf-extractor/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/pdf-extractor ./
COPY openapi/pdf-extractor.yaml /workspace/openapi/pdf-extractor.yaml
ENV PYTHONPATH=/workspace/apps/pdf-extractor
CMD ["python", "-m", "pdf_extractor.service"]
