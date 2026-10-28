# ---- Base image (pinned Node LTS) ----
FROM node:24-slim AS base
WORKDIR /app

# ---- Install all dependencies (dev included) for the build ----
FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- Compile TypeScript ----
FROM dependencies AS build
COPY . .
RUN npm run build

# ---- Development runtime: full deps + tsx live reload (Compose Watch target) ----
# Used only via docker-compose.dev.yml. Runs `npm run dev` (tsx watch), so
# files synced by `develop.watch` trigger an automatic restart. Never used
# for production builds (see the `production` stage below).
FROM dependencies AS development
ENV NODE_ENV=development
COPY --chown=node:node . .
USER node
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ---- Production runtime: no dev dependencies, non-root user ----
FROM base AS production
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build --chown=node:node /app/dist ./dist
RUN chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/health').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"
CMD ["node", "dist/server.js"]
