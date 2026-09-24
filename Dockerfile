FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
# Cache-bust: Railway's builder has been observed reusing a stale
# pip-install layer even after requirements.txt content changed.
ARG CACHE_BUST=1
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ src/
COPY data/db/ data/db/

ENV PYTHONPATH=src

CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
