/**
 * NLP Model Versioning System
 * Institutional-Grade Cryptocurrency Market Sentiment Analysis API
 *
 * Provides:
 * - Semantic versioning for NLP models
 * - Parallel model execution for validation
 * - Deprecation policy enforcement
 * - Model performance tracking
 * - A/B testing support
 */

import { EventEmitter } from 'events';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

export interface ModelVersion {
  /** Semantic version (e.g., "2.1.0") */
  version: string;
  /** Major version number */
  major: number;
  /** Minor version number */
  minor: number;
  /** Patch version number */
  patch: number;
  /** Model identifier */
  modelId: string;
  /** Human-readable name */
  name: string;
  /** Release date */
  releasedAt: Date;
  /** Deprecation date (if deprecated) */
  deprecatedAt?: Date;
  /** End-of-life date (if scheduled) */
  endOfLifeAt?: Date;
  /** Model status */
  status: ModelStatus;
  /** Changelog for this version */
  changelog: ChangelogEntry[];
  /** Performance metrics */
  metrics: ModelMetrics;
  /** Configuration hash for reproducibility */
  configHash: string;
  /** Training data cutoff date */
  trainingDataCutoff: Date;
  /** Supported languages */
  supportedLanguages: string[];
  /** Model artifact location */
  artifactPath: string;
}

export type ModelStatus =
  | 'development'   // In development, not available
  | 'beta'          // Available for testing
  | 'stable'        // Production ready
  | 'deprecated'    // Still available but discouraged
  | 'end_of_life';  // No longer available

export interface ChangelogEntry {
  type: 'feature' | 'improvement' | 'fix' | 'breaking' | 'security';
  description: string;
  impactLevel: 'low' | 'medium' | 'high';
}

export interface ModelMetrics {
  /** Accuracy on validation set */
  accuracy: number;
  /** F1 score */
  f1Score: number;
  /** Information coefficient vs. forward returns */
  informationCoefficient: {
    horizon_1h: number;
    horizon_4h: number;
    horizon_24h: number;
    horizon_7d: number;
  };
  /** Signal decay half-life in hours */
  signalHalfLife: number;
  /** Average inference latency in ms */
  inferenceLatencyMs: number;
  /** Backtested Sharpe ratio */
  backtestSharpe: number;
  /** Last validation date */
  lastValidated: Date;
}

export interface DeprecationPolicy {
  /** Days of notice before deprecation */
  noticePeriodsdays: number;
  /** Days deprecated version remains available */
  deprecationPeriodDays: number;
  /** Whether parallel running is required during transition */
  parallelRunningRequired: boolean;
  /** Minimum parallel running period in days */
  minParallelRunningDays: number;
}

export interface ModelPrediction {
  version: string;
  modelId: string;
  timestamp: Date;
  input: any;
  output: SentimentOutput;
  latencyMs: number;
  confidence: number;
}

export interface SentimentOutput {
  score: number;
  confidence: number;
  decomposition: Record<string, number>;
  metadata: Record<string, any>;
}

export interface ParallelRunResult {
  primary: ModelPrediction;
  shadow: ModelPrediction;
  divergence: number;
  divergenceThresholdExceeded: boolean;
}

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

export const DEFAULT_DEPRECATION_POLICY: DeprecationPolicy = {
  noticePeriodsdays: 90,
  deprecationPeriodDays: 90,
  parallelRunningRequired: true,
  minParallelRunningDays: 30,
};

// =============================================================================
// MODEL VERSION REGISTRY
// =============================================================================

export class ModelVersionRegistry {
  private versions: Map<string, ModelVersion> = new Map();
  private currentVersion: string | null = null;
  private deprecationPolicy: DeprecationPolicy;
  private eventEmitter: EventEmitter;

  constructor(deprecationPolicy: DeprecationPolicy = DEFAULT_DEPRECATION_POLICY) {
    this.deprecationPolicy = deprecationPolicy;
    this.eventEmitter = new EventEmitter();
  }

  // ---------------------------------------------------------------------------
  // VERSION MANAGEMENT
  // ---------------------------------------------------------------------------

  /**
   * Register a new model version
   */
  registerVersion(version: ModelVersion): void {
    const versionKey = version.version;

    if (this.versions.has(versionKey)) {
      throw new Error(`Version ${versionKey} already registered`);
    }

    // Validate semantic version
    const parsed = this.parseVersion(versionKey);
    version.major = parsed.major;
    version.minor = parsed.minor;
    version.patch = parsed.patch;

    this.versions.set(versionKey, version);
    this.eventEmitter.emit('version_registered', version);
  }

  /**
   * Get a specific version
   */
  getVersion(version: string): ModelVersion | undefined {
    return this.versions.get(version);
  }

