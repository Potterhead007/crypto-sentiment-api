/**
 * Schema Versioning Strategy
 * Institutional-Grade Cryptocurrency Market Sentiment Analysis API
 *
 * Provides:
 * - Semantic versioning for API schemas
 * - Backward compatibility management
 * - Schema migration utilities
 * - Version negotiation
 * - Deprecation handling
 */

import { Request, Response, NextFunction, Router } from 'express';
import { z } from 'zod';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

export interface SchemaVersion {
  /** Semantic version (e.g., "2.1.0") */
  version: string;
  /** Major version */
  major: number;
  /** Minor version */
  minor: number;
  /** Patch version */
  patch: number;
  /** Release date */
  releasedAt: Date;
  /** Deprecation date (if deprecated) */
  deprecatedAt?: Date;
  /** End-of-life date */
  endOfLifeAt?: Date;
  /** Status */
  status: 'current' | 'supported' | 'deprecated' | 'end_of_life';
  /** Schema definition */
  schema: z.ZodSchema;
  /** Changelog */
  changelog: SchemaChangelogEntry[];
  /** Breaking changes from previous version */
  breakingChanges: BreakingChange[];
}

export interface SchemaChangelogEntry {
  type: 'added' | 'changed' | 'deprecated' | 'removed' | 'fixed';
  field: string;
  description: string;
  migrationRequired: boolean;
}

export interface BreakingChange {
  field: string;
  change: 'removed' | 'type_changed' | 'required_changed' | 'format_changed';
  previousType?: string;
  newType?: string;
  migrationPath: string;
}

export interface VersionNegotiationResult {
  requestedVersion: string | null;
  resolvedVersion: string;
  isExactMatch: boolean;
  warnings: string[];
}

export interface SchemaTransformer {
  fromVersion: string;
  toVersion: string;
  transform: (data: any) => any;
}

// =============================================================================
// SCHEMA DEFINITIONS BY VERSION
// =============================================================================

/**
 * Schema v1.0.0 - Initial release
 */
const SentimentResponseV1 = z.object({
  asset: z.string(),
  timestamp: z.string().datetime(),
  sentiment_score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
});

/**
 * Schema v2.0.0 - Added decomposition and dynamics
 */
const SentimentResponseV2 = z.object({
  asset: z.string(),
  timestamp: z.string().datetime(),
  sentiment_score: z.object({
    composite: z.number().min(0).max(1),
    scale: z.literal('0-1 normalized'),
    methodology_version: z.string(),
  }),
  confidence: z.object({
    level: z.number().min(0).max(1),
    interval_95: z.tuple([z.number(), z.number()]),
    interval_99: z.tuple([z.number(), z.number()]).optional(),
    methodology: z.string(),
  }),
  decomposition: z.object({
    social: z.object({ score: z.number(), weight: z.number() }),
    news: z.object({ score: z.number(), weight: z.number() }),
    on_chain: z.object({ score: z.number(), weight: z.number() }),
    microstructure: z.object({ score: z.number(), weight: z.number() }),
  }),
});

/**
 * Schema v2.1.0 - Added dynamics, divergence, percentiles
 */
const SentimentResponseV2_1 = z.object({
  asset: z.string(),
  timestamp: z.string().datetime(),
  timestamp_captured: z.string().datetime(),

  sentiment_score: z.object({
    composite: z.number().min(0).max(1),
    scale: z.literal('0-1 normalized'),
    methodology_version: z.string(),
  }),

  confidence: z.object({
    level: z.number().min(0).max(1),
    interval_95: z.tuple([z.number(), z.number()]),
    interval_99: z.tuple([z.number(), z.number()]),
    methodology: z.enum(['bootstrap_ensemble', 'bca_bootstrap_ensemble']),
  }),

  decomposition: z.object({
    social: z.object({ score: z.number(), weight: z.number(), source_count: z.number() }),
    news: z.object({ score: z.number(), weight: z.number(), source_count: z.number() }),
    on_chain: z.object({ score: z.number(), weight: z.number(), source_count: z.number() }),
    microstructure: z.object({ score: z.number(), weight: z.number(), source_count: z.number() }),
    developer: z.object({ score: z.number(), weight: z.number(), source_count: z.number() }).optional(),
  }),

  dynamics: z.object({
    velocity_1h: z.number(),
    velocity_24h: z.number(),
    acceleration: z.number(),
    momentum: z.enum(['increasing', 'stable', 'decreasing']),
  }),

  divergence: z.object({
    cross_source: z.number(),
    social_vs_onchain: z.number(),
    retail_vs_whale: z.number().optional(),
    alert_level: z.enum(['low', 'moderate', 'high', 'critical']),
  }),

  percentiles: z.object({
    '7d': z.number().int().min(0).max(100),
    '30d': z.number().int().min(0).max(100),
    '90d': z.number().int().min(0).max(100),
    '365d': z.number().int().min(0).max(100),
    all_time: z.number().int().min(0).max(100),
  }),

  regime_context: z.object({
    current_regime: z.enum(['risk_on', 'accumulation', 'distribution', 'capitulation', 'crab']),
    regime_confidence: z.number().min(0).max(1),
    regime_duration_days: z.number().int(),
  }).optional(),

  quality_indicators: z.object({
    data_completeness: z.number().min(0).max(1),
    source_reliability: z.number().min(0).max(1),
    model_confidence: z.number().min(0).max(1),
    freshness_ms: z.number().int(),
  }),
});

