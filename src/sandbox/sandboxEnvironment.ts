/**
 * Sandbox Environment
 * Institutional-Grade Cryptocurrency Market Sentiment Analysis API
 *
 * Provides:
 * - Isolated testing environment
 * - Synthetic data generation
 * - Deterministic responses for integration testing
 * - Rate limit simulation
 * - Error injection for resilience testing
 */

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

export interface SandboxConfig {
  /** Whether sandbox mode is enabled */
  enabled: boolean;
  /** Sandbox API key prefix */
  apiKeyPrefix: string;
  /** Maximum requests per minute in sandbox */
  rateLimitPerMinute: number;
  /** Synthetic data configuration */
  syntheticData: SyntheticDataConfig;
  /** Error injection configuration */
  errorInjection: ErrorInjectionConfig;
  /** Latency simulation */
  latencySimulation: LatencySimulationConfig;
}

export interface SyntheticDataConfig {
  /** Seed for deterministic generation */
  seed: number;
  /** Supported assets in sandbox */
  supportedAssets: string[];
  /** Historical data range (days) */
  historicalDays: number;
  /** Update frequency simulation (ms) */
  updateFrequencyMs: number;
}

export interface ErrorInjectionConfig {
  /** Enable error injection */
  enabled: boolean;
  /** Error rate (0-1) */
  errorRate: number;
  /** Specific errors to inject */
  errors: InjectedError[];
}

export interface InjectedError {
  /** Error type */
  type: 'rate_limit' | 'timeout' | 'server_error' | 'bad_request' | 'unauthorized';
  /** Probability (0-1) */
  probability: number;
  /** Specific endpoints to affect (empty = all) */
  endpoints: string[];
}

export interface LatencySimulationConfig {
  /** Enable latency simulation */
  enabled: boolean;
  /** Base latency (ms) */
  baseLatencyMs: number;
  /** Latency variance (ms) */
  varianceMs: number;
  /** Occasional spike probability */
  spikeProbability: number;
  /** Spike multiplier */
  spikeMultiplier: number;
}

export interface SyntheticSentiment {
  asset: string;
  timestamp: string;
  timestamp_captured: string;
  sentiment_score: {
    composite: number;
    scale: '0-1 normalized';
    methodology_version: string;
  };
  confidence: {
    level: number;
    interval_95: [number, number];
    interval_99: [number, number];
    methodology: string;
  };
  decomposition: {
    social: { score: number; weight: number; source_count: number };
    news: { score: number; weight: number; source_count: number };
    on_chain: { score: number; weight: number; source_count: number };
    microstructure: { score: number; weight: number; source_count: number };
    developer: { score: number; weight: number; source_count: number };
  };
  dynamics: {
    velocity_1h: number;
    velocity_24h: number;
    acceleration: number;
    momentum: 'increasing' | 'stable' | 'decreasing';
  };
  divergence: {
    cross_source: number;
    social_vs_onchain: number;
    retail_vs_whale: number;
    alert_level: 'low' | 'moderate' | 'high' | 'critical';
  };
  percentiles: {
    '7d': number;
    '30d': number;
    '90d': number;
    '365d': number;
    all_time: number;
  };
  quality_indicators: {
    data_completeness: number;
    source_reliability: number;
    model_confidence: number;
    freshness_ms: number;
  };
  _sandbox: {
    generated: true;
    seed: number;
    scenario: string;
  };
}

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  enabled: true,
  apiKeyPrefix: 'sk_sandbox_',
  rateLimitPerMinute: 100,
  syntheticData: {
    seed: 42,
    supportedAssets: [
      'BTC', 'ETH', 'SOL', 'AVAX', 'MATIC', 'ARB', 'OP', 'LINK', 'UNI', 'AAVE',
      'MKR', 'SNX', 'CRV', 'LDO', 'RPL', 'GMX', 'DYDX', 'INJ', 'TIA', 'ATOM',
    ],
    historicalDays: 365,
    updateFrequencyMs: 1000,
  },
  errorInjection: {
    enabled: false,
    errorRate: 0.01,
    errors: [
      { type: 'rate_limit', probability: 0.005, endpoints: [] },
      { type: 'timeout', probability: 0.002, endpoints: [] },
      { type: 'server_error', probability: 0.001, endpoints: [] },
    ],
  },
  latencySimulation: {
    enabled: true,
    baseLatencyMs: 50,
    varianceMs: 30,
    spikeProbability: 0.01,
    spikeMultiplier: 5,
  },
};

// =============================================================================
// SEEDED RANDOM NUMBER GENERATOR
// =============================================================================

