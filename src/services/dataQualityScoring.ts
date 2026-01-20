/**
 * Data Quality Scoring System
 * Institutional-Grade Cryptocurrency Market Sentiment Analysis API
 *
 * Provides:
 * - Per-source reliability metrics
 * - Data freshness monitoring
 * - Coverage completeness tracking
 * - Quality degradation alerts
 * - Historical quality trends
 */

import { EventEmitter } from 'events';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

export type DataSourceId =
  | 'twitter'
  | 'reddit'
  | 'telegram'
  | 'discord'
  | 'farcaster'
  | 'news_bloomberg'
  | 'news_reuters'
  | 'news_crypto_native'
  | 'onchain_ethereum'
  | 'onchain_bitcoin'
  | 'onchain_solana'
  | 'exchange_binance'
  | 'exchange_coinbase'
  | 'exchange_derivatives'
  | 'github';

export interface DataSourceConfig {
  id: DataSourceId;
  name: string;
  category: 'social' | 'news' | 'onchain' | 'exchange' | 'developer';
  weight: number;
  expectedLatencyMs: number;
  expectedVolumePerHour: number;
  criticalityLevel: 'critical' | 'high' | 'medium' | 'low';
}

export interface DataQualityMetrics {
  sourceId: DataSourceId;
  timestamp: Date;
  availability: AvailabilityMetrics;
  freshness: FreshnessMetrics;
  volume: VolumeMetrics;
  accuracy: AccuracyMetrics;
  reliability: ReliabilityMetrics;
  overallScore: number;
  qualityGrade: QualityGrade;
  alerts: QualityAlert[];
}

export interface AvailabilityMetrics {
  /** Uptime percentage (0-1) */
  uptime: number;
  /** Current status */
  status: 'healthy' | 'degraded' | 'down' | 'unknown';
  /** Last successful data point */
  lastSuccessAt: Date | null;
  /** Time since last success (ms) */
  timeSinceLastSuccess: number | null;
  /** Failures in last hour */
  failuresLastHour: number;
}

export interface FreshnessMetrics {
  /** Average data age (ms) */
  averageAgeMs: number;
  /** Maximum acceptable age (ms) */
  maxAcceptableAgeMs: number;
  /** Current lag vs expected (ms) */
  lagMs: number;
  /** Freshness score (0-1) */
  score: number;
  /** Is data stale? */
  isStale: boolean;
}

export interface VolumeMetrics {
  /** Data points in last hour */
  lastHourVolume: number;
  /** Expected volume per hour */
  expectedVolume: number;
  /** Volume ratio (actual/expected) */
  volumeRatio: number;
  /** Volume trend */
  trend: 'increasing' | 'stable' | 'decreasing' | 'anomalous';
  /** Is volume anomalous? */
  isAnomalous: boolean;
}

export interface AccuracyMetrics {
  /** Data validation pass rate (0-1) */
  validationRate: number;
  /** Parse error rate (0-1) */
  parseErrorRate: number;
  /** Duplicate rate (0-1) */
  duplicateRate: number;
  /** Schema compliance rate (0-1) */
  schemaCompliance: number;
}

export interface ReliabilityMetrics {
  /** Historical reliability (30-day average) */
  historicalReliability: number;
  /** Recent reliability (24-hour average) */
  recentReliability: number;
  /** Reliability trend */
  trend: 'improving' | 'stable' | 'degrading';
  /** Mean time between failures (hours) */
  mtbf: number;
  /** Mean time to recovery (minutes) */
  mttr: number;
}

export type QualityGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface QualityAlert {
  id: string;
  sourceId: DataSourceId;
  severity: 'critical' | 'warning' | 'info';
  type: QualityAlertType;
  message: string;
  triggeredAt: Date;
  resolvedAt?: Date;
  metadata: Record<string, any>;
}

export type QualityAlertType =
  | 'source_down'
  | 'high_latency'
  | 'stale_data'
  | 'volume_anomaly'
  | 'error_spike'
  | 'quality_degradation';