// =============================================================================
// SCHEMA VERSION REGISTRY
// =============================================================================

export class SchemaVersionRegistry {
  private versions: Map<string, SchemaVersion> = new Map();
  private transformers: SchemaTransformer[] = [];
  private currentVersion: string = '2.1.0';

  constructor() {
    this.initializeVersions();
    this.initializeTransformers();
  }

  private initializeVersions(): void {
    // Version 1.0.0
    this.versions.set('1.0.0', {
      version: '1.0.0',
      major: 1,
      minor: 0,
      patch: 0,
      releasedAt: new Date('2025-03-01'),
      deprecatedAt: new Date('2025-09-01'),
      endOfLifeAt: new Date('2026-03-01'),
      status: 'deprecated',
      schema: SentimentResponseV1,
      changelog: [
        { type: 'added', field: '*', description: 'Initial release', migrationRequired: false },
      ],
      breakingChanges: [],
    });

    // Version 2.0.0
    this.versions.set('2.0.0', {
      version: '2.0.0',
      major: 2,
      minor: 0,
      patch: 0,
      releasedAt: new Date('2025-09-01'),
      deprecatedAt: new Date('2026-06-01'),
      status: 'supported',
      schema: SentimentResponseV2,
      changelog: [
        { type: 'changed', field: 'sentiment_score', description: 'Changed from number to object with metadata', migrationRequired: true },
        { type: 'changed', field: 'confidence', description: 'Changed from number to object with intervals', migrationRequired: true },
        { type: 'added', field: 'decomposition', description: 'Added source decomposition', migrationRequired: false },
      ],
      breakingChanges: [
        { field: 'sentiment_score', change: 'type_changed', previousType: 'number', newType: 'object', migrationPath: 'Use sentiment_score.composite for the numeric value' },
        { field: 'confidence', change: 'type_changed', previousType: 'number', newType: 'object', migrationPath: 'Use confidence.level for the numeric value' },
      ],
    });

    // Version 2.1.0 (Current)
    this.versions.set('2.1.0', {
      version: '2.1.0',
      major: 2,
      minor: 1,
      patch: 0,
      releasedAt: new Date('2026-01-19'),
      status: 'current',
      schema: SentimentResponseV2_1,
      changelog: [
        { type: 'added', field: 'timestamp_captured', description: 'Added capture timestamp for latency tracking', migrationRequired: false },
        { type: 'added', field: 'dynamics', description: 'Added velocity and momentum metrics', migrationRequired: false },
        { type: 'added', field: 'divergence', description: 'Added cross-source divergence indicators', migrationRequired: false },
        { type: 'added', field: 'percentiles', description: 'Added historical percentile rankings', migrationRequired: false },
        { type: 'added', field: 'regime_context', description: 'Added market regime classification', migrationRequired: false },
        { type: 'added', field: 'quality_indicators', description: 'Added data quality metrics', migrationRequired: false },
        { type: 'added', field: 'decomposition.*.source_count', description: 'Added source counts to decomposition', migrationRequired: false },
        { type: 'added', field: 'confidence.interval_99', description: 'Made 99% CI required', migrationRequired: false },
      ],
      breakingChanges: [],
    });
  }