class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /**
   * Generate next random number (0-1)
   */
  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  /**
   * Generate random number in range
   */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Generate random integer in range
   */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /**
   * Pick random item from array
   */
  pick<T>(array: T[]): T {
    return array[this.int(0, array.length - 1)];
  }

  /**
   * Generate gaussian random number
   */
  gaussian(mean: number = 0, stdDev: number = 1): number {
    const u1 = this.next();
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * stdDev;
  }
}

// =============================================================================
// SYNTHETIC DATA GENERATOR
// =============================================================================

export class SyntheticDataGenerator {
  private config: SyntheticDataConfig;
  private rng: SeededRandom;
  private assetStates: Map<string, AssetState> = new Map();

  constructor(config: SyntheticDataConfig = DEFAULT_SANDBOX_CONFIG.syntheticData) {
    this.config = config;
    this.rng = new SeededRandom(config.seed);
    this.initializeAssetStates();
  }

  private initializeAssetStates(): void {
    for (const asset of this.config.supportedAssets) {
      this.assetStates.set(asset, {
        baseSentiment: 0.5 + this.rng.gaussian(0, 0.15),
        volatility: 0.05 + this.rng.next() * 0.1,
        trend: this.rng.gaussian(0, 0.01),
        lastUpdate: Date.now(),
      });
    }
  }

  /**
   * Generate synthetic sentiment for an asset
   */
  generateSentiment(asset: string, timestamp?: Date): SyntheticSentiment {
    const state = this.assetStates.get(asset.toUpperCase());
    if (!state) {
      throw new Error(`Asset ${asset} not supported in sandbox`);
    }

    const ts = timestamp || new Date();
    const timeSeed = Math.floor(ts.getTime() / this.config.updateFrequencyMs);
    const rng = new SeededRandom(this.config.seed + timeSeed + asset.charCodeAt(0));

    // Update state with random walk
    state.baseSentiment = Math.max(0.1, Math.min(0.9,
      state.baseSentiment + state.trend + rng.gaussian(0, state.volatility)
    ));

    // Generate composite score with noise
    const composite = Math.max(0, Math.min(1,
      state.baseSentiment + rng.gaussian(0, 0.02)
    ));

    // Generate component scores
    const socialScore = Math.max(0, Math.min(1, composite + rng.gaussian(0, 0.08)));
    const newsScore = Math.max(0, Math.min(1, composite + rng.gaussian(0, 0.05)));
    const onChainScore = Math.max(0, Math.min(1, composite + rng.gaussian(0, 0.06)));
    const microstructureScore = Math.max(0, Math.min(1, composite + rng.gaussian(0, 0.07)));
    const developerScore = Math.max(0, Math.min(1, composite + rng.gaussian(0, 0.04)));

    // Calculate confidence based on data completeness
    const confidence = 0.7 + rng.next() * 0.25;
    const margin = (1 - confidence) * 0.1;

    // Calculate dynamics
    const prevRng = new SeededRandom(this.config.seed + timeSeed - 1 + asset.charCodeAt(0));
    const prevSentiment = Math.max(0, Math.min(1, state.baseSentiment + prevRng.gaussian(0, 0.02)));
    const velocity1h = composite - prevSentiment;
    const velocity24h = velocity1h * (3 + rng.next() * 2);
    const acceleration = velocity1h * rng.gaussian(0.5, 0.3);

    // Determine momentum
    let momentum: 'increasing' | 'stable' | 'decreasing' = 'stable';
    if (velocity24h > 0.02) momentum = 'increasing';
    else if (velocity24h < -0.02) momentum = 'decreasing';

    // Calculate divergence
    const crossSource = Math.abs(socialScore - onChainScore);
    const socialVsOnchain = socialScore - onChainScore;
    const retailVsWhale = rng.gaussian(0, 0.15);

    let alertLevel: 'low' | 'moderate' | 'high' | 'critical' = 'low';
    if (crossSource > 0.3) alertLevel = 'critical';
    else if (crossSource > 0.2) alertLevel = 'high';
    else if (crossSource > 0.1) alertLevel = 'moderate';

    return {
      asset: asset.toUpperCase(),
      timestamp: ts.toISOString(),
      timestamp_captured: new Date(ts.getTime() + rng.int(50, 200)).toISOString(),
      sentiment_score: {
        composite: Math.round(composite * 1000) / 1000,
        scale: '0-1 normalized',
        methodology_version: '2.1.0',
      },
      confidence: {
        level: Math.round(confidence * 100) / 100,
        interval_95: [
          Math.round((composite - margin) * 1000) / 1000,
          Math.round((composite + margin) * 1000) / 1000,
        ],
        interval_99: [
          Math.round((composite - margin * 1.5) * 1000) / 1000,
          Math.round((composite + margin * 1.5) * 1000) / 1000,
        ],
        methodology: 'bca_bootstrap_ensemble',
      },
      decomposition: {
        social: { score: Math.round(socialScore * 1000) / 1000, weight: 0.25, source_count: rng.int(5000, 15000) },
        news: { score: Math.round(newsScore * 1000) / 1000, weight: 0.20, source_count: rng.int(50, 200) },
        on_chain: { score: Math.round(onChainScore * 1000) / 1000, weight: 0.25, source_count: rng.int(10, 30) },
        microstructure: { score: Math.round(microstructureScore * 1000) / 1000, weight: 0.20, source_count: rng.int(5, 15) },
        developer: { score: Math.round(developerScore * 1000) / 1000, weight: 0.10, source_count: rng.int(20, 100) },
      },
      dynamics: {
        velocity_1h: Math.round(velocity1h * 10000) / 10000,
        velocity_24h: Math.round(velocity24h * 10000) / 10000,
        acceleration: Math.round(acceleration * 10000) / 10000,
        momentum,
      },
      divergence: {
        cross_source: Math.round(crossSource * 1000) / 1000,
        social_vs_onchain: Math.round(socialVsOnchain * 1000) / 1000,
        retail_vs_whale: Math.round(retailVsWhale * 1000) / 1000,
        alert_level: alertLevel,
      },
      percentiles: {
        '7d': rng.int(20, 80),
        '30d': rng.int(20, 80),
        '90d': rng.int(20, 80),
        '365d': rng.int(20, 80),
        all_time: rng.int(20, 80),
      },
      quality_indicators: {
        data_completeness: Math.round((0.85 + rng.next() * 0.15) * 100) / 100,
        source_reliability: Math.round((0.80 + rng.next() * 0.18) * 100) / 100,
        model_confidence: Math.round(confidence * 100) / 100,
        freshness_ms: rng.int(100, 500),
      },
      _sandbox: {
        generated: true,
        seed: this.config.seed,
        scenario: 'default',
      },
    };
  }