  /**
   * Get current production version
   */
  getCurrentVersion(): ModelVersion | null {
    if (!this.currentVersion) return null;
    return this.versions.get(this.currentVersion) || null;
  }

  /**
   * Get all available versions
   */
  getAllVersions(): ModelVersion[] {
    return Array.from(this.versions.values())
      .filter(v => v.status !== 'end_of_life')
      .sort((a, b) => this.compareVersions(b.version, a.version));
  }

  /**
   * Get stable versions only
   */
  getStableVersions(): ModelVersion[] {
    return this.getAllVersions().filter(v => v.status === 'stable');
  }

  /**
   * Set current production version
   */
  setCurrentVersion(version: string): void {
    const modelVersion = this.versions.get(version);
    if (!modelVersion) {
      throw new Error(`Version ${version} not found`);
    }
    if (modelVersion.status !== 'stable') {
      throw new Error(`Cannot set non-stable version ${version} as current`);
    }

    const previousVersion = this.currentVersion;
    this.currentVersion = version;

    this.eventEmitter.emit('current_version_changed', {
      previous: previousVersion,
      current: version,
    });
  }

  // ---------------------------------------------------------------------------
  // DEPRECATION MANAGEMENT
  // ---------------------------------------------------------------------------

  /**
   * Deprecate a version with proper notice
   */
  deprecateVersion(version: string, reason: string): DeprecationNotice {
    const modelVersion = this.versions.get(version);
    if (!modelVersion) {
      throw new Error(`Version ${version} not found`);
    }

    const now = new Date();
    const deprecationDate = new Date(now);
    deprecationDate.setDate(deprecationDate.getDate() + this.deprecationPolicy.noticePeriodsdays);

    const endOfLifeDate = new Date(deprecationDate);
    endOfLifeDate.setDate(endOfLifeDate.getDate() + this.deprecationPolicy.deprecationPeriodDays);

    modelVersion.status = 'deprecated';
    modelVersion.deprecatedAt = deprecationDate;
    modelVersion.endOfLifeAt = endOfLifeDate;

    const notice: DeprecationNotice = {
      version,
      reason,
      announcedAt: now,
      deprecatedAt: deprecationDate,
      endOfLifeAt: endOfLifeDate,
      migrationGuide: this.generateMigrationGuide(version),
      parallelRunningRequired: this.deprecationPolicy.parallelRunningRequired,
    };

    this.eventEmitter.emit('version_deprecated', notice);
    return notice;
  }

  /**
   * Check if a version is deprecated
   */
  isDeprecated(version: string): boolean {
    const modelVersion = this.versions.get(version);
    return modelVersion?.status === 'deprecated' || modelVersion?.status === 'end_of_life';
  }

