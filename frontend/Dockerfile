# Parallax frontend — Next.js 16 (multi-stage, pnpm via corepack)
ARG NODE_IMAGE=node:22-alpine

# ── deps ────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS deps
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ── build ───────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS build
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ── runtime ─────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runner
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate \
 && addgroup -S nextjs && adduser -S nextjs -G nextjs
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./next.config.ts
USER nextjs
EXPOSE 3000
CMD ["pnpm", "start", "--", "-p", "3000", "-H", "0.0.0.0"]