  /**
   * Generate historical sentiment data
   */
  generateHistorical(
    asset: string,
    startTime: Date,
    endTime: Date,
    interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d'
  ): SyntheticSentiment[] {
    const intervalMs = {
      '1m': 60000,
      '5m': 300000,
      '15m': 900000,
      '1h': 3600000,
      '4h': 14400000,
      '1d': 86400000,
    }[interval];

    const data: SyntheticSentiment[] = [];
    let current = new Date(startTime);

    while (current <= endTime) {
      data.push(this.generateSentiment(asset, current));
      current = new Date(current.getTime() + intervalMs);
    }

    return data;
  }

  /**
   * Get supported assets
   */
  getSupportedAssets(): string[] {
    return [...this.config.supportedAssets];
  }

  /**
   * Reset generator state
   */
  reset(seed?: number): void {
    if (seed !== undefined) {
      this.config.seed = seed;
    }
    this.rng = new SeededRandom(this.config.seed);
    this.assetStates.clear();
    this.initializeAssetStates();
  }
}

interface AssetState {
  baseSentiment: number;
  volatility: number;
  trend: number;
  lastUpdate: number;
}

// =============================================================================
// SCENARIO GENERATOR
// =============================================================================

export type ScenarioType =
  | 'bull_market'
  | 'bear_market'
  | 'high_volatility'
  | 'flash_crash'
  | 'gradual_recovery'
  | 'sentiment_divergence'
  | 'whale_accumulation'
  | 'retail_fomo';

export class ScenarioGenerator {
  private baseGenerator: SyntheticDataGenerator;

  constructor(config?: SyntheticDataConfig) {
    this.baseGenerator = new SyntheticDataGenerator(config);
  }

  /**
   * Generate scenario-based data
   */
  generateScenario(
    scenario: ScenarioType,
    asset: string,
    durationHours: number = 24
  ): SyntheticSentiment[] {
    const data: SyntheticSentiment[] = [];
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - durationHours * 3600000);

    let current = new Date(startTime);
    const intervalMs = 3600000; // 1 hour

    while (current <= endTime) {
      const progress = (current.getTime() - startTime.getTime()) / (endTime.getTime() - startTime.getTime());
      const base = this.baseGenerator.generateSentiment(asset, current);

      // Apply scenario modifications
      const modified = this.applyScenario(base, scenario, progress);
      data.push(modified);

      current = new Date(current.getTime() + intervalMs);
    }

