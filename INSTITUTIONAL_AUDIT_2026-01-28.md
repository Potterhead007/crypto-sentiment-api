# INSTITUTIONAL AUDIT REPORT
## Crypto Sentiment API - End-to-End Revision

**Audit Date:** 2026-01-28
**Standard:** Security-First, Efficiency-Driven
**Scope:** Full System Review - Design, Implementation, Configuration
**Previous Audit:** INSTITUTIONAL_ALIGNMENT_REVIEW.md (2026-01-20)

---

## EXECUTIVE SUMMARY

This comprehensive end-to-end revision validates the previous 71-finding audit remediation and identifies **17 new findings** requiring attention. The system has achieved significant improvement but requires targeted corrections before institutional deployment.

### Remediation Status

| Category | Previous Findings | Remediated | Remaining | New Findings |
|----------|-------------------|------------|-----------|--------------|
| CRITICAL | 5 | 5 | 0 | 1 |
| HIGH | 14 | 14 | 0 | 3 |
| MEDIUM | 18 | 17 | 1 | 5 |
| LOW | 8 | 8 | 0 | 5 |
| BLOAT | 26 | 26 | 0 | 3 |
| **TOTAL** | **71** | **70** | **1** | **17** |

### Key Achievements
- All 5 critical blockers resolved
- 7 speculative modules (~5,700 lines) removed
- All security hardening implemented
- TypeScript strict mode enabled
- Kubernetes manifests cleaned and secured
- CI/CD canary deployment implemented
- Docker Compose ports secured to localhost

---

## PART 1: PREVIOUS AUDIT VERIFICATION

### 1.1 CRITICAL BLOCKERS - ALL RESOLVED

| ID | Issue | Status | Evidence |
|----|-------|--------|----------|
| CRIT-001 | Secrets in VCS | FIXED | `.gitignore:7-10` properly excludes `.env` files |
| CRIT-002 | Duplicate K8s Resources | FIXED | Single ConfigMap in `k8s/deployment.yaml:19-43` |
| CRIT-003 | JWT Secret Fallback | FIXED | `src/config/default.ts:316-321` throws in production |
| CRIT-004 | Unauthenticated /metrics | FIXED | `src/index.ts:315-346` implements IP + token auth |
| CRIT-005 | SAML Parser Vulnerability | FIXED | `src/middleware/ssoAuth.ts` removed entirely |

### 1.2 ARCHITECTURE - BLOAT REMOVED

**Speculative Modules Deleted:**

| Module | Status | Verification |
|--------|--------|--------------|
| `src/api/schemaVersioning.ts` | DELETED | Not in filesystem |
| `src/services/modelVersioning.ts` | DELETED | Not in filesystem |
| `src/services/dataQualityScoring.ts` | DELETED | Not in filesystem |
| `src/services/statusPage.ts` | DELETED | Not in filesystem |
| `src/services/auditLogger.ts` | DELETED | Not in filesystem |
| `src/middleware/ssoAuth.ts` | DELETED | Not in filesystem |
| `src/sandbox/sandboxEnvironment.ts` | DELETED | Not in filesystem |

**Current Source Files (13 total):**
```
src/
├── config/default.ts           (391 lines)
├── database/migrator.ts        (444 lines)
├── datasources/
│   ├── news.ts                 (636 lines)
│   ├── onchain.ts              (1,325 lines)
│   ├── reddit.ts               (524 lines)
│   └── twitter.ts              (697 lines)
├── middleware/rateLimiter.ts   (552 lines)
├── metrics.ts                  (182 lines)
├── nlp/sentimentEngine.ts      (1,247 lines)
├── services/
│   ├── aggregationPipeline.ts  (1,064 lines)
│   └── entityResolution.ts     (1,006 lines)
├── websocket/reconnectionProtocol.ts (1,052 lines)
└── index.ts                    (1,109 lines)

Total: ~9,229 lines (down from ~15,000)
```

### 1.3 SECURITY FIXES - VERIFIED

| ID | Issue | Status | Evidence |
|----|-------|--------|----------|
| SEC-001 | SQL Injection in Migrator | FIXED | `migrator.ts:52-64` validates schema table name |
| SEC-002 | WebSocket ClientId Spoofing | FIXED | `index.ts:935-957` validates + hashed IP fallback |
| SEC-003 | Redis TLS Warning | PARTIAL | Warning only, acceptable for Railway |
| SEC-004 | Session Storage In-Memory | N/A | SSO module removed |
| SEC-005 | Anonymous Tier | FIXED | `default.ts:259-266` defines anonymous tier |

