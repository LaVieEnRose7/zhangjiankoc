# ============================================================
# 杖剑传说 KOC 工作台 V3 - Docker 多阶段构建
# ============================================================

FROM node:22-alpine AS frontend-builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js ./
COPY public/ ./public/
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4567
ENV ZJ_DB_PATH=/app/server/data/zj_koc_v3.dat

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server/ ./server/
COPY --from=frontend-builder /app/dist ./dist

RUN mkdir -p /app/server/data /app/uploads

EXPOSE 4567

CMD ["node", "server/server.cjs"]
