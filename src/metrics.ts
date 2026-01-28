/**
 * Prometheus Metrics Configuration
 * Centralized metrics registry and definitions
 *
 * All metrics referenced in infra/prometheus/rules/alerts.yml are defined here.
 * Only metrics that are actively updated in the codebase are included.
 */

import { Registry, collectDefaultMetrics, Counter, Gauge, Histogram } from 'prom-client';

// =============================================================================
// REGISTRY SETUP
// =============================================================================

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

// =============================================================================
// HTTP METRICS
// =============================================================================

// HTTP request counter - tracks total requests by method, endpoint, and status
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'endpoint', 'status'],
  registers: [metricsRegistry],
});

// HTTP request duration histogram - for latency percentiles
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'endpoint'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

// =============================================================================
// SENTIMENT METRICS
// =============================================================================

// Sentiment analysis counter - tracks total analyses performed
export const sentimentAnalysisTotal = new Counter({
  name: 'sentiment_analysis_total',
  help: 'Total sentiment analyses performed',
  labelNames: ['source', 'asset'],
  registers: [metricsRegistry],
});

// Last processed timestamp gauge - updated when sentiment is fetched
export const sentimentLastProcessedTimestamp = new Gauge({
  name: 'sentiment_last_processed_timestamp',
  help: 'Unix timestamp of last sentiment processing',
  labelNames: ['asset'],
  registers: [metricsRegistry],
});

// =============================================================================
// DATA SOURCE METRICS
// =============================================================================

// Data source health gauge - monitors upstream data source availability
export const datasourceHealth = new Gauge({
  name: 'datasource_health',
  help: 'Health status of data sources (1=up, 0=down)',
  labelNames: ['source'],
  registers: [metricsRegistry],
});

// Data source request duration
export const datasourceRequestDuration = new Histogram({
  name: 'datasource_request_duration_seconds',
  help: 'Data source request duration in seconds',
  labelNames: ['source'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [metricsRegistry],
});

// Data source fallback counter
export const datasourceFallbackActivatedTotal = new Counter({
  name: 'datasource_fallback_activated_total',
  help: 'Total fallback activations by source',
  labelNames: ['source', 'fallback_provider'],
  registers: [metricsRegistry],
});

// =============================================================================
// RATE LIMITING METRICS
// =============================================================================

// Rate limit exceeded counter
export const rateLimitExceededTotal = new Counter({
  name: 'rate_limit_exceeded_total',
  help: 'Total rate limit exceeded events',
  labelNames: ['tier', 'client_id'],
  registers: [metricsRegistry],
});

// =============================================================================
// SECURITY METRICS
// =============================================================================

// Authentication failures counter
export const authFailuresTotal = new Counter({
  name: 'auth_failures_total',
  help: 'Total authentication failures',
  labelNames: ['reason'],
  registers: [metricsRegistry],
});

// Invalid API key attempts counter
export const invalidApiKeyTotal = new Counter({
  name: 'invalid_api_key_total',
  help: 'Total invalid API key attempts',
  labelNames: ['client_ip'],
  registers: [metricsRegistry],
});