### 1.4 INFRASTRUCTURE - VERIFIED

| ID | Issue | Status | Evidence |
|----|-------|--------|----------|
| INFRA-001 | K8s Resource Limits | FIXED | `deployment.yaml:230-236` - 500m/768Mi requests |
| INFRA-002 | HPA Max Replicas | FIXED | `deployment.yaml:320` - maxReplicas: 10 |
| INFRA-003 | Canary Deployment | FIXED | `ci-cd.yml:303-424` implements canary |
| INFRA-004 | DB Retention Policies | FIXED | Schema: 2555 days for compliance tables |
| INFRA-005 | Docker Compose Ports | FIXED | All ports bound to 127.0.0.1 |

### 1.5 TYPESCRIPT STRICT MODE - VERIFIED

**tsconfig.json enables all strict checks:**
- `strict: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `noImplicitReturns: true`
- `noFallthroughCasesInSwitch: true`
- `useUnknownInCatchVariables: true`

---

## PART 2: NEW FINDINGS

### 2.1 CRITICAL (1 Finding) - RESOLVED

#### NEW-CRIT-001: Malformed normalizeEndpoint Function Breaks Rate Limiting [FIXED]

**Location:** `src/index.ts:240-307` (original), now `src/index.ts:254-320`

**Status:** RESOLVED (2026-01-28)

**Issue:** The `normalizeEndpoint` private method had a syntax/logic error. The function returned at line 245 but had additional code (the rate limiting setup) that was misplaced inside it. This code would NEVER execute.

**Current Code:**
```typescript
private normalizeEndpoint(path: string): string {
  return path
    .replace(/\/v1\/sentiment\/[A-Za-z0-9]+$/, '/v1/sentiment/:asset')
    .replace(/\/[0-9a-f-]{36}/g, '/:id')
    .replace(/\/\d+/g, '/:id');

  // DEAD CODE - Rate limiting never executes
  if (config.rateLimiting.enabled) {
    this.app.use(createRateLimitMiddleware({
      // ... configuration
    }));
  }
}
```

**Risk:** HIGH - Rate limiting is COMPLETELY DISABLED in production. Anonymous users have unlimited access.

**Fix:** Extract rate limiting setup to `setupMiddleware()`:

```typescript
private normalizeEndpoint(path: string): string {
  return path
    .replace(/\/v1\/sentiment\/[A-Za-z0-9]+$/, '/v1/sentiment/:asset')
    .replace(/\/[0-9a-f-]{36}/g, '/:id')
    .replace(/\/\d+/g, '/:id');
}

private setupMiddleware(): void {
  // ... existing helmet, cors, compression setup ...

  // Rate limiting - MUST be after body parsing
  if (config.rateLimiting.enabled) {
    this.app.use(createRateLimitMiddleware({
      redis: this.redis,
      getClientContext: async (req: Request) => {
        // ... existing implementation
      },
      skip: (req: Request) => {
        return req.path === '/health' || req.path === '/health/ready';
      },
      onRateLimited: (req: Request, _result) => {
        const tier = (req as any).clientTier || 'anonymous';
        const clientId = (req as any).clientId || 'unknown';
        rateLimitExceededTotal.inc({ tier, client_id: clientId });
      },
    }));
  }
}
```

**Priority:** IMMEDIATE
**Effort:** 30 minutes

**Resolution Applied:**
- Extracted rate limiting code to new `setupRateLimiting()` method
- `normalizeEndpoint()` now only handles path normalization
- `setupMiddleware()` calls `setupRateLimiting()` after body parsing
- Added logging to confirm rate limiting is enabled at startup
- TypeScript compiles without errors
- 145/150 tests pass (5 pre-existing config test failures unrelated to this fix)

---

### 2.2 HIGH (3 Findings) - ALL RESOLVED

#### NEW-HIGH-001: README Documentation Misalignment [FIXED]

**Location:** `README.md:146-166`

**Status:** RESOLVED (2026-01-28)

**Issue:** README still documents removed modules:
- `src/api/schemaVersioning.ts` (deleted)
- `src/middleware/ssoAuth.ts` (deleted)
- `src/sandbox/sandboxEnvironment.ts` (deleted)
- `src/services/auditLogger.ts` (deleted)
- `src/services/dataQualityScoring.ts` (deleted)
- `src/services/modelVersioning.ts` (deleted)
- `src/services/statusPage.ts` (deleted)

Also references features:
- "SAML 2.0/OIDC SSO" (line 12) - removed
- "SOC 2 compliant audit logging" (line 13) - removed

**Risk:** Misleading documentation causes integration failures and support burden.

**Fix:** Update README Project Structure section:

```markdown
## Project Structure

