# Multi-stage production build for the Next.js 15 frontend. Used by
# infra/docker-compose.prod.yml — dev still runs `npm run dev` locally
# against the project root, not through Docker.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Server-side env reaches the build via Next.js runtime; NEXT_PUBLIC_* must
# also be present at build time so they get baked into the client bundle.
# Pass them in via `docker build --build-arg` if you customize, or set them
# in .env loaded by the compose `env_file:`.
ENV NODE_ENV=production
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Run as the unprivileged node user.
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["npm", "start"]
