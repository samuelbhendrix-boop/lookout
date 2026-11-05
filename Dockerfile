# One image, two process types: `web` (default) and `worker`.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
# HOSTNAME must be 0.0.0.0: Docker sets it to the container id, which would bind Next to the wrong interface.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
RUN addgroup -S app && adduser -S app -G app
# Web (standalone Next output)
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# Worker + migrations need full deps, prisma schema and source
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/lib ./lib
COPY --from=build /app/worker ./worker
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/data ./data
USER app
EXPOSE 3000
# Migrations are idempotent and run on every boot, so a fresh database just works.
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
