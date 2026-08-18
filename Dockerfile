# RankedSat — production container image.
#
# Layout inside the image:
#   /app        the server + client (app/), with only production deps installed
#   /app/data   baked-in READ-ONLY content: questions.jsonl + figures/
#   /data       empty mount point for MUTABLE state (players.json) — mount a
#               volume here in production so ratings survive redeploys.
#
# /app/data and /data are deliberately different paths: a volume mounted at
# /data would otherwise hide the baked-in questions/figures shipped in the
# image layer underneath it.

# ---- Stage 1: build the React client -------------------------------------
# React/Vite are devDependencies, so this stage installs everything, builds
# app/client into app/public, and is then thrown away.
FROM node:22-alpine AS client
WORKDIR /build
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/vite.config.js ./
COPY app/client/ ./client/
RUN npm run build

# ---- Stage 2: runtime ------------------------------------------------------
FROM node:22-alpine

WORKDIR /app

# Install production dependencies only (layer cached unless package*.json changes).
COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev

# App source (server + legacy client). `client/` is source-only and not needed
# at runtime; the built output comes from the client stage below.
COPY app/server.js app/rules.js app/storage.js app/sample-questions.jsonl ./
COPY app/legacy/ ./legacy/
COPY --from=client /build/public/ ./public/

# Read-only content, baked into the image.
COPY data/questions.jsonl ./data/questions.jsonl
COPY data/figures/ ./data/figures/

ENV PORT=3000 \
    RANKEDSAT_QUESTIONS=/app/data/questions.jsonl \
    RANKEDSAT_FIGURES=/app/data/figures \
    RANKEDSAT_STATE_DIR=/data

# Non-root user. /data is created here so it exists (and is writable) even
# before a volume is mounted over it.
RUN addgroup -S rankedsat && adduser -S rankedsat -G rankedsat \
    && mkdir -p /data \
    && chown -R rankedsat:rankedsat /app /data
USER rankedsat

EXPOSE $PORT

CMD ["node", "server.js"]