    return data;
  }

  private applyScenario(
    base: SyntheticSentiment,
    scenario: ScenarioType,
    progress: number
  ): SyntheticSentiment {
    const modified = { ...base };

    switch (scenario) {
      case 'bull_market':
        modified.sentiment_score.composite = Math.min(0.95, base.sentiment_score.composite + progress * 0.3);
        modified.dynamics.momentum = 'increasing';
        modified.dynamics.velocity_24h = 0.05 + progress * 0.1;
        break;

      case 'bear_market':
        modified.sentiment_score.composite = Math.max(0.15, base.sentiment_score.composite - progress * 0.3);
        modified.dynamics.momentum = 'decreasing';
        modified.dynamics.velocity_24h = -0.05 - progress * 0.1;
        break;

      case 'high_volatility':
        const swing = Math.sin(progress * Math.PI * 8) * 0.2;
        modified.sentiment_score.composite = Math.max(0.1, Math.min(0.9, base.sentiment_score.composite + swing));
        modified.dynamics.velocity_1h = swing;
        break;

      case 'flash_crash':
        if (progress > 0.4 && progress < 0.6) {
          modified.sentiment_score.composite = Math.max(0.1, base.sentiment_score.composite - 0.4);
          modified.divergence.alert_level = 'critical';
        }
        break;

      case 'gradual_recovery':
        if (progress < 0.3) {
          modified.sentiment_score.composite = 0.2 + progress * 0.3;
        } else {
          modified.sentiment_score.composite = 0.3 + (progress - 0.3) * 0.5;
        }
        modified.dynamics.momentum = progress > 0.3 ? 'increasing' : 'stable';
        break;

      case 'sentiment_divergence':
        modified.decomposition.social.score = Math.min(0.9, base.decomposition.social.score + 0.2);
        modified.decomposition.on_chain.score = Math.max(0.2, base.decomposition.on_chain.score - 0.2);
        modified.divergence.cross_source = 0.35;
        modified.divergence.social_vs_onchain = 0.4;
        modified.divergence.alert_level = 'high';
        break;

      case 'whale_accumulation':
        modified.decomposition.on_chain.score = Math.min(0.9, base.decomposition.on_chain.score + 0.25);
        modified.decomposition.social.score = base.decomposition.social.score; // Social unaware
        modified.divergence.retail_vs_whale = -0.3;
        break;

      case 'retail_fomo':
        modified.decomposition.social.score = Math.min(0.95, base.decomposition.social.score + 0.3);
        modified.decomposition.on_chain.score = base.decomposition.on_chain.score - 0.1;
        modified.divergence.retail_vs_whale = 0.35;
        modified.divergence.alert_level = 'moderate';
        break;
    }

    modified._sandbox.scenario = scenario;
    return modified;
  }

  /**
   * Get available scenarios
   */
  getAvailableScenarios(): ScenarioType[] {
    return [
      'bull_market',
      'bear_market',
      'high_volatility',
      'flash_crash',
      'gradual_recovery',
      'sentiment_divergence',
      'whale_accumulation',
      'retail_fomo',
    ];
  }
}

// =============================================================================
// SANDBOX MIDDLEWARE
// =============================================================================

export interface SandboxMiddlewareOptions {
  config: SandboxConfig;
  generator: SyntheticDataGenerator;
}

/**
 * Middleware to detect and handle sandbox requests
 */
export function createSandboxMiddleware(options: SandboxMiddlewareOptions) {
  const requestCounts = new Map<string, { count: number; resetAt: number }>();

  return async (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-api-key'] as string;

    // Check if sandbox request
    if (!apiKey?.startsWith(options.config.apiKeyPrefix)) {
      return next();
    }

    // Mark as sandbox request
    (req as any).isSandbox = true;
    (req as any).sandboxConfig = options.config;
    (req as any).sandboxGenerator = options.generator;

    // Add sandbox header to response
    res.setHeader('X-Sandbox-Mode', 'true');
    res.setHeader('X-Sandbox-Warning', 'This is synthetic data for testing purposes only');

    // Check rate limit
    const now = Date.now();
    let rateData = requestCounts.get(apiKey);

    if (!rateData || now > rateData.resetAt) {
      rateData = { count: 0, resetAt: now + 60000 };
      requestCounts.set(apiKey, rateData);
    }

    rateData.count++;

    if (rateData.count > options.config.rateLimitPerMinute) {
      res.status(429).json({
        error: {
          code: 'SANDBOX_RATE_LIMIT',
          message: `Sandbox rate limit exceeded (${options.config.rateLimitPerMinute}/min)`,
        },
        _sandbox: true,
      });
      return;
    }

    // Error injection
    if (options.config.errorInjection.enabled) {
      const error = shouldInjectError(options.config.errorInjection, req.path);
      if (error) {
        return injectError(res, error);
      }
    }

    // Latency simulation
    if (options.config.latencySimulation.enabled) {
      const latency = calculateLatency(options.config.latencySimulation);
      await new Promise(resolve => setTimeout(resolve, latency));
    }

    next();
  };
}

