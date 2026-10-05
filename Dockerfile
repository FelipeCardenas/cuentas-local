# Etapa 1: compilar React
FROM node:22-bookworm-slim AS frontend
WORKDIR /build/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
COPY cuentas/web/style.css /build/cuentas/web/style.css
RUN npm run build

# Etapa 2: ejecutar el sistema con Python
FROM python:3.12-slim-bookworm
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

COPY cuentas/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

RUN groupadd --gid 10001 cuentas \
    && useradd --uid 10001 --gid cuentas --no-create-home cuentas \
    && mkdir /data \
    && chown cuentas:cuentas /data

COPY cuentas/*.py ./
COPY --from=frontend /build/cuentas/web-react/ ./web-react/
COPY THIRD_PARTY_NOTICES.md ./

USER 10001:10001
EXPOSE 8767

CMD ["python", "servidor.py", "--host", "0.0.0.0", "--port", "8767", "--db", "/data/cuentas.sqlite3"]