  /**
   * Get deprecation status for a version
   */
  getDeprecationStatus(version: string): DeprecationStatus | null {
    const modelVersion = this.versions.get(version);
    if (!modelVersion || !modelVersion.deprecatedAt) {
      return null;
    }

    const now = new Date();
    const daysUntilDeprecation = Math.ceil(
      (modelVersion.deprecatedAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    const daysUntilEol = modelVersion.endOfLifeAt
      ? Math.ceil((modelVersion.endOfLifeAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    return {
      version,
      status: modelVersion.status,
      deprecatedAt: modelVersion.deprecatedAt,
      endOfLifeAt: modelVersion.endOfLifeAt,
      daysUntilDeprecation: Math.max(0, daysUntilDeprecation),
      daysUntilEol: daysUntilEol ? Math.max(0, daysUntilEol) : null,
      recommendedVersion: this.getRecommendedUpgrade(version),
    };
  }

  /**
   * Get recommended upgrade path
   */
  getRecommendedUpgrade(fromVersion: string): string | null {
    const current = this.versions.get(fromVersion);
    if (!current) return null;

    // Find the latest stable version with the same major version
    const sameMajor = this.getStableVersions()
      .filter(v => v.major === current.major && this.compareVersions(v.version, fromVersion) > 0);

    if (sameMajor.length > 0) {
      return sameMajor[0].version;
    }

    // Otherwise, recommend latest stable
    const stable = this.getStableVersions();
    return stable.length > 0 ? stable[0].version : null;
  }

  // ---------------------------------------------------------------------------
  // VERSION COMPARISON
  // ---------------------------------------------------------------------------

  private parseVersion(version: string): { major: number; minor: number; patch: number } {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!match) {
      throw new Error(`Invalid version format: ${version}`);
    }
    return {
      major: parseInt(match[1]),
      minor: parseInt(match[2]),
      patch: parseInt(match[3]),
    };
  }

  private compareVersions(a: string, b: string): number {
    const vA = this.parseVersion(a);
    const vB = this.parseVersion(b);

    if (vA.major !== vB.major) return vA.major - vB.major;
    if (vA.minor !== vB.minor) return vA.minor - vB.minor;
    return vA.patch - vB.patch;
  }

  // ---------------------------------------------------------------------------
  // MIGRATION GUIDE GENERATION
  // ---------------------------------------------------------------------------

  private generateMigrationGuide(fromVersion: string): string {
    const recommended = this.getRecommendedUpgrade(fromVersion);
    return `
# Migration Guide: ${fromVersion} → ${recommended || 'latest'}

## Overview
Version ${fromVersion} is being deprecated. Please migrate to ${recommended || 'the latest version'}.

## Migration Steps
1. Review the changelog for breaking changes
2. Update your API client to request the new version
3. Run parallel validation during the transition period
4. Monitor for any divergence in sentiment outputs
5. Complete migration before end-of-life date

## API Changes
Include \`X-Model-Version: ${recommended}\` header in requests to use the new version.

## Support
Contact support@sentiment-api.io for migration assistance.
    `.trim();
  }

  // ---------------------------------------------------------------------------
  // EVENT HANDLING
  // ---------------------------------------------------------------------------

  on(event: string, listener: (...args: any[]) => void): void {
    this.eventEmitter.on(event, listener);
  }

  off(event: string, listener: (...args: any[]) => void): void {
    this.eventEmitter.off(event, listener);
  }
}

// =============================================================================
// DEPRECATION TYPES
// =============================================================================

export interface DeprecationNotice {
  version: string;
  reason: string;
  announcedAt: Date;
  deprecatedAt: Date;
  endOfLifeAt: Date;
  migrationGuide: string;
  parallelRunningRequired: boolean;
}

export interface DeprecationStatus {
  version: string;
  status: ModelStatus;
  deprecatedAt: Date;
  endOfLifeAt?: Date;
  daysUntilDeprecation: number;
  daysUntilEol: number | null;
  recommendedVersion: string | null;
}

// =============================================================================
// PARALLEL MODEL RUNNER
// =============================================================================

export class ParallelModelRunner {
  private registry: ModelVersionRegistry;
  private divergenceThreshold: number;
  private eventEmitter: EventEmitter;

  constructor(registry: ModelVersionRegistry, divergenceThreshold: number = 0.1) {
    this.registry = registry;
    this.divergenceThreshold = divergenceThreshold;
    this.eventEmitter = new EventEmitter();
  }

  /**
   * Run prediction on both primary and shadow models
   */
  async runParallel(
    input: any,
    primaryVersion: string,
    shadowVersion: string,
    modelExecutor: ModelExecutor
  ): Promise<ParallelRunResult> {
    const [primaryResult, shadowResult] = await Promise.all([
      this.runModel(input, primaryVersion, modelExecutor),
      this.runModel(input, shadowVersion, modelExecutor),
    ]);

    const divergence = this.calculateDivergence(primaryResult.output, shadowResult.output);
    const divergenceThresholdExceeded = divergence > this.divergenceThreshold;

    const result: ParallelRunResult = {
      primary: primaryResult,
      shadow: shadowResult,
      divergence,
      divergenceThresholdExceeded,
    };

    if (divergenceThresholdExceeded) {
      this.eventEmitter.emit('divergence_alert', result);
    }

    return result;
  }

  private async runModel(
    input: any,
    version: string,
    executor: ModelExecutor
  ): Promise<ModelPrediction> {
    const modelVersion = this.registry.getVersion(version);
    if (!modelVersion) {
      throw new Error(`Model version ${version} not found`);
    }

    const startTime = Date.now();
    const output = await executor.execute(input, modelVersion);
    const latencyMs = Date.now() - startTime;

    return {
      version,
      modelId: modelVersion.modelId,
      timestamp: new Date(),
      input,
      output,
      latencyMs,
      confidence: output.confidence,
    };
  }

  private calculateDivergence(a: SentimentOutput, b: SentimentOutput): number {
    // Calculate normalized divergence between two outputs
    const scoreDiff = Math.abs(a.score - b.score);
    const confidenceDiff = Math.abs(a.confidence - b.confidence);

    // Weighted average of differences
    return scoreDiff * 0.7 + confidenceDiff * 0.3;
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.eventEmitter.on(event, listener);
  }
}

export interface ModelExecutor {
  execute(input: any, version: ModelVersion): Promise<SentimentOutput>;
}

// =============================================================================
// MODEL VERSION MIDDLEWARE
// =============================================================================

import { Request, Response, NextFunction } from 'express';

export interface VersionMiddlewareOptions {
  registry: ModelVersionRegistry;
  headerName: string;
  allowBeta: boolean;
  warnOnDeprecated: boolean;
}

export function createModelVersionMiddleware(options: VersionMiddlewareOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestedVersion = req.headers[options.headerName.toLowerCase()] as string;

    let version: ModelVersion | null;

    if (requestedVersion) {
      version = options.registry.getVersion(requestedVersion) || null;

      if (!version) {
        res.status(400).json({
          error: {
            code: 'INVALID_MODEL_VERSION',
            message: `Model version ${requestedVersion} not found`,
            availableVersions: options.registry.getStableVersions().map(v => v.version),
          },
        });
        return;
      }

      if (version.status === 'beta' && !options.allowBeta) {
        res.status(400).json({
          error: {
            code: 'BETA_VERSION_NOT_ALLOWED',
            message: `Beta version ${requestedVersion} is not available for production use`,
          },
        });
        return;
      }

      if (version.status === 'end_of_life') {
        res.status(410).json({
          error: {
            code: 'VERSION_END_OF_LIFE',
            message: `Model version ${requestedVersion} has reached end-of-life`,
            recommendedVersion: options.registry.getRecommendedUpgrade(requestedVersion),
          },
        });
        return;
      }

      // Warn on deprecated
      if (version.status === 'deprecated' && options.warnOnDeprecated) {
        const status = options.registry.getDeprecationStatus(requestedVersion);
        res.setHeader('X-Model-Version-Warning', 'deprecated');
        res.setHeader('X-Model-Version-Deprecated-At', version.deprecatedAt?.toISOString() || '');
        res.setHeader('X-Model-Version-EOL-At', version.endOfLifeAt?.toISOString() || '');
        res.setHeader('X-Model-Version-Recommended', status?.recommendedVersion || '');
      }
    } else {
      // Use current version
      version = options.registry.getCurrentVersion();
    }

    if (!version) {
      res.status(500).json({
        error: {
          code: 'NO_MODEL_VERSION',
          message: 'No model version available',
        },
      });
      return;
    }

    // Attach version to request
    (req as any).modelVersion = version;
    res.setHeader('X-Model-Version', version.version);

    next();
  };
}

// =============================================================================
// API ENDPOINTS FOR VERSION MANAGEMENT
// =============================================================================

export function createVersionRoutes(registry: ModelVersionRegistry) {
  const router = require('express').Router();

  // Get all versions
  router.get('/versions', (req: Request, res: Response) => {
    const includeDeprecated = req.query.include_deprecated === 'true';
    const versions = includeDeprecated
      ? registry.getAllVersions()
      : registry.getStableVersions();

    res.json({
      versions: versions.map(v => ({
        version: v.version,
        status: v.status,
        releasedAt: v.releasedAt,
        deprecatedAt: v.deprecatedAt,
        endOfLifeAt: v.endOfLifeAt,
        supportedLanguages: v.supportedLanguages,
      })),
      currentVersion: registry.getCurrentVersion()?.version,
    });
  });

  // Get specific version details
  router.get('/versions/:version', (req: Request, res: Response) => {
    const version = registry.getVersion(req.params.version);

    if (!version) {
      res.status(404).json({
        error: {
          code: 'VERSION_NOT_FOUND',
          message: `Version ${req.params.version} not found`,
        },
      });
      return;
    }

    const deprecationStatus = registry.getDeprecationStatus(req.params.version);

    res.json({
      version: version.version,
      modelId: version.modelId,
      name: version.name,
      status: version.status,
      releasedAt: version.releasedAt,
      deprecatedAt: version.deprecatedAt,
      endOfLifeAt: version.endOfLifeAt,
      changelog: version.changelog,
      metrics: version.metrics,
      supportedLanguages: version.supportedLanguages,
      trainingDataCutoff: version.trainingDataCutoff,
      deprecationStatus,
      migrationGuide: deprecationStatus
        ? registry.getRecommendedUpgrade(req.params.version)
        : null,
    });
  });

  // Get changelog between versions
  router.get('/versions/:from/changelog/:to', (req: Request, res: Response) => {
    const fromVersion = registry.getVersion(req.params.from);
    const toVersion = registry.getVersion(req.params.to);

    if (!fromVersion || !toVersion) {
      res.status(404).json({
        error: {
          code: 'VERSION_NOT_FOUND',
          message: 'One or both versions not found',
        },
      });
      return;
    }

    // Aggregate changelog entries between versions
    const allVersions = registry.getAllVersions();
    const changelog: ChangelogEntry[] = [];

    for (const v of allVersions) {
      if (
        registry['compareVersions'](v.version, req.params.from) > 0 &&
        registry['compareVersions'](v.version, req.params.to) <= 0
      ) {
        changelog.push(...v.changelog);
      }
    }

    res.json({
      from: req.params.from,
      to: req.params.to,
      changelog,
      breakingChanges: changelog.filter(c => c.type === 'breaking'),
    });
  });

  return router;
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  ModelVersionRegistry,
  ParallelModelRunner,
  createModelVersionMiddleware,
  createVersionRoutes,
  DEFAULT_DEPRECATION_POLICY,
};
