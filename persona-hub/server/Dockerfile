# syntax=docker/dockerfile:1
# Build context: persona-hub/server
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# tsx is a devDependency and is used at runtime (no build script yet), so install all deps.
RUN npm ci --no-audit --no-fund && npm cache clean --force

FROM node:22-slim AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.json ./
COPY --chown=node:node src ./src
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "src/main.ts"]
