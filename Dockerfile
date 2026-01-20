# =============================================================================
# Multi-Stage Dockerfile for Crypto Sentiment API
# Institutional-Grade Build for Production Deployment
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies
# -----------------------------------------------------------------------------
FROM node:20-alpine AS deps

RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# -----------------------------------------------------------------------------
# Stage 2: Builder
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and install all dependencies (including dev)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# -----------------------------------------------------------------------------
# Stage 3: Production
# -----------------------------------------------------------------------------
FROM node:20-alpine AS production

# Security: Run as non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 sentiment

WORKDIR /app

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Copy built application
COPY --from=builder --chown=sentiment:nodejs /app/dist ./dist
COPY --from=builder --chown=sentiment:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=sentiment:nodejs /app/package.json ./

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Switch to non-root user
USER sentiment

# Expose port
EXPOSE 3000

# Start application
CMD ["node", "dist/index.js"]

# -----------------------------------------------------------------------------
# Stage: Development
# -----------------------------------------------------------------------------
FROM node:20-alpine AS development

WORKDIR /app

# Install development tools
RUN apk add --no-cache git

# Copy package files
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY tsconfig.json ./
COPY src ./src

# Set environment
ENV NODE_ENV=development

# Expose port
EXPOSE 3000

# Start with hot reload
CMD ["npm", "run", "dev"]
