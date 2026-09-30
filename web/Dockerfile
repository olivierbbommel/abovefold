FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time only placeholders: `next build` imports every route module to
# collect its config (e.g. api/interaction, api/read), which eagerly
# constructs the lib/db.ts pool at module scope. There's no real database
# reachable during the image build, so these keep that constructor happy , 
# they are never used at runtime, where docker-compose.yml supplies the
# real values. MINIFLUX_URL is deliberately NOT overridden here: Next
# resolves next.config.ts's rewrites() at build time for `output:
# standalone` and bakes the result into routes-manifest.json, so setting it
# here would ship a wrong destination baked into the image, its existing
# default ("http://miniflux:8080") already matches the compose network.
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
