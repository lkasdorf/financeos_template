# FinanceOS — minimal container image.
# The dashboard, server, and scripts run from a single Python process.
# Data lives outside the image (mounted via docker-compose volume).

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install Python dependencies first for better layer caching.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application sources. Runtime data dirs (data/, config/) are
# expected to be bind-mounted by docker-compose so user state survives
# image rebuilds.
COPY . .

EXPOSE 8080

# Bind to 0.0.0.0 so the port is reachable through the published mapping.
# `--no-open` skips the auto browser launch (no display in a container).
CMD ["python", "scripts/serve.py", "--bind", "0.0.0.0", "--port", "8080", "--no-open"]
