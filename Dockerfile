# --- STAGE 1: Build Frontend (React) ---
FROM node:22-alpine as frontend-builder

# Set memory limit to prevent OOM (Exit 137)
ENV NODE_OPTIONS="--max-old-space-size=4096"

WORKDIR /app

# Copy package.json first for cache
COPY client/package*.json ./
# Install dependencies (ci is cleaner/faster)
RUN npm ci

# Copy source
COPY client/ ./

# Build
RUN npm run build


# --- STAGE 2: Production Server (PHP + Nginx) ---
FROM trafex/php-nginx:3.5.0

# Switch to root to install packages
USER root

# Install PostgreSQL Drivers directly via APK (Alpine)
# 'trafex/php-nginx' is based on Alpine, so we use apk add.
# We don't use 'docker-php-ext-install' because this is not an official PHP image base.
RUN apk add --no-cache \
    php83-pdo_pgsql \
    php83-pgsql \
    tesseract-ocr \
    tesseract-ocr-data-eng \
    tesseract-ocr-data-ces \
    poppler-utils

# Copy Nginx Config
COPY nginx.conf /etc/nginx/nginx.conf

# Setup Backend
WORKDIR /var/www/html
COPY backend/ .

# Copy Built Frontend from Stage 1 to Nginx public folder
COPY --from=frontend-builder /app/dist /var/www/html/public

# Permissions (Ensure nginx user can read/write)
RUN chown -R nobody.nobody /var/www/html

# Switch back to non-root user
USER nobody
