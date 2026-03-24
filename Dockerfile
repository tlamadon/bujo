# ── Stage 1: Build frontend ─────────────────────────
FROM node:20-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

# ── Stage 2: Build server ──────────────────────────
FROM node:20-alpine AS server
WORKDIR /app
COPY middleware/package.json middleware/package-lock.json ./
RUN npm ci
COPY middleware/ .
RUN npm run build

# ── Stage 3: Run ───────────────────────────────────
FROM node:20-alpine
WORKDIR /app
COPY --from=server /app/dist ./dist
COPY --from=server /app/node_modules ./node_modules
COPY --from=frontend /app/dist ./public
EXPOSE 3000
CMD ["node", "dist/index.js"]
