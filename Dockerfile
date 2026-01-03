# --- STAGE 1: Build Frontend (React) ---
FROM node:18-alpine as frontend-builder
WORKDIR /app
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# --- STAGE 2: Production Server (PHP + Nginx) ---
# Používáme 'trafex/php-nginx' image, který má PHP-FPM i Nginx v jednom.
# Pro produkční ERP je to nejjednodušší cesta pro Railway (jeden kontejner).
FROM trafex/php-nginx:3.5.0

# Install DataBase Drivers (PostgreSQL)
USER root
RUN apk add --no-cache postgresql-dev \
    && docker-php-ext-install pdo pdo_pgsql

# Konfigurace Nginx
COPY nginx.conf /etc/nginx/nginx.conf

# Setup Backend Directory
WORKDIR /var/www/html
COPY backend/ .

# Copy Built Frontend from Stage 1 to Nginx public folder
# Předpokládáme, že API běží na /api/* a frontend je zbytek
COPY --from=frontend-builder /app/dist /var/www/html/public

# Permissions
RUN chown -R nobody.nobody /var/www/html

USER nobody
