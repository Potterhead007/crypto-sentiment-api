/**
 * Prometheus Metrics Configuration
 * Centralized metrics registry and definitions
 */

import { Registry, collectDefaultMetrics, Counter, Gauge } from 'prom-client';

// Create and configure the metrics registry
export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

// Sentiment analysis counter - tracks total analyses performed
export const sentimentAnalysisTotal = new Counter({
  name: 'sentiment_analysis_total',
  help: 'Total sentiment analyses performed',
  labelNames: ['source', 'asset'],
  registers: [metricsRegistry],
});

// Data source health gauge - monitors upstream data source availability
export const datasourceHealth = new Gauge({
  name: 'datasource_health',
  help: 'Health status of data sources (1=up, 0=down)',
  labelNames: ['source'],
  registers: [metricsRegistry],
});