export interface AggregateQualityMetrics {
  timestamp: Date;
  overallScore: number;
  overallGrade: QualityGrade;
  sourceCount: number;
  healthySources: number;
  degradedSources: number;
  downSources: number;
  byCategory: Record<string, CategoryQualityMetrics>;
  activeAlerts: QualityAlert[];
}

export interface CategoryQualityMetrics {
  category: string;
  score: number;
  grade: QualityGrade;
  sourceCount: number;
  healthyCount: number;
}

// =============================================================================
// DATA SOURCE CONFIGURATION
// =============================================================================

export const DATA_SOURCES: DataSourceConfig[] = [
  // Social
  { id: 'twitter', name: 'Twitter/X', category: 'social', weight: 0.25, expectedLatencyMs: 5000, expectedVolumePerHour: 50000, criticalityLevel: 'critical' },
  { id: 'reddit', name: 'Reddit', category: 'social', weight: 0.15, expectedLatencyMs: 15000, expectedVolumePerHour: 10000, criticalityLevel: 'high' },
  { id: 'telegram', name: 'Telegram', category: 'social', weight: 0.10, expectedLatencyMs: 5000, expectedVolumePerHour: 20000, criticalityLevel: 'high' },
  { id: 'discord', name: 'Discord', category: 'social', weight: 0.05, expectedLatencyMs: 5000, expectedVolumePerHour: 15000, criticalityLevel: 'medium' },
  { id: 'farcaster', name: 'Farcaster', category: 'social', weight: 0.05, expectedLatencyMs: 2000, expectedVolumePerHour: 5000, criticalityLevel: 'medium' },

  // News
  { id: 'news_bloomberg', name: 'Bloomberg', category: 'news', weight: 0.08, expectedLatencyMs: 1000, expectedVolumePerHour: 100, criticalityLevel: 'high' },
  { id: 'news_reuters', name: 'Reuters', category: 'news', weight: 0.07, expectedLatencyMs: 1000, expectedVolumePerHour: 80, criticalityLevel: 'high' },
  { id: 'news_crypto_native', name: 'Crypto Native News', category: 'news', weight: 0.10, expectedLatencyMs: 2000, expectedVolumePerHour: 500, criticalityLevel: 'medium' },

  // On-chain
  { id: 'onchain_ethereum', name: 'Ethereum On-Chain', category: 'onchain', weight: 0.15, expectedLatencyMs: 15000, expectedVolumePerHour: 1000, criticalityLevel: 'critical' },
  { id: 'onchain_bitcoin', name: 'Bitcoin On-Chain', category: 'onchain', weight: 0.10, expectedLatencyMs: 600000, expectedVolumePerHour: 100, criticalityLevel: 'critical' },
  { id: 'onchain_solana', name: 'Solana On-Chain', category: 'onchain', weight: 0.05, expectedLatencyMs: 500, expectedVolumePerHour: 5000, criticalityLevel: 'high' },

  // Exchange
  { id: 'exchange_binance', name: 'Binance', category: 'exchange', weight: 0.10, expectedLatencyMs: 100, expectedVolumePerHour: 100000, criticalityLevel: 'critical' },
  { id: 'exchange_coinbase', name: 'Coinbase', category: 'exchange', weight: 0.08, expectedLatencyMs: 100, expectedVolumePerHour: 50000, criticalityLevel: 'high' },
  { id: 'exchange_derivatives', name: 'Derivatives', category: 'exchange', weight: 0.07, expectedLatencyMs: 100, expectedVolumePerHour: 80000, criticalityLevel: 'high' },

  // Developer
  { id: 'github', name: 'GitHub', category: 'developer', weight: 0.05, expectedLatencyMs: 60000, expectedVolumePerHour: 500, criticalityLevel: 'low' },
];

// =============================================================================
// QUALITY SCORER
// =============================================================================

export class DataQualityScorer {
  private sourceConfigs: Map<DataSourceId, DataSourceConfig>;
  private metrics: Map<DataSourceId, DataQualityMetrics>;
  private history: Map<DataSourceId, DataQualityMetrics[]>;
  private alerts: Map<string, QualityAlert>;
  private eventEmitter: EventEmitter;

