# ---- Build stage: compile TypeScript ----
FROM node:20-alpine AS build
WORKDIR /app
# Install all deps (root workspaces) using the lockfile for reproducibility.
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci
COPY server ./server
RUN npm run build --workspace server

# ---- Runtime stage: slim, production-only ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Production dependencies only.
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci --omit=dev && npm cache clean --force
# Compiled app + raw SQL migrations (read at runtime by the migrate script).
COPY --from=build /app/server/dist ./server/dist
COPY server/db ./server/db
# Pre-create the uploads dir owned by the non-root user so a fresh named volume
# inherits the correct ownership (the API writes product images here).
RUN mkdir -p /app/server/uploads/products && chown -R node:node /app/server/uploads
# Run as the built-in non-root user.
USER node
WORKDIR /app/server
EXPOSE 4000
# Apply migrations, then start the API. Safe to run on every boot/deploy.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
