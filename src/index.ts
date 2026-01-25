/**
 * Application Entry Point
 * Institutional-Grade Cryptocurrency Market Sentiment Analysis API
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import crypto from 'crypto';
import { createServer, Server } from 'http';
import { WebSocketServer } from 'ws';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { z } from 'zod';
import {
  metricsRegistry,
  sentimentAnalysisTotal,
  datasourceHealth,
  httpRequestsTotal,
  httpRequestDuration,
  rateLimitExceededTotal,
  authFailuresTotal,
  invalidApiKeyTotal,
  sentimentLastProcessedTimestamp,
} from './metrics';
import config, { validateConfig } from './config/default';
import { createRateLimitMiddleware, WebSocketConnectionLimiter } from './middleware/rateLimiter';
import { SessionManager } from './websocket/reconnectionProtocol';
import { SentimentEngine } from './nlp/sentimentEngine';
import { AggregationPipeline, createPipeline } from './services/aggregationPipeline';
import { DatabaseMigrator } from './database/migrator';

// =============================================================================
// INPUT VALIDATION SCHEMAS
// =============================================================================

const assetSymbolSchema = z.string()
  .min(1, 'Asset symbol required')
  .max(10, 'Asset symbol too long')
  .regex(/^[A-Z0-9]+$/i, 'Invalid asset symbol format')
  .transform(s => s.toUpperCase());

const assetsQuerySchema = z.string()
  .transform(s => s.split(',').map(a => a.trim().toUpperCase()))
  .pipe(z.array(assetSymbolSchema).min(1).max(50));

const intervalSchema = z.enum(['1m', '1h', '1d']);

const dateStringSchema = z.string().refine(
  (s) => !isNaN(Date.parse(s)),
  { message: 'Invalid date format' }
);

const historicalQuerySchema = z.object({
  asset: assetSymbolSchema,
  start_time: dateStringSchema,
  end_time: dateStringSchema,
  interval: intervalSchema.default('1h'),
  limit: z.coerce.number().int().min(1).max(10000).default(1000),
  offset: z.coerce.number().int().min(0).default(0),
});

const analyzeBodySchema = z.object({
  text: z.string().min(1, 'Text is required').max(10000, 'Text exceeds 10000 character limit'),
  source: z.enum(['twitter', 'reddit', 'news', 'discord', 'telegram', 'onchain']).default('news'),
});

// Valid table mapping for historical queries (prevents SQL injection)
const INTERVAL_TABLE_MAP: Record<string, string> = {
  '1m': 'sentiment_aggregated_1m',
  '1h': 'sentiment_aggregated_1h',
  '1d': 'sentiment_aggregated_1d',
} as const;

// =============================================================================
// APPLICATION CLASS
// =============================================================================

class Application {
  private app: Express;
  private server: Server;
  private wss: WebSocketServer;
  private redis: Redis;
  private pool: Pool;
  private sessionManager: SessionManager;
  private wsConnectionLimiter: WebSocketConnectionLimiter;
  private sentimentEngine: SentimentEngine;
  private pipeline: AggregationPipeline | null = null;
  private readonly ipSalt: string = crypto.randomBytes(16).toString('hex');

  constructor() {
    // Validate configuration
    validateConfig(config);

    // Initialize Express
    this.app = express();
    this.server = createServer(this.app);

    // Initialize Redis
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      keyPrefix: config.redis.keyPrefix,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });

    // Initialize PostgreSQL
    this.pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'sentiment',
      user: process.env.DB_USER || 'sentiment',
      password: process.env.DB_PASSWORD || '',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    // Initialize NLP Sentiment Engine
    this.sentimentEngine = new SentimentEngine({
      useCryptoLexicon: true,
      enableEmotionAnalysis: true,
      confidenceMethod: 'bca_bootstrap',
    });

    // Initialize WebSocket
    this.wss = new WebSocketServer({
      server: this.server,
      path: config.websocket.path,
    });

    // Initialize session manager with Redis for horizontal scaling
    this.sessionManager = new SessionManager({
      redis: this.redis,
      bufferDurationMs: config.websocket.messageBufferDuration,
      maxBufferSize: 10000,
      recoveryEndpoint: '/v1/stream/replay',
      sessionTTL: 3600, // 1 hour
    });

    // Initialize WebSocket connection limiter
    this.wsConnectionLimiter = new WebSocketConnectionLimiter(this.redis);

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.setupErrorHandling();
  }

  // ---------------------------------------------------------------------------
  // MIDDLEWARE SETUP
  // ---------------------------------------------------------------------------

  private setupMiddleware(): void {
    // Security middleware with explicit configuration
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: true,
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      dnsPrefetchControl: { allow: false },
      frameguard: { action: 'deny' },
      hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true,
      },
      ieNoOpen: true,
      noSniff: true,
      originAgentCluster: true,
      permittedCrossDomainPolicies: { permittedPolicies: 'none' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      xssFilter: true,
    }));

    this.app.use(cors({
      origin: config.security.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
      maxAge: 86400, // 24 hours
    }));

    // Compression
    this.app.use(compression());

    // Body parsing
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Request ID and HTTP metrics
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      req.id = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      res.setHeader('X-Request-Id', req.id);

      // Track HTTP request metrics
      const startTime = process.hrtime.bigint();
      const endpoint = this.normalizeEndpoint(req.path);

      res.on('finish', () => {
        const durationNs = process.hrtime.bigint() - startTime;
        const durationSeconds = Number(durationNs) / 1e9;

        httpRequestsTotal.inc({
          method: req.method,
          endpoint,
          status: res.statusCode.toString(),
        });

        httpRequestDuration.observe(
          { method: req.method, endpoint },
          durationSeconds
        );
      });

      next();
    });
  }

  /**
   * Normalizes endpoint paths for metrics (removes IDs to avoid cardinality explosion)
   */
  private normalizeEndpoint(path: string): string {
    return path
      .replace(/\/v1\/sentiment\/[A-Za-z0-9]+$/, '/v1/sentiment/:asset')
      .replace(/\/[0-9a-f-]{36}/g, '/:id') // UUIDs
      .replace(/\/\d+/g, '/:id'); // Numeric IDs

    // Rate limiting
    if (config.rateLimiting.enabled) {
      this.app.use(createRateLimitMiddleware({
        redis: this.redis,
        getClientContext: async (req: Request) => {
          const apiKey = req.headers[config.security.apiKeyHeader.toLowerCase()] as string;

          // Anonymous users get restricted anonymous tier
          if (!apiKey || !apiKey.startsWith('sk_') || apiKey.length < 32) {
            // Generate unique anonymous ID based on IP hash for per-user limiting
            const anonId = `anon_${crypto.createHash('sha256').update(req.ip || '').digest('hex').slice(0, 16)}`;
            return { clientId: anonId, tier: 'anonymous' as const };
          }

          // Hash the API key and lookup in database
          const keyHash = crypto
            .createHash('sha256')
            .update(apiKey)
            .digest('hex');
          const keyPrefix = apiKey.substring(0, 12);

          try {
            const result = await this.pool.query<{ client_id: string; tier: string; is_active: boolean }>(`
              SELECT ak.client_id, c.tier, ak.is_active
              FROM api_keys ak
              JOIN clients c ON ak.client_id = c.id
              WHERE ak.key_hash = $1 AND ak.key_prefix = $2 AND ak.is_active = true AND c.is_active = true
            `, [keyHash, keyPrefix]);

            if (result.rows.length > 0) {
              const { client_id, tier } = result.rows[0];
              // Attach client info to request for downstream use
              (req as any).clientId = client_id;
              (req as any).clientTier = tier;
              return { clientId: client_id, tier: tier as 'anonymous' | 'professional' | 'institutional' | 'enterprise' | 'strategic' };
            }
          } catch (error) {
            console.error('Rate limit client lookup error:', (error as Error).message);
          }

          // Fallback to anonymous tier for invalid API keys
          // Track invalid API key attempts if a key was provided but invalid
          if (apiKey && apiKey.length > 0) {
            invalidApiKeyTotal.inc({ client_ip: req.ip || 'unknown' });
            authFailuresTotal.inc({ reason: 'invalid_api_key' });
          }
          const anonId = `anon_${crypto.createHash('sha256').update(req.ip || '').digest('hex').slice(0, 16)}`;
          return { clientId: anonId, tier: 'anonymous' as const };
        },
        skip: (req: Request) => {
          // Skip rate limiting for health checks
          return req.path === '/health' || req.path === '/health/ready';
        },
        onRateLimited: (req: Request, _result) => {
          // Track rate limit exceeded events
          const tier = (req as any).clientTier || 'anonymous';
          const clientId = (req as any).clientId || 'unknown';
          rateLimitExceededTotal.inc({ tier, client_id: clientId });
        },
      }));
    }
  }

  // ---------------------------------------------------------------------------
  // ROUTES SETUP
  // ---------------------------------------------------------------------------

  private setupRoutes(): void {
    // Prometheus metrics endpoint - restricted to internal access only
    this.app.get('/metrics', async (req: Request, res: Response) => {
      // Security: Only allow internal network access or authenticated Prometheus scrapers
      const clientIp = req.ip || req.socket.remoteAddress || '';
      const isInternal = clientIp.startsWith('10.') ||
                         clientIp.startsWith('172.16.') ||
                         clientIp.startsWith('172.17.') ||
                         clientIp.startsWith('172.18.') ||
                         clientIp.startsWith('172.19.') ||
                         clientIp.startsWith('172.2') ||
                         clientIp.startsWith('172.3') ||
                         clientIp.startsWith('192.168.') ||
                         clientIp === '127.0.0.1' ||
                         clientIp === '::1' ||
                         clientIp === '::ffff:127.0.0.1';

      // Allow internal IPs or requests with valid metrics token
      const metricsToken = req.headers['x-metrics-token'] as string;
      const validMetricsToken = process.env.METRICS_ACCESS_TOKEN;

      if (!isInternal && (!validMetricsToken || metricsToken !== validMetricsToken)) {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Metrics endpoint is restricted to internal access',
          },
        });
        return;
      }

      res.set('Content-Type', metricsRegistry.contentType);
      res.send(await metricsRegistry.metrics());
    });

    // Health check endpoints
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        region: config.server.region,
        version: process.env.npm_package_version || '1.0.0',
      });
    });

    this.app.get('/health/ready', async (_req: Request, res: Response) => {
      try {
        // Check Redis
        await this.redis.ping();

        // Check PostgreSQL
        await this.pool.query('SELECT 1');

        // Check NLP engine
        const nlpReady = this.sentimentEngine.isReady();

        // Check pipeline
        const pipelineHealth = this.pipeline ? await this.pipeline.healthCheck() : { healthy: false, components: {} };

        res.json({
          status: 'ready',
          timestamp: new Date().toISOString(),
          components: {
            redis: { status: 'healthy' },
            postgres: { status: 'healthy' },
            nlp: { status: nlpReady ? 'healthy' : 'degraded' },
            pipeline: pipelineHealth,
          },
        });
      } catch (error) {
        // Log full error for debugging but don't expose to client
        console.error('Health check failed:', error);

        // Determine which component failed without exposing details
        const failedComponent = (error as Error).message?.includes('ECONNREFUSED')
          ? 'connectivity'
          : 'unknown';

        res.status(503).json({
          status: 'not_ready',
          error: 'One or more health checks failed',
          hint: config.server.env !== 'production' ? failedComponent : undefined,
        });
      }
    });

    this.app.get('/health/live', (_req: Request, res: Response) => {
      res.json({ status: 'alive' });
    });

    // API v1 routes - Real-time sentiment
    this.app.get('/v1/sentiment/:asset', async (req: Request, res: Response) => {
      const startTime = Date.now();

      // Validate asset parameter
      const validation = assetSymbolSchema.safeParse(req.params.asset);
      if (!validation.success) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid asset symbol',
            details: validation.error.errors,
          },
        });
        return;
      }
      const asset = validation.data;

      try {
        // Query from database
        const result = await this.pool.query<{
          sentiment_score: number;
          magnitude: number;
          confidence_score: number;
          confidence_lower: number;
          confidence_upper: number;
          mention_count: number;
          avg_emotion_fear: number;
          avg_emotion_greed: number;
          avg_emotion_uncertainty: number;
          avg_emotion_optimism: number;
        }>(
          `SELECT
            sentiment_score, magnitude, confidence_score,
            confidence_lower, confidence_upper, mention_count,
            avg_emotion_fear, avg_emotion_greed,
            avg_emotion_uncertainty, avg_emotion_optimism
          FROM sentiment_aggregated_1h sa
          JOIN assets a ON sa.asset_id = a.id
          WHERE a.symbol = $1
          ORDER BY time DESC
          LIMIT 1`,
          [asset.toUpperCase()]
        );

        if (result.rows.length === 0) {
          res.status(404).json({
            error: {
              code: 'ASSET_NOT_FOUND',
              message: `No sentiment data found for asset: ${asset}`,
            },
          });
          return;
        }

        const data = result.rows[0];
        sentimentAnalysisTotal.inc({ source: 'api', asset: asset.toUpperCase() });
        sentimentLastProcessedTimestamp.set({ asset: asset.toUpperCase() }, Date.now() / 1000);

        // Cache for 30 seconds (real-time data), CDN can cache for 5 minutes
        res.set({
          'Cache-Control': 'public, max-age=30, s-maxage=300',
          'Vary': 'Accept-Encoding',
        });

        res.json({
          asset: asset.toUpperCase(),
          timestamp: new Date().toISOString(),
          sentiment_score: {
            composite: data.sentiment_score,
            magnitude: data.magnitude,
            scale: '-1 to 1 normalized',
          },
          confidence: {
            level: data.confidence_score,
            interval_95: [data.confidence_lower, data.confidence_upper],
          },
          emotions: {
            fear: data.avg_emotion_fear,
            greed: data.avg_emotion_greed,
            uncertainty: data.avg_emotion_uncertainty,
            optimism: data.avg_emotion_optimism,
          },
          volume: {
            mention_count: data.mention_count,
          },
          meta: {
            query_time_ms: Date.now() - startTime,
          },
        });
      } catch (error) {
        console.error('Error fetching sentiment:', error);
        res.status(500).json({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to fetch sentiment data',
          },
        });
      }
    });

    this.app.get('/v1/sentiment', async (req: Request, res: Response) => {
      const startTime = Date.now();

      // Validate assets query parameter
      let assets: string[];
      if (req.query.assets) {
        const validation = assetsQuerySchema.safeParse(req.query.assets);
        if (!validation.success) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid assets parameter',
              details: validation.error.errors,
            },
          });
          return;
        }
        assets = validation.data;
      } else {
        assets = ['BTC', 'ETH']; // Default assets
      }

      try {
        const result = await this.pool.query<{
          symbol: string;
          sentiment_score: number;
          confidence_score: number;
          mention_count: number;
        }>(
          `SELECT
            a.symbol,
            sa.sentiment_score,
            sa.confidence_score,
            sa.mention_count
          FROM sentiment_aggregated_1h sa
          JOIN assets a ON sa.asset_id = a.id
          WHERE a.symbol = ANY($1)
          AND sa.time = (
            SELECT MAX(time) FROM sentiment_aggregated_1h
            WHERE asset_id = sa.asset_id
          )`,
          [assets.map(a => a.toUpperCase())]
        );

        res.json({
          data: result.rows.map(row => ({
            asset: row.symbol,
            timestamp: new Date().toISOString(),
            sentiment_score: {
              composite: row.sentiment_score,
            },
            confidence: {
              level: row.confidence_score,
            },
            volume: {
              mention_count: row.mention_count,
            },
          })),
          meta: {
            count: result.rows.length,
            timestamp: new Date().toISOString(),
            query_time_ms: Date.now() - startTime,
          },
        });
      } catch (error) {
        console.error('Error fetching bulk sentiment:', error);
        res.status(500).json({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to fetch sentiment data',
          },
        });
      }
    });

    // Historical endpoint with validated inputs
    this.app.get('/v1/historical', async (req: Request, res: Response) => {
      const startTime = Date.now();

      // Validate all query parameters
      const validation = historicalQuerySchema.safeParse(req.query);
      if (!validation.success) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: validation.error.errors.map(e => ({
              field: e.path.join('.'),
              message: e.message,
            })),
          },
        });
        return;
      }

      const { asset, start_time, end_time, interval, limit, offset } = validation.data;

      // Safe table lookup - prevents SQL injection
      const table = INTERVAL_TABLE_MAP[interval];
      if (!table) {
        res.status(400).json({
          error: {
            code: 'INVALID_INTERVAL',
            message: `Invalid interval. Must be one of: ${Object.keys(INTERVAL_TABLE_MAP).join(', ')}`,
          },
        });
        return;
      }

      try {
        const result = await this.pool.query(
          `SELECT
            time,
            sentiment_score,
            magnitude,
            confidence_score,
            mention_count,
            positive_count,
            negative_count,
            neutral_count
          FROM ${table} sa
          JOIN assets a ON sa.asset_id = a.id
          WHERE a.symbol = $1
          AND time >= $2
          AND time <= $3
          ORDER BY time ASC
          LIMIT $4 OFFSET $5`,
          [
            asset,
            new Date(start_time),
            new Date(end_time),
            limit,
            offset,
          ]
        );

        res.json({
          asset,
          start_time,
          end_time,
          interval,
          data: result.rows.map(row => ({
            timestamp: row.time,
            sentiment_score: row.sentiment_score,
            magnitude: row.magnitude,
            confidence: row.confidence_score,
            mention_count: row.mention_count,
            breakdown: {
              positive: row.positive_count,
              negative: row.negative_count,
              neutral: row.neutral_count,
            },
          })),
          pagination: {
            limit,
            offset,
            count: result.rows.length,
            has_more: result.rows.length === limit,
          },
          meta: {
            query_time_ms: Date.now() - startTime,
          },
        });
      } catch (error) {
        console.error('Error fetching historical data:', error);
        res.status(500).json({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to fetch historical data',
            requestId: req.id,
          },
        });
      }
    });

    // Real-time analysis endpoint
    this.app.post('/v1/analyze', async (req: Request, res: Response) => {
      const startTime = Date.now();

      // Validate request body
      const validation = analyzeBodySchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: validation.error.errors.map(e => ({
              field: e.path.join('.'),
              message: e.message,
            })),
          },
        });
        return;
      }

      const { text, source } = validation.data;

      try {
        const result = await this.sentimentEngine.analyze({
          id: `analyze_${Date.now()}`,
          text,
          source,
          timestamp: new Date(),
          metadata: {},
        });

        res.json({
          sentiment: {
            score: result.sentiment.raw,
            normalized: result.sentiment.normalized,
            classification: result.sentiment.label,
          },
          confidence: result.sentiment.confidence,
          emotions: result.sentiment.emotions,
          entities: result.entities,
          meta: {
            model_version: result.modelInfo.modelVersion,
            processing_time_ms: Date.now() - startTime,
          },
        });
      } catch (error) {
        console.error('Error analyzing text:', error);
        res.status(500).json({
          error: {
            code: 'ANALYSIS_FAILED',
            message: 'Failed to analyze text',
          },
        });
      }
    });

    // Metadata endpoint
    this.app.get('/v1/metadata/version', (_req: Request, res: Response) => {
      res.json({
        api_version: '1.0.0',
        schema_version: '2.1.0',
        methodology_version: '2.1.0',
        last_updated: '2026-01-19',
        changelog_url: 'https://docs.sentiment-api.io/changelog',
      });
    });

    // Assets endpoint
    this.app.get('/v1/assets', async (_req: Request, res: Response) => {
      try {
        const result = await this.pool.query<{
          symbol: string;
          name: string;
          asset_type: string;
        }>(
          `SELECT symbol, name, asset_type FROM assets WHERE is_active = true ORDER BY symbol`
        );

        res.json({
          data: result.rows,
          meta: {
            count: result.rows.length,
          },
        });
      } catch (error) {
        console.error('Error fetching assets:', error);
        res.status(500).json({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to fetch assets',
          },
        });
      }
    });

    // Pipeline metrics endpoint
    this.app.get('/v1/pipeline/status', async (_req: Request, res: Response) => {
      if (!this.pipeline) {
        res.status(503).json({
          error: {
            code: 'PIPELINE_NOT_RUNNING',
            message: 'Aggregation pipeline is not running',
          },
        });
        return;
      }

      const metrics = this.pipeline.getMetrics();
      const health = await this.pipeline.healthCheck();

      res.json({
        status: health.healthy ? 'running' : 'degraded',
        components: health.components,
        metrics: {
          items_received: metrics.itemsReceived,
          items_processed: metrics.itemsProcessed,
          items_failed: metrics.itemsFailed,
          avg_processing_time_ms: metrics.avgProcessingTimeMs,
          last_processed_at: metrics.lastProcessedAt,
        },
      });
    });
  }

  // ---------------------------------------------------------------------------
  // WEBSOCKET SETUP
  // ---------------------------------------------------------------------------

  private setupWebSocket(): void {
    this.wss.on('connection', async (ws, req) => {
      const clientId = this.extractClientId(req);
      const tier = 'professional'; // Would be looked up from database

      // Check connection limit
      const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const limitCheck = await this.wsConnectionLimiter.registerConnection(
        clientId,
        connectionId,
        tier,
        config.rateLimiting.tiers[tier]
      );

      if (!limitCheck.allowed) {
        ws.close(4029, JSON.stringify({
          error: {
            code: 'CONNECTION_LIMIT_EXCEEDED',
            message: `Maximum WebSocket connections (${limitCheck.limit}) exceeded`,
            current: limitCheck.current,
            limit: limitCheck.limit,
          },
        }));
        return;
      }

      // Create or resume session
      const sessionParam = new URL(req.url!, `http://${req.headers.host}`).searchParams.get('sessionId');
      const lastSequenceParam = new URL(req.url!, `http://${req.headers.host}`).searchParams.get('lastSequence');

      let session;
      let recoveredMessages = 0;

      if (sessionParam && lastSequenceParam) {
        const resumeResult = this.sessionManager.resumeSession(sessionParam, parseInt(lastSequenceParam));
        if (resumeResult) {
          session = resumeResult.session;
          // Send recovered messages
          for (const msg of resumeResult.recovery.messages) {
            ws.send(JSON.stringify(msg));
            recoveredMessages++;
          }
          ws.send(JSON.stringify({
            type: 'session_resume',
            sessionId: session.sessionId,
            recoveredMessages,
          }));
        }
      }

      if (!session) {
        session = this.sessionManager.createSession(clientId);
        ws.send(JSON.stringify({
          type: 'session_init',
          sessionId: session.sessionId,
          sequenceNumber: session.lastSequenceNumber,
        }));
      }

      // Handle messages
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleWebSocketMessage(ws, session!, message);
        } catch (error) {
          ws.send(JSON.stringify({
            type: 'error',
            code: 'INVALID_MESSAGE',
            message: 'Failed to parse message',
          }));
        }
      });

      // Handle close
      ws.on('close', () => {
        this.wsConnectionLimiter.unregisterConnection(clientId, connectionId);
      });

      // Heartbeat
      const heartbeatInterval = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
          ws.ping();
        }
      }, config.websocket.heartbeatInterval);

      ws.on('close', () => clearInterval(heartbeatInterval));
    });
  }

  private handleWebSocketMessage(ws: any, session: any, message: any): void {
    switch (message.type) {
      case 'subscribe':
        session.subscriptions = [...new Set([...session.subscriptions, ...message.assets])];
        ws.send(JSON.stringify({
          type: 'subscribed',
          assets: message.assets,
        }));
        break;

      case 'unsubscribe':
        session.subscriptions = session.subscriptions.filter(
          (a: string) => !message.assets.includes(a)
        );
        ws.send(JSON.stringify({
          type: 'unsubscribed',
          assets: message.assets,
        }));
        break;

      case 'heartbeat_ack':
        // Client acknowledged heartbeat
        break;

      default:
        ws.send(JSON.stringify({
          type: 'error',
          code: 'UNKNOWN_MESSAGE_TYPE',
          message: `Unknown message type: ${message.type}`,
        }));
    }
  }

  /**
   * Extracts and validates clientId from WebSocket request.
   * Returns hashed IP for anonymous/invalid clientIds to prevent spoofing.
   */
  private extractClientId(req: any): string {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientId = url.searchParams.get('clientId');

    // Validate format: alphanumeric, underscore, hyphen only, max 64 chars
    if (clientId && /^[a-zA-Z0-9_-]{1,64}$/.test(clientId)) {
      return clientId;
    }

    // Invalid or missing clientId - generate anonymous ID from IP hash
    return `anon_${this.hashIp(req.socket?.remoteAddress || 'unknown')}`;
  }

  /**
   * Creates a salted hash of an IP address for anonymous client identification.
   */
  private hashIp(ip: string): string {
    return crypto
      .createHash('sha256')
      .update(ip + this.ipSalt)
      .digest('hex')
      .slice(0, 16);
  }

  // ---------------------------------------------------------------------------
  // ERROR HANDLING
  // ---------------------------------------------------------------------------

  private setupErrorHandling(): void {
    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Endpoint ${req.method} ${req.path} not found`,
        },
        documentation: 'https://docs.sentiment-api.io',
      });
    });

    // Global error handler
    this.app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
      console.error('Unhandled error:', err);

      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: config.server.env === 'production'
            ? 'An internal error occurred'
            : err.message,
          requestId: req.id,
        },
      });
    });
  }

  // ---------------------------------------------------------------------------
  // START/STOP
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    console.log('[Application] Starting Crypto Sentiment API...');

    // Run database migrations
    if (process.env.RUN_MIGRATIONS !== 'false') {
      console.log('[Application] Running database migrations...');
      const migrator = new DatabaseMigrator();
      const migrationResult = await migrator.migrate();
      await migrator.close();

      if (!migrationResult.success) {
        console.error('[Application] Migration failed:', migrationResult.error);
        if (process.env.REQUIRE_MIGRATIONS !== 'false') {
          throw new Error(`Migration failed: ${migrationResult.error}`);
        }
      } else if (migrationResult.migrationsRun.length > 0) {
        console.log(`[Application] Ran ${migrationResult.migrationsRun.length} migration(s)`);
      } else {
        console.log('[Application] Database is up to date');
      }
    }

    // Start aggregation pipeline in production
    if (config.server.env === 'production' || process.env.START_PIPELINE === 'true') {
      console.log('[Application] Starting aggregation pipeline...');
      this.pipeline = createPipeline();
      await this.pipeline.start();

      // Update datasource health metrics
      this.pipeline.on('datasourceHealth', (status: Record<string, boolean>) => {
        for (const [source, healthy] of Object.entries(status)) {
          datasourceHealth.set({ source }, healthy ? 1 : 0);
        }
      });
    }

    // Start HTTP server
    return new Promise((resolve) => {
      this.server.listen(config.server.port, config.server.host, () => {
        console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║           CRYPTO SENTIMENT API - INSTITUTIONAL GRADE                         ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Server:     http://${config.server.host}:${config.server.port}                                          ║
║  WebSocket:  ws://${config.server.host}:${config.server.port}${config.websocket.path}                           ║
║  Metrics:    http://${config.server.host}:${config.server.port}/metrics                                  ║
║  Environment: ${config.server.env.padEnd(12)}                                             ║
║  Region:     ${config.server.region.padEnd(12)}                                             ║
║  Pipeline:   ${(this.pipeline ? 'Running' : 'Disabled').padEnd(12)}                                             ║
╚══════════════════════════════════════════════════════════════════════════════╝
        `);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    console.log('[Application] Shutting down...');

    // Stop pipeline
    if (this.pipeline) {
      await this.pipeline.stop();
    }

    // Close connections
    return new Promise((resolve) => {
      this.wss.close();
      this.redis.quit();
      this.pool.end();
      this.sessionManager.destroy();
      this.server.close(() => {
        console.log('[Application] Shutdown complete');
        resolve();
      });
    });
  }
}

// =============================================================================
// TYPE EXTENSIONS
// =============================================================================

declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

// =============================================================================
// BOOTSTRAP
// =============================================================================

const app = new Application();

app.start().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await app.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await app.stop();
  process.exit(0);
});

export default app;