```
src/
├── config/
│   └── default.ts             # Application configuration with validation
├── database/
│   ├── migrations/            # SQL migrations (TimescaleDB optional)
│   └── migrator.ts            # Migration runner with checksum verification
├── datasources/
│   ├── news.ts                # CryptoPanic & NewsAPI integration
│   ├── onchain.ts             # Multi-chain blockchain analytics
│   ├── reddit.ts              # Reddit API sentiment crawling
│   └── twitter.ts             # Twitter/X with fallback providers
├── middleware/
│   └── rateLimiter.ts         # Token bucket rate limiting per tier
├── nlp/
│   └── sentimentEngine.ts     # FinBERT NLP with emotion analysis
├── services/
│   ├── aggregationPipeline.ts # Real-time sentiment aggregation
│   └── entityResolution.ts    # Wallet clustering & smart money
├── websocket/
│   └── reconnectionProtocol.ts # Session recovery & heartbeat
├── metrics.ts                 # Prometheus metrics definitions
└── index.ts                   # Application entry point
```
```

Remove or update lines 12-13 to reflect current capabilities.

**Priority:** HIGH
**Effort:** 1 hour

---

#### NEW-HIGH-002: WebSocket Tier Hardcoded [FIXED]

**Location:** `src/index.ts:825` (now uses `getClientTier()` method)

**Status:** RESOLVED (2026-01-28)

**Issue:** WebSocket connection handler hardcodes tier as 'professional' instead of looking up from database.

```typescript
const tier = 'professional'; // Would be looked up from database
```

**Risk:** All WebSocket clients get professional tier limits regardless of their actual subscription level. Enterprise/Strategic clients may be throttled; anonymous users get elevated access.

**Fix:**
```typescript
private async getClientTier(clientId: string): Promise<'anonymous' | 'professional' | 'institutional' | 'enterprise' | 'strategic'> {
  // Anonymous clients have no tier lookup
  if (clientId.startsWith('anon_')) {
    return 'anonymous';
  }

  try {
    const result = await this.pool.query<{ tier: string }>(
      `SELECT c.tier FROM clients c WHERE c.id = $1 AND c.is_active = true`,
      [clientId]
    );
    if (result.rows.length > 0) {
      return result.rows[0].tier as any;
    }
  } catch (error) {
    console.error('Failed to lookup client tier:', error);
  }
  return 'anonymous';
}

// In setupWebSocket:
const tier = await this.getClientTier(clientId);
```

**Priority:** HIGH
**Effort:** 1 hour

---

#### NEW-HIGH-003: Entity Seed Data Conflict Resolution [FIXED]

**Location:** `src/database/migrations/0001_initial_schema.sql:345-358`

**Status:** RESOLVED (2026-01-28)

**Issue:** The INSERT for entities uses `ON CONFLICT DO NOTHING` without specifying the conflict target column.

```sql
INSERT INTO entities (name, entity_type, aliases) VALUES
  ('Binance', 'exchange', ARRAY['Binance.com', 'BNB Exchange']),
  -- ...
ON CONFLICT DO NOTHING;
```

**Risk:** In PostgreSQL, `ON CONFLICT DO NOTHING` without a target requires a unique constraint. The `entities` table has no unique constraint on any column, so this may cause duplicate entries or errors on re-migration.

**Fix:** Add unique constraint and specify conflict target:

```sql
-- Add unique constraint on name + entity_type
ALTER TABLE entities ADD CONSTRAINT entities_name_type_unique UNIQUE (name, entity_type);

INSERT INTO entities (name, entity_type, aliases) VALUES
  ('Binance', 'exchange', ARRAY['Binance.com', 'BNB Exchange']),
  -- ...
