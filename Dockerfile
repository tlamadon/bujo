# ── Stage 1: Build ──────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

# ── Stage 2: Serve with Nginx ───────────────────────
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template
ENV COUCHDB_USER=admin
ENV COUCHDB_PASSWORD=changeme
ENV NGINX_ENVSUBST_FILTER=COUCHDB_
EXPOSE 80
