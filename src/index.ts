/**
 * Application Entry Point
 * Institutional-Grade Cryptocurrency Market Sentiment Analysis API
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { createServer, Server } from 'http';
import { WebSocketServer } from 'ws';
import Redis from 'ioredis';

import config, { validateConfig } from './config/default';
import { createRateLimitMiddleware, WebSocketConnectionLimiter } from './middleware/rateLimiter';
import { SessionManager } from './websocket/reconnectionProtocol';

// =============================================================================
// APPLICATION SETUP
// =============================================================================

class Application {
  private app: Express;
  private server: Server;
  private wss: WebSocketServer;
  private redis: Redis;
  private sessionManager: SessionManager;
  private wsConnectionLimiter: WebSocketConnectionLimiter;

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

    // Initialize WebSocket
    this.wss = new WebSocketServer({
      server: this.server,
      path: config.websocket.path,
    });

    // Initialize session manager
    this.sessionManager = new SessionManager({
      bufferDurationMs: config.websocket.messageBufferDuration,
      maxBufferSize: 10000,
      recoveryEndpoint: '/v1/stream/replay',
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
    // Security middleware
    this.app.use(helmet());
    this.app.use(cors({
      origin: config.security.corsOrigins,
      credentials: true,
    }));

    // Compression
    this.app.use(compression());

    // Body parsing
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Request ID
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      req.id = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      res.setHeader('X-Request-Id', req.id);
      next();
    });

    // Rate limiting
    if (config.rateLimiting.enabled) {
      this.app.use(createRateLimitMiddleware({
        redis: this.redis,
        getClientContext: async (req: Request) => {
          // In production, extract from JWT or API key
          const apiKey = req.headers[config.security.apiKeyHeader.toLowerCase()] as string;
          return {
            clientId: apiKey || 'anonymous',
            tier: 'professional', // Default tier, would be looked up from database
          };
        },
        skip: (req: Request) => {
          // Skip rate limiting for health checks
          return req.path === '/health' || req.path === '/health/ready';
        },
      }));
    }
  }

  // ---------------------------------------------------------------------------
  // ROUTES SETUP
  // ---------------------------------------------------------------------------

  private setupRoutes(): void {
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

        res.json({
          status: 'ready',
          timestamp: new Date().toISOString(),
          components: {
            redis: { status: 'healthy' },
            // Add other component checks
          },
        });
      } catch (error) {
        res.status(503).json({
          status: 'not_ready',
          error: (error as Error).message,
        });
      }
    });

    this.app.get('/health/live', (_req: Request, res: Response) => {
      res.json({ status: 'alive' });
    });

    // API v1 routes
    this.app.get('/v1/sentiment/:asset', async (req: Request, res: Response) => {
      const { asset } = req.params;

      // Placeholder - would fetch from sentiment engine
      res.json({
        asset: asset.toUpperCase(),
        timestamp: new Date().toISOString(),
        sentiment_score: {
          composite: 0.72,
          scale: '0-1 normalized',
        },
        confidence: {
          level: 0.89,
          interval_95: [0.68, 0.76],
        },
        // ... full schema as defined in spec
      });
    });

    this.app.get('/v1/sentiment', async (req: Request, res: Response) => {
      const assets = (req.query.assets as string)?.split(',') || ['BTC', 'ETH'];

      res.json({
        data: assets.map(asset => ({
          asset: asset.toUpperCase(),
          timestamp: new Date().toISOString(),
          sentiment_score: {
            composite: Math.random() * 0.4 + 0.5, // Placeholder
          },
        })),
        meta: {
          count: assets.length,
          timestamp: new Date().toISOString(),
        },
      });
    });

    // Historical endpoint
    this.app.get('/v1/historical', async (req: Request, res: Response) => {
      const { asset, start_time, end_time, interval } = req.query;

      res.json({
        asset,
        start_time,
        end_time,
        interval,
        data: [], // Placeholder
        meta: {
          count: 0,
          query_time_ms: 45,
        },
      });
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

  private extractClientId(req: any): string {
    const url = new URL(req.url, `http://${req.headers.host}`);
    return url.searchParams.get('clientId') || 'anonymous';
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
    return new Promise((resolve) => {
      this.server.listen(config.server.port, config.server.host, () => {
        console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║           CRYPTO SENTIMENT API - INSTITUTIONAL GRADE                         ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Server:     http://${config.server.host}:${config.server.port}                                          ║
║  WebSocket:  ws://${config.server.host}:${config.server.port}${config.websocket.path}                           ║
║  Environment: ${config.server.env.padEnd(12)}                                             ║
║  Region:     ${config.server.region.padEnd(12)}                                             ║
╚══════════════════════════════════════════════════════════════════════════════╝
        `);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.close();
      this.redis.quit();
      this.sessionManager.destroy();
      this.server.close(() => resolve());
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