  private initializeTransformers(): void {
    // v2.1.0 -> v2.0.0 (downgrade)
    this.transformers.push({
      fromVersion: '2.1.0',
      toVersion: '2.0.0',
      transform: (data: any) => ({
        asset: data.asset,
        timestamp: data.timestamp,
        sentiment_score: {
          composite: data.sentiment_score.composite,
          scale: data.sentiment_score.scale,
          methodology_version: data.sentiment_score.methodology_version,
        },
        confidence: {
          level: data.confidence.level,
          interval_95: data.confidence.interval_95,
          interval_99: data.confidence.interval_99,
          methodology: data.confidence.methodology,
        },
        decomposition: {
          social: { score: data.decomposition.social.score, weight: data.decomposition.social.weight },
          news: { score: data.decomposition.news.score, weight: data.decomposition.news.weight },
          on_chain: { score: data.decomposition.on_chain.score, weight: data.decomposition.on_chain.weight },
          microstructure: { score: data.decomposition.microstructure.score, weight: data.decomposition.microstructure.weight },
        },
      }),
    });

    // v2.0.0 -> v1.0.0 (downgrade)
    this.transformers.push({
      fromVersion: '2.0.0',
      toVersion: '1.0.0',
      transform: (data: any) => ({
        asset: data.asset,
        timestamp: data.timestamp,
        sentiment_score: data.sentiment_score.composite,
        confidence: data.confidence.level,
      }),
    });

    // v2.1.0 -> v1.0.0 (downgrade, chained)
    this.transformers.push({
      fromVersion: '2.1.0',
      toVersion: '1.0.0',
      transform: (data: any) => ({
        asset: data.asset,
        timestamp: data.timestamp,
        sentiment_score: data.sentiment_score.composite,
        confidence: data.confidence.level,
      }),
    });

    // v1.0.0 -> v2.1.0 (upgrade)
    this.transformers.push({
      fromVersion: '1.0.0',
      toVersion: '2.1.0',
      transform: (data: any) => ({
        asset: data.asset,
        timestamp: data.timestamp,
        timestamp_captured: data.timestamp,
        sentiment_score: {
          composite: data.sentiment_score,
          scale: '0-1 normalized' as const,
          methodology_version: '1.0.0',
        },
        confidence: {
          level: data.confidence,
          interval_95: [data.confidence - 0.05, data.confidence + 0.05] as [number, number],
          interval_99: [data.confidence - 0.08, data.confidence + 0.08] as [number, number],
          methodology: 'bootstrap_ensemble' as const,
        },
        decomposition: {
          social: { score: data.sentiment_score, weight: 0.25, source_count: 0 },
          news: { score: data.sentiment_score, weight: 0.25, source_count: 0 },
          on_chain: { score: data.sentiment_score, weight: 0.25, source_count: 0 },
          microstructure: { score: data.sentiment_score, weight: 0.25, source_count: 0 },
        },
        dynamics: {
          velocity_1h: 0,
          velocity_24h: 0,
          acceleration: 0,
          momentum: 'stable' as const,
        },
        divergence: {
          cross_source: 0,
          social_vs_onchain: 0,
          alert_level: 'low' as const,
        },
        percentiles: {
          '7d': 50,
          '30d': 50,
          '90d': 50,
          '365d': 50,
          all_time: 50,
        },
        quality_indicators: {
          data_completeness: 0.5,
          source_reliability: 0.5,
          model_confidence: data.confidence,
          freshness_ms: 0,
        },
      }),
    });
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  /**
   * Get a specific schema version
   */
  getVersion(version: string): SchemaVersion | undefined {
    return this.versions.get(version);
  }

  /**
   * Get the current (latest stable) version
   */
  getCurrentVersion(): SchemaVersion {
    return this.versions.get(this.currentVersion)!;
  }

  /**
   * Get all supported versions
   */
  getSupportedVersions(): SchemaVersion[] {
    return Array.from(this.versions.values())
      .filter(v => v.status !== 'end_of_life')
      .sort((a, b) => this.compareVersions(b.version, a.version));
  }

  /**
   * Negotiate version based on client request
   */
  negotiateVersion(
    acceptHeader: string | undefined,
    versionParam: string | undefined
  ): VersionNegotiationResult {
    const warnings: string[] = [];
    let requestedVersion: string | null = null;
    let resolvedVersion: string = this.currentVersion;
    let isExactMatch = false;

    // Priority: query param > Accept header > default
    if (versionParam) {
      requestedVersion = versionParam;
    } else if (acceptHeader) {
      // Parse Accept header: application/json; version=2.1.0
      const versionMatch = acceptHeader.match(/version=(\d+\.\d+\.\d+)/);
      if (versionMatch) {
        requestedVersion = versionMatch[1];
      }
    }

    if (requestedVersion) {
      const version = this.versions.get(requestedVersion);

      if (!version) {
        warnings.push(`Requested version ${requestedVersion} not found, using ${this.currentVersion}`);
      } else if (version.status === 'end_of_life') {
        warnings.push(`Requested version ${requestedVersion} has reached end-of-life, using ${this.currentVersion}`);
      } else {
        resolvedVersion = requestedVersion;
        isExactMatch = true;

        if (version.status === 'deprecated') {
          warnings.push(
            `Version ${requestedVersion} is deprecated and will reach end-of-life on ${version.endOfLifeAt?.toISOString().split('T')[0]}. ` +
            `Please migrate to version ${this.currentVersion}.`
          );
        }
      }
    }

    return {
      requestedVersion,
      resolvedVersion,
      isExactMatch,
      warnings,
    };
  }

  /**
   * Transform data from one version to another
   */
  transformData(data: any, fromVersion: string, toVersion: string): any {
    if (fromVersion === toVersion) {
      return data;
    }

    const transformer = this.transformers.find(
      t => t.fromVersion === fromVersion && t.toVersion === toVersion
    );

    if (!transformer) {
      throw new Error(`No transformer found from ${fromVersion} to ${toVersion}`);
    }

    return transformer.transform(data);
  }

  /**
   * Validate data against a schema version
   */
  validateData(data: any, version: string): { valid: boolean; errors?: z.ZodError } {
    const schemaVersion = this.versions.get(version);
    if (!schemaVersion) {
      throw new Error(`Version ${version} not found`);
    }

    const result = schemaVersion.schema.safeParse(data);
    return {
      valid: result.success,
      errors: result.success ? undefined : result.error,
    };
  }

  /**
   * Get changelog between two versions
   */
  getChangelog(fromVersion: string, toVersion: string): SchemaChangelogEntry[] {
    const changelog: SchemaChangelogEntry[] = [];
    const versions = this.getSupportedVersions();

    for (const version of versions) {
      if (
        this.compareVersions(version.version, fromVersion) > 0 &&
        this.compareVersions(version.version, toVersion) <= 0
      ) {
        changelog.push(...version.changelog);
      }
    }

    return changelog;
  }

  /**
   * Get breaking changes between two versions
   */
  getBreakingChanges(fromVersion: string, toVersion: string): BreakingChange[] {
    const breakingChanges: BreakingChange[] = [];
    const versions = this.getSupportedVersions();

    for (const version of versions) {
      if (
        this.compareVersions(version.version, fromVersion) > 0 &&
        this.compareVersions(version.version, toVersion) <= 0
      ) {
        breakingChanges.push(...version.breakingChanges);
      }
    }

    return breakingChanges;
  }

  // ---------------------------------------------------------------------------
  // PRIVATE HELPERS
  // ---------------------------------------------------------------------------

  private compareVersions(a: string, b: string): number {
    const parseVersion = (v: string) => {
      const [major, minor, patch] = v.split('.').map(Number);
      return { major, minor, patch };
    };

    const vA = parseVersion(a);
    const vB = parseVersion(b);

    if (vA.major !== vB.major) return vA.major - vB.major;
    if (vA.minor !== vB.minor) return vA.minor - vB.minor;
    return vA.patch - vB.patch;
  }
}

// =============================================================================
// EXPRESS MIDDLEWARE
// =============================================================================

export interface SchemaVersionMiddlewareOptions {
  registry: SchemaVersionRegistry;
  versionHeader: string;
  versionQueryParam: string;
  includeWarningsInResponse: boolean;
}

const DEFAULT_OPTIONS: SchemaVersionMiddlewareOptions = {
  registry: new SchemaVersionRegistry(),
  versionHeader: 'X-API-Version',
  versionQueryParam: 'api_version',
  includeWarningsInResponse: true,
};

/**
 * Middleware to handle API version negotiation
 */
export function createSchemaVersionMiddleware(
  options: Partial<SchemaVersionMiddlewareOptions> = {}
): (req: Request, res: Response, next: NextFunction) => void {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return (req: Request, res: Response, next: NextFunction) => {
    const acceptHeader = req.headers['accept'];
    const versionParam = req.query[opts.versionQueryParam] as string | undefined;
    const versionHeaderValue = req.headers[opts.versionHeader.toLowerCase()] as string | undefined;

    const negotiation = opts.registry.negotiateVersion(
      acceptHeader,
      versionParam || versionHeaderValue
    );

    // Attach to request
    (req as any).apiVersion = negotiation.resolvedVersion;
    (req as any).apiVersionNegotiation = negotiation;

    // Set response headers
    res.setHeader(opts.versionHeader, negotiation.resolvedVersion);
    res.setHeader('X-API-Version-Supported', opts.registry.getSupportedVersions().map(v => v.version).join(', '));

    if (negotiation.warnings.length > 0) {
      res.setHeader('X-API-Version-Warning', negotiation.warnings.join('; '));

      if (opts.includeWarningsInResponse) {
        // Store warnings to include in response body
        (res as any).apiVersionWarnings = negotiation.warnings;
      }
    }

    // Check if version is deprecated
    const version = opts.registry.getVersion(negotiation.resolvedVersion);
    if (version?.status === 'deprecated') {
      res.setHeader('X-API-Version-Deprecated', 'true');
      res.setHeader('X-API-Version-Sunset', version.endOfLifeAt?.toISOString() || '');
      res.setHeader('Deprecation', version.deprecatedAt?.toISOString() || '');
      res.setHeader('Sunset', version.endOfLifeAt?.toISOString() || '');
    }

    next();
  };
}

/**
 * Response transformer to convert data to requested version
 */
export function createVersionTransformMiddleware(
  registry: SchemaVersionRegistry,
  internalVersion: string = '2.1.0'
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);