function shouldInjectError(config: ErrorInjectionConfig, path: string): InjectedError | null {
  if (Math.random() > config.errorRate) {
    return null;
  }

  for (const error of config.errors) {
    if (error.endpoints.length > 0 && !error.endpoints.some(e => path.includes(e))) {
      continue;
    }
    if (Math.random() < error.probability) {
      return error;
    }
  }

  return null;
}

function injectError(res: Response, error: InjectedError): void {
  switch (error.type) {
    case 'rate_limit':
      res.status(429).json({
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Simulated rate limit' },
        _sandbox: true,
        _injected_error: true,
      });
      break;
    case 'timeout':
      // Don't respond (simulates timeout)
      break;
    case 'server_error':
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Simulated server error' },
        _sandbox: true,
        _injected_error: true,
      });
      break;
    case 'bad_request':
      res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Simulated bad request' },
        _sandbox: true,
        _injected_error: true,
      });
      break;
    case 'unauthorized':
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Simulated auth failure' },
        _sandbox: true,
        _injected_error: true,
      });
      break;
  }
}

function calculateLatency(config: LatencySimulationConfig): number {
  let latency = config.baseLatencyMs + (Math.random() - 0.5) * 2 * config.varianceMs;

  if (Math.random() < config.spikeProbability) {
    latency *= config.spikeMultiplier;
  }

  return Math.max(1, latency);
}

// =============================================================================
// SANDBOX ROUTES
// =============================================================================

export function createSandboxRoutes(generator: SyntheticDataGenerator): Router {
  const router = Router();
  const scenarioGenerator = new ScenarioGenerator();

  // Get sandbox info
  router.get('/sandbox/info', (_req: Request, res: Response) => {
    res.json({
      sandbox: true,
      supported_assets: generator.getSupportedAssets(),
      available_scenarios: scenarioGenerator.getAvailableScenarios(),
      rate_limit: DEFAULT_SANDBOX_CONFIG.rateLimitPerMinute,
      documentation: 'https://docs.sentiment-api.io/sandbox',
    });
  });

  // Generate sandbox API key
  router.post('/sandbox/keys', (_req: Request, res: Response) => {
    const keyId = crypto.randomBytes(16).toString('hex');
    const apiKey = `sk_sandbox_${keyId}`;

    res.json({
      api_key: apiKey,
      type: 'sandbox',
      rate_limit: DEFAULT_SANDBOX_CONFIG.rateLimitPerMinute,
      note: 'This key only works with sandbox endpoints and returns synthetic data',
    });
  });

  // Reset generator with new seed
  router.post('/sandbox/reset', (req: Request, res: Response) => {
    const { seed } = req.body;
    generator.reset(seed);

    res.json({
      success: true,
      seed: seed || DEFAULT_SANDBOX_CONFIG.syntheticData.seed,
    });
  });

  // Generate scenario data
  router.get('/sandbox/scenarios/:scenario', (req: Request, res: Response) => {
    const { scenario } = req.params;
    const asset = (req.query.asset as string) || 'BTC';
    const hours = parseInt(req.query.hours as string) || 24;

    if (!scenarioGenerator.getAvailableScenarios().includes(scenario as ScenarioType)) {
      res.status(400).json({
        error: {
          code: 'INVALID_SCENARIO',
          message: `Invalid scenario: ${scenario}`,
          available_scenarios: scenarioGenerator.getAvailableScenarios(),
        },
      });
      return;
    }

    const data = scenarioGenerator.generateScenario(scenario as ScenarioType, asset, hours);

    res.json({
      scenario,
      asset,
      duration_hours: hours,
      data_points: data.length,
      data,
      _sandbox: true,
    });
  });

  return router;
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  SyntheticDataGenerator,
  ScenarioGenerator,
  createSandboxMiddleware,
  createSandboxRoutes,
  DEFAULT_SANDBOX_CONFIG,
};