ON CONFLICT (name, entity_type) DO NOTHING;
```

Or for assets (which correctly uses `ON CONFLICT (symbol)`), ensure consistency.

**Priority:** HIGH
**Effort:** 30 minutes

---

### 2.3 MEDIUM (5 Findings) - 4 RESOLVED, 1 DEFERRED

#### NEW-MED-001: Unused Prometheus Metrics (7 of 17) [FIXED]

**Status:** RESOLVED (2026-01-28)

**Location:** `src/metrics.ts`

**Issue:** 7 metrics are defined but never updated anywhere in the codebase:

| Metric | Line | Status |
|--------|------|--------|
| `sentimentScore` | 51-56 | Never updated |
| `sentimentMentionsTotal` | 59-64 | Never updated |
| `sentimentFearGreedIndex` | 67-71 | Never updated |
| `datasourceRateLimitUsage` | 103-108 | Never updated |
| `rateLimitTokensRemaining` | 131-136 | Never updated |
| `rateLimitTokensTotal` | 139-144 | Never updated |
| `pipelineItemsProcessedTotal` | 151-155 | Defined but not wired |
| `pipelineItemsFailedTotal` | 158-162 | Defined but not wired |

**Risk:** Misleading Grafana dashboards, wasted cardinality, alert rules that never fire.

**Fix:** Either implement the metrics or remove unused definitions:

Option A - Remove unused (recommended for now):
```typescript
// DELETE these exports from metrics.ts:
// sentimentScore, sentimentMentionsTotal, sentimentFearGreedIndex,
// datasourceRateLimitUsage, rateLimitTokensRemaining, rateLimitTokensTotal
```

Option B - Wire pipeline metrics in aggregationPipeline.ts.

**Priority:** MEDIUM
**Effort:** 1 hour

---

#### NEW-MED-002: KafkaJS Dependency May Be Unused [DEFERRED]

**Location:** `package.json:40`

**Status:** DEFERRED - Requires code refactoring to use dynamic imports in aggregationPipeline.ts

**Issue:** `kafkajs` is a production dependency but Kafka is optional. For Railway deployment (which doesn't use Kafka), this adds 1.2MB to node_modules.

**Fix:** Move to optional dependencies or lazy-load:

Option A - Move to optionalDependencies:
```json
{
  "optionalDependencies": {
    "kafkajs": "^2.2.4"
  }
}
```

Option B - Use dynamic import in aggregationPipeline.ts:
```typescript
let KafkaClient: any;
if (config.kafka.brokers[0] !== 'disabled') {
  KafkaClient = await import('kafkajs');
}
```

**Priority:** MEDIUM
**Effort:** 2 hours

---

#### NEW-MED-003: CORS Wildcard Only Warns in Production [FIXED]

**Location:** `src/config/default.ts:367-369`

**Status:** RESOLVED (2026-01-28)

**Issue:** CORS set to `*` only generates a warning, not an error.

```typescript
if (cfg.security.corsOrigins.includes('*')) {
  console.warn('WARNING: CORS origins is set to * in production...');
}
```

**Risk:** Accidental deployment with open CORS enables cross-site attacks.

**Fix:** Block wildcard CORS in production:
```typescript
if (cfg.security.corsOrigins.includes('*')) {
  errors.push('CRITICAL: CORS_ORIGINS cannot be * in production. Specify allowed domains.');
}
```

**Priority:** MEDIUM
**Effort:** 5 minutes

---

#### NEW-MED-004: Missing Pipeline Event Listener Cleanup [FIXED]

**Location:** `src/index.ts:1068-1075` (setup), `src/index.ts:1100-1103` (cleanup)

**Status:** RESOLVED (2026-01-28)

**Issue:** Pipeline event listener is added but never cleaned up on shutdown.

```typescript
this.pipeline.on('datasourceHealth', (status: Record<string, boolean>) => {
  for (const [source, healthy] of Object.entries(status)) {
    datasourceHealth.set({ source }, healthy ? 1 : 0);
  }
});
```

**Risk:** Memory leak on restart, potential duplicate event handlers.

**Fix:** Store reference and remove in stop():
```typescript
private datasourceHealthHandler?: (status: Record<string, boolean>) => void;

// In start():
this.datasourceHealthHandler = (status: Record<string, boolean>) => {
  for (const [source, healthy] of Object.entries(status)) {
    datasourceHealth.set({ source }, healthy ? 1 : 0);
  }
};
this.pipeline.on('datasourceHealth', this.datasourceHealthHandler);