  constructor() {
    this.sourceConfigs = new Map(DATA_SOURCES.map(s => [s.id, s]));
    this.metrics = new Map();
    this.history = new Map();
    this.alerts = new Map();
    this.eventEmitter = new EventEmitter();

    // Initialize metrics for all sources
    for (const source of DATA_SOURCES) {
      this.history.set(source.id, []);
    }
  }

  // ---------------------------------------------------------------------------
  // METRIC COLLECTION
  // ---------------------------------------------------------------------------

  /**
   * Update metrics for a data source
   */
  updateMetrics(sourceId: DataSourceId, rawMetrics: RawSourceMetrics): DataQualityMetrics {
    const config = this.sourceConfigs.get(sourceId);
    if (!config) {
      throw new Error(`Unknown data source: ${sourceId}`);
    }

    const timestamp = new Date();

    // Calculate availability
    const availability = this.calculateAvailability(rawMetrics, config);

    // Calculate freshness
    const freshness = this.calculateFreshness(rawMetrics, config);

    // Calculate volume
    const volume = this.calculateVolume(rawMetrics, config);

    // Calculate accuracy
    const accuracy = this.calculateAccuracy(rawMetrics);

    // Calculate reliability
    const reliability = this.calculateReliability(sourceId, availability);

    // Calculate overall score
    const overallScore = this.calculateOverallScore(
      availability,
      freshness,
      volume,
      accuracy,
      reliability
    );

    // Determine grade
    const qualityGrade = this.scoreToGrade(overallScore);

    // Check for alerts
    const alerts = this.checkAlerts(sourceId, {
      availability,
      freshness,
      volume,
      accuracy,
      reliability,
      overallScore,
    });

    const metrics: DataQualityMetrics = {
      sourceId,
      timestamp,
      availability,
      freshness,
      volume,
      accuracy,
      reliability,
      overallScore,
      qualityGrade,
      alerts,
    };

    // Store metrics
    this.metrics.set(sourceId, metrics);

    // Add to history
    const history = this.history.get(sourceId) || [];
    history.push(metrics);

    // Keep last 24 hours of history (hourly granularity)
    if (history.length > 24) {
      history.shift();
    }
    this.history.set(sourceId, history);

    // Emit events
    this.eventEmitter.emit('metrics_updated', metrics);
    for (const alert of alerts) {
      this.eventEmitter.emit('alert', alert);
    }

    return metrics;
  }

  // ---------------------------------------------------------------------------
  // METRIC CALCULATIONS
  // ---------------------------------------------------------------------------

  private calculateAvailability(
    raw: RawSourceMetrics,
    config: DataSourceConfig
  ): AvailabilityMetrics {
    const timeSinceLastSuccess = raw.lastSuccessAt
      ? Date.now() - raw.lastSuccessAt.getTime()
      : null;

    // Calculate uptime
    const uptime = raw.successCount / Math.max(1, raw.successCount + raw.failureCount);

    // Determine status
    let status: AvailabilityMetrics['status'] = 'healthy';
    if (timeSinceLastSuccess && timeSinceLastSuccess > config.expectedLatencyMs * 10) {
      status = 'down';
    } else if (uptime < 0.95 || raw.failuresLastHour > 5) {
      status = 'degraded';
    }

    return {
      uptime,
      status,
      lastSuccessAt: raw.lastSuccessAt,
      timeSinceLastSuccess,
      failuresLastHour: raw.failuresLastHour,
    };
  }

  private calculateFreshness(
    raw: RawSourceMetrics,
    config: DataSourceConfig
  ): FreshnessMetrics {
    const lagMs = raw.averageLatencyMs - config.expectedLatencyMs;
    const maxAcceptableAgeMs = config.expectedLatencyMs * 5;

    // Freshness score: 1.0 if on time, decreasing linearly to 0 at 5x expected latency
    const score = Math.max(0, 1 - (raw.averageLatencyMs / maxAcceptableAgeMs));

    return {
      averageAgeMs: raw.averageLatencyMs,
      maxAcceptableAgeMs,
      lagMs: Math.max(0, lagMs),
      score,
      isStale: raw.averageLatencyMs > maxAcceptableAgeMs,
    };
  }

