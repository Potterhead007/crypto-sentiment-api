/**
 * Prometheus Metrics Configuration
 * Centralized metrics registry and definitions
 *
 * All metrics referenced in infra/prometheus/rules/alerts.yml are defined here.
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

// Sentiment score gauge - current sentiment by asset
export const sentimentScore = new Gauge({
  name: 'sentiment_score',
  help: 'Current sentiment score by asset (-1 to 1)',
  labelNames: ['asset'],
  registers: [metricsRegistry],
});

// Sentiment mentions counter
export const sentimentMentionsTotal = new Counter({
  name: 'sentiment_mentions_total',
  help: 'Total mentions processed by asset',
  labelNames: ['asset'],
  registers: [metricsRegistry],
});

// Fear & Greed Index gauge
export const sentimentFearGreedIndex = new Gauge({
  name: 'sentiment_fear_greed_index',
  help: 'Market Fear & Greed Index (0-100)',
  registers: [metricsRegistry],
});

// Last processed timestamp gauge
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

// Data source rate limit usage gauge (0-1)
export const datasourceRateLimitUsage = new Gauge({
  name: 'datasource_rate_limit_usage',
  help: 'Data source rate limit usage (0-1)',
  labelNames: ['source'],
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

// Rate limit tokens remaining gauge
export const rateLimitTokensRemaining = new Gauge({
  name: 'rate_limit_tokens_remaining',
  help: 'Remaining rate limit tokens',
  labelNames: ['tier', 'client_id'],
  registers: [metricsRegistry],
});

// Rate limit tokens total gauge
export const rateLimitTokensTotal = new Gauge({
  name: 'rate_limit_tokens_total',
  help: 'Total rate limit tokens allocated',
  labelNames: ['tier', 'client_id'],
  registers: [metricsRegistry],
});

// =============================================================================
// PIPELINE METRICS
// =============================================================================

// Pipeline items processed counter
export const pipelineItemsProcessedTotal = new Counter({
  name: 'pipeline_items_processed_total',
  help: 'Total items processed by the pipeline',
  registers: [metricsRegistry],
});

// Pipeline items failed counter
export const pipelineItemsFailedTotal = new Counter({
  name: 'pipeline_items_failed_total',
  help: 'Total items that failed processing',
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