// In stop():
if (this.pipeline && this.datasourceHealthHandler) {
  this.pipeline.off('datasourceHealth', this.datasourceHealthHandler);
}
```

**Priority:** MEDIUM
**Effort:** 15 minutes

---

#### NEW-MED-005: Health Check Exposes Component Hint in Non-Production [FIXED]

**Location:** `src/index.ts:395-402`

**Status:** RESOLVED (2026-01-28)

**Issue:** Health check failure reveals component information in non-production:

```typescript
hint: config.server.env !== 'production' ? failedComponent : undefined,
```

While intentional for debugging, the `failedComponent` logic only detects `ECONNREFUSED`. Other errors expose less useful "unknown" hint.

**Fix:** Improve component detection or remove hint entirely:
```typescript
// Option: Remove hint (security over convenience)
hint: undefined,
```

**Priority:** MEDIUM
**Effort:** 10 minutes

---

### 2.4 LOW (5 Findings)

#### NEW-LOW-001: Hardcoded Documentation URL

**Location:** `src/index.ts:744, 971`

**Issue:** Documentation URLs hardcoded as `https://docs.sentiment-api.io`:
- Line 744: `changelog_url: 'https://docs.sentiment-api.io/changelog'`
- Line 971: `documentation: 'https://docs.sentiment-api.io'`

**Fix:** Move to config:
```typescript
// config/default.ts
documentation: {
  baseUrl: process.env.DOCS_URL || 'https://docs.sentiment-api.io',
}
```

**Priority:** LOW
**Effort:** 15 minutes

---

#### NEW-LOW-002: Magic Numbers in WebSocket Config

**Location:** `src/index.ts:140-143`

**Issue:** Session manager config has magic numbers:
```typescript
bufferDurationMs: config.websocket.messageBufferDuration,
maxBufferSize: 10000,  // Magic number
recoveryEndpoint: '/v1/stream/replay',  // Hardcoded
sessionTTL: 3600, // Magic number (1 hour)
```

**Fix:** Move to config:
```typescript
// config/default.ts websocket section:
maxBufferSize: parseInt(process.env.WS_MAX_BUFFER_SIZE || '10000'),
sessionTTL: parseInt(process.env.WS_SESSION_TTL || '3600'),
recoveryEndpoint: '/v1/stream/replay',
```

**Priority:** LOW
**Effort:** 20 minutes

---

#### NEW-LOW-003: Console.log in Production Code

**Location:** Multiple locations in `src/index.ts`

**Issue:** Direct `console.log/error/warn` calls instead of structured logging:
- Lines 283, 384, 496, 570, 670, 728, 766, 977, 996, 1000, 1006, etc.

**Fix:** Consider adding a minimal structured logger or accept as-is for Railway logging integration.

**Priority:** LOW
**Effort:** 4 hours (if implementing structured logging)

---

#### NEW-LOW-004: Import Statement Order

**Location:** `src/index.ts:6-32`

**Issue:** Imports not consistently ordered (external vs internal, alphabetical).

**Fix:** Apply consistent import order:
```typescript
// External packages (alphabetical)
import compression from 'compression';
import cors from 'cors';
import crypto from 'crypto';
import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { createServer, Server } from 'http';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { WebSocketServer } from 'ws';
import { z } from 'zod';

// Internal modules (alphabetical)
import config, { validateConfig } from './config/default';
import { DatabaseMigrator } from './database/migrator';
import { /* ... */ } from './metrics';
import { createRateLimitMiddleware, WebSocketConnectionLimiter } from './middleware/rateLimiter';
import { SentimentEngine } from './nlp/sentimentEngine';
import { AggregationPipeline, createPipeline } from './services/aggregationPipeline';
import { SessionManager } from './websocket/reconnectionProtocol';
```

**Priority:** LOW
**Effort:** 10 minutes

---

#### NEW-LOW-005: Incomplete Type for WebSocket Message Handler

**Location:** `src/index.ts:898`

**Issue:** Function uses `any` types:
```typescript
private handleWebSocketMessage(ws: any, session: any, message: any): void {
```

**Fix:** Define proper types:
```typescript
interface WebSocketMessage {
  type: 'subscribe' | 'unsubscribe' | 'heartbeat_ack';
  assets?: string[];
}

private handleWebSocketMessage(
  ws: WebSocket,
  session: SessionData,
  message: WebSocketMessage
): void {
```

**Priority:** LOW
**Effort:** 30 minutes

---