  private calculateVolume(
    raw: RawSourceMetrics,
    config: DataSourceConfig
  ): VolumeMetrics {
    const volumeRatio = raw.volumeLastHour / config.expectedVolumePerHour;

    // Determine trend
    let trend: VolumeMetrics['trend'] = 'stable';
    if (raw.volumeTrend > 0.1) trend = 'increasing';
    else if (raw.volumeTrend < -0.1) trend = 'decreasing';

    // Check for anomaly (less than 50% or more than 200% of expected)
    const isAnomalous = volumeRatio < 0.5 || volumeRatio > 2.0;
    if (isAnomalous) trend = 'anomalous';

    return {
      lastHourVolume: raw.volumeLastHour,
      expectedVolume: config.expectedVolumePerHour,
      volumeRatio,
      trend,
      isAnomalous,
    };
  }

  private calculateAccuracy(raw: RawSourceMetrics): AccuracyMetrics {
    return {
      validationRate: 1 - raw.validationErrorRate,
      parseErrorRate: raw.parseErrorRate,
      duplicateRate: raw.duplicateRate,
      schemaCompliance: raw.schemaComplianceRate,
    };
  }

  private calculateReliability(
    sourceId: DataSourceId,
    currentAvailability: AvailabilityMetrics
  ): ReliabilityMetrics {
    const history = this.history.get(sourceId) || [];

    // Calculate historical reliability (30-day rolling, but we only keep 24h in memory)
    const historicalReliability = history.length > 0
      ? history.reduce((sum, m) => sum + m.availability.uptime, 0) / history.length
      : currentAvailability.uptime;

    // Recent reliability (last 3 data points)
    const recentHistory = history.slice(-3);
    const recentReliability = recentHistory.length > 0
      ? recentHistory.reduce((sum, m) => sum + m.availability.uptime, 0) / recentHistory.length
      : currentAvailability.uptime;

    // Determine trend
    let trend: ReliabilityMetrics['trend'] = 'stable';
    if (recentReliability > historicalReliability + 0.02) trend = 'improving';
    else if (recentReliability < historicalReliability - 0.02) trend = 'degrading';

    // Calculate MTBF and MTTR (simplified)
    const mtbf = currentAvailability.failuresLastHour > 0
      ? 60 / currentAvailability.failuresLastHour
      : 168; // Default to 1 week if no failures

    return {
      historicalReliability,
      recentReliability,
      trend,
      mtbf,
      mttr: 5, // Placeholder - would calculate from actual recovery times
    };
  }

  private calculateOverallScore(
    availability: AvailabilityMetrics,
    freshness: FreshnessMetrics,
    volume: VolumeMetrics,
    accuracy: AccuracyMetrics,
    reliability: ReliabilityMetrics
  ): number {
    // Weighted average of all metrics
    const weights = {
      availability: 0.25,
      freshness: 0.20,
      volume: 0.15,
      accuracy: 0.20,
      reliability: 0.20,
    };

    const availabilityScore = availability.uptime;
    const volumeScore = Math.min(1, Math.max(0, volume.volumeRatio));
    const accuracyScore = (accuracy.validationRate + accuracy.schemaCompliance) / 2;

    return (
      weights.availability * availabilityScore +
      weights.freshness * freshness.score +
      weights.volume * volumeScore +
      weights.accuracy * accuracyScore +
      weights.reliability * reliability.recentReliability
    );
  }

  private scoreToGrade(score: number): QualityGrade {
    if (score >= 0.95) return 'A';
    if (score >= 0.85) return 'B';
    if (score >= 0.70) return 'C';
    if (score >= 0.50) return 'D';
    return 'F';
  }

  // ---------------------------------------------------------------------------
  // ALERT MANAGEMENT
  // ---------------------------------------------------------------------------

