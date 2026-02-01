# Dockhand SRE Agent — headless LLM-driven SRE daemon
#
# Build from the pi-mono repo root:
#   docker build -f packages/sre-agent/Dockerfile -t dockhand-sre-agent .
#
# Required env vars at runtime:
#   INFRA_AGENT_URL=http://infra-agent:18789
#   INFRA_AGENT_PORTAL_SHARED_SECRET=<shared secret>
#   ANTHROPIC_API_KEY=<api key>
#
# Optional env vars:
#   SRE_AGENT_DATA_DIR=/workspace (default: /var/lib/sre-agent)
#   SRE_AGENT_MODEL=claude-sonnet-4-5
#   SRE_AGENT_THINKING=medium
#   SRE_AGENT_TIMEZONE=UTC

# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /build

# Copy root workspace config
COPY package.json package-lock.json tsconfig.base.json ./

# Copy only the packages needed for sre-agent (+ transitive workspace deps)
COPY packages/tui/ packages/tui/
COPY packages/ai/ packages/ai/
COPY packages/agent/ packages/agent/
COPY packages/coding-agent/ packages/coding-agent/
COPY packages/sre-agent/ packages/sre-agent/

# Install all deps (workspace-aware)
# --ignore-scripts skips native compilation for unused packages (e.g. canvas from web-ui)
RUN npm ci --ignore-scripts

# Build the dependency chain in order
RUN cd packages/tui && npm run build \
 && cd ../ai && npm run build \
 && cd ../agent && npm run build \
 && cd ../coding-agent && npm run build \
 && cd ../sre-agent && npm run build

# Stage 2: Production runtime
FROM node:22-alpine

WORKDIR /app

# Copy root workspace config for npm to resolve workspace links
COPY package.json package-lock.json ./

# Copy built packages (dist + package.json for each)
COPY --from=builder /build/packages/tui/dist/ packages/tui/dist/
COPY --from=builder /build/packages/tui/package.json packages/tui/
COPY --from=builder /build/packages/ai/dist/ packages/ai/dist/
COPY --from=builder /build/packages/ai/package.json packages/ai/
COPY --from=builder /build/packages/agent/dist/ packages/agent/dist/
COPY --from=builder /build/packages/agent/package.json packages/agent/
COPY --from=builder /build/packages/coding-agent/dist/ packages/coding-agent/dist/
COPY --from=builder /build/packages/coding-agent/package.json packages/coding-agent/
COPY --from=builder /build/packages/sre-agent/dist/ packages/sre-agent/dist/
COPY --from=builder /build/packages/sre-agent/package.json packages/sre-agent/

# Copy default events
COPY --from=builder /build/packages/sre-agent/events/ packages/sre-agent/events/

# Install production dependencies only
RUN npm ci --omit=dev --ignore-scripts 2>/dev/null || npm install --omit=dev --ignore-scripts

# Create default data directory
RUN mkdir -p /var/lib/sre-agent/events

# Copy default events to data dir (can be overridden by volume mount)
COPY --from=builder /build/packages/sre-agent/events/ /var/lib/sre-agent/events/

ENV NODE_ENV=production

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "process.exit(0)"

CMD ["node", "packages/sre-agent/dist/main.js"]
