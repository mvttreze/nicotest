# Nico backend on Koyeb (or any Docker host).
# Mirrors the Render service: gunicorn + uvicorn workers, same PORT/timeout.
# All config comes from environment - .env is never baked in (.dockerignore).
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
  && pip install --no-cache-dir -r requirements.txt

COPY main.py ./

EXPOSE 8000

# Single worker: fits Koyeb free instances. PORT is injected by the host.
CMD ["sh", "-c", "python3 -m gunicorn -w 1 -k uvicorn.workers.UvicornWorker main:app --bind 0.0.0.0:${PORT:-8000} --timeout 180"]