  private checkAlerts(
    sourceId: DataSourceId,
    metrics: {
      availability: AvailabilityMetrics;
      freshness: FreshnessMetrics;
      volume: VolumeMetrics;
      accuracy: AccuracyMetrics;
      reliability: ReliabilityMetrics;
      overallScore: number;
    }
  ): QualityAlert[] {
    const alerts: QualityAlert[] = [];
    const config = this.sourceConfigs.get(sourceId)!;

    // Source down alert
    if (metrics.availability.status === 'down') {
      alerts.push(this.createAlert(sourceId, 'critical', 'source_down', `${config.name} is down`, {
        timeSinceLastSuccess: metrics.availability.timeSinceLastSuccess,
      }));
    }

    // High latency alert
    if (metrics.freshness.lagMs > config.expectedLatencyMs * 3) {
      alerts.push(this.createAlert(sourceId, 'warning', 'high_latency', `${config.name} experiencing high latency`, {
        currentLatency: metrics.freshness.averageAgeMs,
        expectedLatency: config.expectedLatencyMs,
      }));
    }

    // Stale data alert
    if (metrics.freshness.isStale) {
      alerts.push(this.createAlert(sourceId, 'warning', 'stale_data', `${config.name} data is stale`, {
        dataAge: metrics.freshness.averageAgeMs,
        maxAcceptable: metrics.freshness.maxAcceptableAgeMs,
      }));
    }

    // Volume anomaly alert
    if (metrics.volume.isAnomalous) {
      const severity = metrics.volume.volumeRatio < 0.3 ? 'critical' : 'warning';
      alerts.push(this.createAlert(sourceId, severity, 'volume_anomaly', `${config.name} volume anomaly detected`, {
        actualVolume: metrics.volume.lastHourVolume,
        expectedVolume: metrics.volume.expectedVolume,
        ratio: metrics.volume.volumeRatio,
      }));
    }

    // Error spike alert
    if (metrics.accuracy.parseErrorRate > 0.05 || metrics.accuracy.validationRate < 0.9) {
      alerts.push(this.createAlert(sourceId, 'warning', 'error_spike', `${config.name} error rate elevated`, {
        parseErrorRate: metrics.accuracy.parseErrorRate,
        validationRate: metrics.accuracy.validationRate,
      }));
    }

    // Quality degradation alert
    if (metrics.reliability.trend === 'degrading' && metrics.overallScore < 0.7) {
      alerts.push(this.createAlert(sourceId, 'warning', 'quality_degradation', `${config.name} quality is degrading`, {
        currentScore: metrics.overallScore,
        trend: metrics.reliability.trend,
      }));
    }

    return alerts;
  }

  private createAlert(
    sourceId: DataSourceId,
    severity: QualityAlert['severity'],
    type: QualityAlertType,
    message: string,
    metadata: Record<string, any>
  ): QualityAlert {
    const id = `alert_${sourceId}_${type}_${Date.now()}`;

    const alert: QualityAlert = {
      id,
      sourceId,
      severity,
      type,
      message,
      triggeredAt: new Date(),
      metadata,
    };

    this.alerts.set(id, alert);
    return alert;
  }

  /**
   * Resolve an alert
   */
  resolveAlert(alertId: string): void {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.resolvedAt = new Date();
      this.eventEmitter.emit('alert_resolved', alert);
    }
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  /**
   * Get metrics for a specific source
   */
  getSourceMetrics(sourceId: DataSourceId): DataQualityMetrics | null {
    return this.metrics.get(sourceId) || null;
  }