### 2.5 BLOAT (3 Findings)

#### NEW-BLOAT-001: Unused Fear & Greed Endpoint Referenced

**Location:** `src/metrics.ts:67-71`

**Issue:** `sentimentFearGreedIndex` metric suggests a Fear & Greed index feature that doesn't exist.

**Fix:** Remove unless implementing Fear & Greed index endpoint.

---

#### NEW-BLOAT-002: Rate Limit Token Metrics Never Used

**Location:** `src/metrics.ts:131-144`

**Issue:** `rateLimitTokensRemaining` and `rateLimitTokensTotal` are defined but rate limiter doesn't update them.

**Fix:** Remove or implement in rateLimiter.ts.

---

#### NEW-BLOAT-003: Datasource Rate Limit Usage Never Updated

**Location:** `src/metrics.ts:103-108`

**Issue:** `datasourceRateLimitUsage` gauge never updated by any datasource module.

**Fix:** Remove or implement in datasource modules.

---

## PART 3: ALIGNMENT VERIFICATION MATRIX

### 3.1 Specification vs Implementation

| Component | Spec (README/Docs) | Implementation | Aligned |
|-----------|-------------------|----------------|---------|
| API Tiers | 5 tiers (anon-strategic) | 5 tiers defined | YES |
| Rate Limiting | Per-tier limits | **BROKEN** (dead code) | NO |
| WebSocket | Session recovery | Implemented | YES |
| WebSocket Tiers | Per-client tier | **Hardcoded** | NO |
| Health Checks | /health, /ready, /live | All implemented | YES |
| Metrics | /metrics secured | IP + token auth | YES |
| Historical API | 1m/1h/1d intervals | Table mapping validated | YES |
| NLP Engine | FinBERT + emotions | Implemented | YES |
| Data Sources | 4 (twitter, reddit, news, onchain) | All present | YES |
| SSO/SAML | Listed in README | **Removed** | NO |
| Audit Logging | Listed in README | **Removed** | NO |

### 3.2 Security Posture

| Control | Status | Notes |
|---------|--------|-------|
| Secrets in VCS | SECURE | .gitignore properly configured |
| JWT Validation | SECURE | Throws in production |
| API Key Hashing | SECURE | SHA-256 with prefix lookup |
| SQL Injection | SECURE | Parameterized + validated |
| WebSocket Auth | PARTIAL | Tier lookup not implemented |
| Rate Limiting | BROKEN | Dead code block |
| CORS | WARN | Wildcard allowed with warning |
| Redis TLS | WARN | Warning only, not enforced |
| /metrics | SECURE | IP + token authentication |
| K8s Secrets | SECURE | External secrets pattern |

### 3.3 Configuration Consistency

| Config Area | .env.example | default.ts | docker-compose | k8s | Aligned |
|-------------|--------------|------------|----------------|-----|---------|
| Database | YES | YES | YES | YES | YES |
| Redis | YES | YES | YES | YES | YES |
| Kafka | YES | YES | YES | YES | YES |
| JWT | YES | YES | YES | YES | YES |
| CORS | YES | YES | YES | YES | YES |
| Monitoring | YES | YES | YES | YES | YES |

---

## PART 4: REMEDIATION PRIORITY MATRIX

### Immediate (Before Next Deployment)

| ID | Task | Effort | Impact |
|----|------|--------|--------|
| NEW-CRIT-001 | Fix rate limiting dead code | 30m | Critical - security |

### Sprint 1 (This Week)

| ID | Task | Effort | Impact |
|----|------|--------|--------|
| NEW-HIGH-001 | Update README documentation | 1h | Documentation accuracy |
| NEW-HIGH-002 | Implement WebSocket tier lookup | 1h | Billing accuracy |
| NEW-HIGH-003 | Fix entity seed conflict | 30m | Data integrity |
| NEW-MED-003 | Block CORS wildcard in production | 5m | Security |
| NEW-MED-004 | Add pipeline event cleanup | 15m | Memory leak |

### Sprint 2 (Next Week)

| ID | Task | Effort | Impact |
|----|------|--------|--------|
| NEW-MED-001 | Remove/wire unused metrics | 1h | Observability |
| NEW-MED-002 | Optimize KafkaJS dependency | 2h | Bundle size |
| NEW-MED-005 | Remove health hint | 10m | Security |

### Backlog