    res.json = function(data: any) {
      const requestedVersion = (req as any).apiVersion || internalVersion;

      if (requestedVersion !== internalVersion && data && !data.error) {
        try {
          const transformed = registry.transformData(data, internalVersion, requestedVersion);
          data = transformed;
        } catch (error) {
          // If transformation fails, send original data with warning
          res.setHeader('X-API-Version-Transform-Error', (error as Error).message);
        }
      }

      // Include warnings in response if configured
      const warnings = (res as any).apiVersionWarnings;
      if (warnings && warnings.length > 0 && data && !data.error) {
        data._meta = data._meta || {};
        data._meta.api_version_warnings = warnings;
      }

      return originalJson(data);
    };

    next();
  };
}

// =============================================================================
// API ROUTES
// =============================================================================

export function createSchemaVersionRoutes(registry: SchemaVersionRegistry): Router {
  const router = Router();

  // Get all supported versions
  router.get('/schema/versions', (_req: Request, res: Response) => {
    const versions = registry.getSupportedVersions();

    res.json({
      current_version: registry.getCurrentVersion().version,
      supported_versions: versions.map(v => ({
        version: v.version,
        status: v.status,
        released_at: v.releasedAt,
        deprecated_at: v.deprecatedAt,
        end_of_life_at: v.endOfLifeAt,
      })),
    });
  });

  // Get specific version details
  router.get('/schema/versions/:version', (req: Request, res: Response) => {
    const version = registry.getVersion(req.params.version);

    if (!version) {
      res.status(404).json({
        error: {
          code: 'VERSION_NOT_FOUND',
          message: `Schema version ${req.params.version} not found`,
        },
      });
      return;
    }

    res.json({
      version: version.version,
      status: version.status,
      released_at: version.releasedAt,
      deprecated_at: version.deprecatedAt,
      end_of_life_at: version.endOfLifeAt,
      changelog: version.changelog,
      breaking_changes: version.breakingChanges,
    });
  });

  // Get changelog between versions
  router.get('/schema/changelog', (req: Request, res: Response) => {
    const fromVersion = req.query.from as string;
    const toVersion = req.query.to as string || registry.getCurrentVersion().version;

    if (!fromVersion) {
      res.status(400).json({
        error: {
          code: 'MISSING_PARAMETER',
          message: 'from version is required',
        },
      });
      return;
    }

    const changelog = registry.getChangelog(fromVersion, toVersion);
    const breakingChanges = registry.getBreakingChanges(fromVersion, toVersion);

    res.json({
      from_version: fromVersion,
      to_version: toVersion,
      changelog,
      breaking_changes: breakingChanges,
      migration_required: breakingChanges.length > 0,
    });
  });

  // Get OpenAPI schema for a version
  router.get('/schema/openapi/:version', (req: Request, res: Response) => {
    const version = registry.getVersion(req.params.version);

    if (!version) {
      res.status(404).json({
        error: {
          code: 'VERSION_NOT_FOUND',
          message: `Schema version ${req.params.version} not found`,
        },
      });
      return;
    }

    // Generate OpenAPI schema from Zod
    // This is a simplified version - in production, use zod-to-openapi
    res.json({
      openapi: '3.0.0',
      info: {
        title: 'Crypto Sentiment API',
        version: version.version,
      },
      components: {
        schemas: {
          SentimentResponse: {
            type: 'object',
            description: `Schema version ${version.version}`,
            // In production, convert Zod schema to JSON Schema
          },
        },
      },
    });
  });

  return router;
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  SchemaVersionRegistry,
  createSchemaVersionMiddleware,
  createVersionTransformMiddleware,
  createSchemaVersionRoutes,
  SentimentResponseV1,
  SentimentResponseV2,
  SentimentResponseV2_1,
};