  /**
   * Get all source metrics
   */
  getAllSourceMetrics(): DataQualityMetrics[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Get aggregate quality metrics
   */
  getAggregateMetrics(): AggregateQualityMetrics {
    const allMetrics = this.getAllSourceMetrics();
    const now = new Date();

    let totalScore = 0;
    let healthySources = 0;
    let degradedSources = 0;
    let downSources = 0;

    const byCategory: Record<string, CategoryQualityMetrics> = {};

    for (const metrics of allMetrics) {
      const config = this.sourceConfigs.get(metrics.sourceId)!;

      // Count by status
      switch (metrics.availability.status) {
        case 'healthy': healthySources++; break;
        case 'degraded': degradedSources++; break;
        case 'down': downSources++; break;
      }

      // Weighted score
      totalScore += metrics.overallScore * config.weight;

      // By category
      if (!byCategory[config.category]) {
        byCategory[config.category] = {
          category: config.category,
          score: 0,
          grade: 'A',
          sourceCount: 0,
          healthyCount: 0,
        };
      }

      const cat = byCategory[config.category];
      cat.sourceCount++;
      cat.score += metrics.overallScore;
      if (metrics.availability.status === 'healthy') cat.healthyCount++;
    }

    // Calculate category averages
    for (const cat of Object.values(byCategory)) {
      cat.score = cat.score / cat.sourceCount;
      cat.grade = this.scoreToGrade(cat.score);
    }

    // Normalize total score
    const totalWeight = Array.from(this.sourceConfigs.values())
      .reduce((sum, c) => sum + c.weight, 0);
    const overallScore = totalScore / totalWeight;

    return {
      timestamp: now,
      overallScore,
      overallGrade: this.scoreToGrade(overallScore),
      sourceCount: allMetrics.length,
      healthySources,
      degradedSources,
      downSources,
      byCategory,
      activeAlerts: Array.from(this.alerts.values()).filter(a => !a.resolvedAt),
    };
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): QualityAlert[] {
    return Array.from(this.alerts.values()).filter(a => !a.resolvedAt);
  }

  /**
   * Get historical metrics for a source
   */
  getSourceHistory(sourceId: DataSourceId): DataQualityMetrics[] {
    return this.history.get(sourceId) || [];
  }

  /**
   * Subscribe to events
   */
  on(event: 'metrics_updated' | 'alert' | 'alert_resolved', listener: (data: any) => void): void {
    this.eventEmitter.on(event, listener);
  }
}

// =============================================================================
// RAW METRICS INPUT
// =============================================================================

export interface RawSourceMetrics {
  successCount: number;
  failureCount: number;
  lastSuccessAt: Date | null;
  failuresLastHour: number;
  averageLatencyMs: number;
  volumeLastHour: number;
  volumeTrend: number; // -1 to 1
  validationErrorRate: number;
  parseErrorRate: number;
  duplicateRate: number;
  schemaComplianceRate: number;
}

// =============================================================================
// API ROUTES
// =============================================================================

import { Router, Request, Response } from 'express';

export function createDataQualityRoutes(scorer: DataQualityScorer): Router {
  const router = Router();

  // Get aggregate quality metrics
  router.get('/quality', (_req: Request, res: Response) => {
    const metrics = scorer.getAggregateMetrics();
    res.json(metrics);
  });

  // Get all source metrics
  router.get('/quality/sources', (_req: Request, res: Response) => {
    const metrics = scorer.getAllSourceMetrics();
    res.json({
      sources: metrics.map(m => ({
        source_id: m.sourceId,
        score: m.overallScore,
        grade: m.qualityGrade,
        status: m.availability.status,
        freshness_score: m.freshness.score,
        volume_ratio: m.volume.volumeRatio,
        alerts_count: m.alerts.length,
      })),
    });
  });

  // Get specific source metrics
  router.get('/quality/sources/:sourceId', (req: Request, res: Response) => {
    const metrics = scorer.getSourceMetrics(req.params.sourceId as DataSourceId);

    if (!metrics) {
      res.status(404).json({
        error: {
          code: 'SOURCE_NOT_FOUND',
          message: `Source ${req.params.sourceId} not found`,
        },
      });
      return;
    }

    res.json(metrics);
  });

  // Get source history
  router.get('/quality/sources/:sourceId/history', (req: Request, res: Response) => {
    const history = scorer.getSourceHistory(req.params.sourceId as DataSourceId);
    res.json({
      source_id: req.params.sourceId,
      data_points: history.length,
      history: history.map(m => ({
        timestamp: m.timestamp,
        score: m.overallScore,
        grade: m.qualityGrade,
        status: m.availability.status,
      })),
    });
  });

  // Get active alerts
  router.get('/quality/alerts', (_req: Request, res: Response) => {
    const alerts = scorer.getActiveAlerts();
    res.json({
      count: alerts.length,
      alerts,
    });
  });

  return router;
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  DataQualityScorer,
  DATA_SOURCES,
  createDataQualityRoutes,
};