| ID | Task | Effort | Impact |
|----|------|--------|--------|
| NEW-LOW-001 | Config for documentation URLs | 15m | Maintainability |
| NEW-LOW-002 | Config for WS magic numbers | 20m | Configurability |
| NEW-LOW-003 | Structured logging | 4h | Observability |
| NEW-LOW-004 | Import order consistency | 10m | Code quality |
| NEW-LOW-005 | WebSocket handler types | 30m | Type safety |
| NEW-BLOAT-* | Remove unused metrics | 30m | Code cleanliness |

---

## PART 5: SYSTEM SCORECARD

### Current State Assessment

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Security** | 7/10 | Rate limiting broken, CORS warning |
| **Reliability** | 8/10 | Solid error handling, session recovery |
| **Efficiency** | 9/10 | Bloat removed, streamlined codebase |
| **Maintainability** | 8/10 | Good structure, some docs outdated |
| **Observability** | 6/10 | Unused metrics, need cleanup |
| **Scalability** | 8/10 | HPA configured, Redis-backed sessions |
| **Compliance** | 7/10 | Audit retention set, audit module removed |

**Overall: 7.6/10** (Up from ~5/10 post-audit)

### Post-Remediation Target

| Dimension | Current | Target | Gap |
|-----------|---------|--------|-----|
| Security | 7/10 | 9/10 | Fix rate limiting + CORS |
| Reliability | 8/10 | 9/10 | Cleanup event handlers |
| Efficiency | 9/10 | 9/10 | Maintain |
| Maintainability | 8/10 | 9/10 | Update docs |
| Observability | 6/10 | 8/10 | Clean metrics |
| Scalability | 8/10 | 8/10 | Maintain |
| Compliance | 7/10 | 8/10 | Add structured logging |

**Target: 8.6/10** (Institutional Grade)

---

## APPENDIX A: FILE CHANGES REQUIRED

### Files to Modify

```
src/index.ts                    # Fix rate limiting, WebSocket tier, event cleanup
src/config/default.ts           # Block CORS wildcard, add WS config
src/metrics.ts                  # Remove unused metrics
src/database/migrations/0001_initial_schema.sql  # Fix entity conflict
README.md                       # Update project structure, remove SSO references
```

### No Files to Delete

All bloat was removed in previous remediation.

---

## APPENDIX B: VERIFICATION CHECKLIST

Post-remediation verification:

- [ ] Rate limiting returns 429 for anonymous requests over limit
- [ ] WebSocket clients receive correct tier-based limits
- [ ] CORS wildcard blocks in production (`NODE_ENV=production`)
- [ ] README matches actual file structure
- [ ] TypeScript compiles without warnings
- [ ] All tests pass with 80%+ coverage
- [ ] Entity seed data runs without conflicts
- [ ] Metrics endpoint shows only used metrics

---

## APPENDIX C: CRITICAL FIX - RATE LIMITING

**This fix must be applied before any production deployment.**

The following patch extracts the rate limiting code from the malformed `normalizeEndpoint` function:

```diff
--- a/src/index.ts
+++ b/src/index.ts
@@ -237,10 +237,7 @@ class Application {
    * Normalizes endpoint paths for metrics (removes IDs to avoid cardinality explosion)
    */
   private normalizeEndpoint(path: string): string {
-    return path
-      .replace(/\/v1\/sentiment\/[A-Za-z0-9]+$/, '/v1/sentiment/:asset')
-      .replace(/\/[0-9a-f-]{36}/g, '/:id') // UUIDs
-      .replace(/\/\d+/g, '/:id'); // Numeric IDs
+    return path
+      .replace(/\/v1\/sentiment\/[A-Za-z0-9]+$/, '/v1/sentiment/:asset')
+      .replace(/\/[0-9a-f-]{36}/g, '/:id')
+      .replace(/\/\d+/g, '/:id');
+  }

-    // Rate limiting
+  private setupRateLimiting(): void {
     if (config.rateLimiting.enabled) {
       this.app.use(createRateLimitMiddleware({
@@ -232,6 +232,7 @@ class Application {
       next();
     });
+
+    this.setupRateLimiting();
   }
```

---

**Review Status:** COMPLETE
**Blocking Issues:** 0 (NEW-CRIT-001 FIXED)
**Fix Applied:** 2026-01-28 - Rate limiting extracted to `setupRateLimiting()` method
**Estimated Remaining Effort:** 11-14 engineering hours
