/**
 * API Integration Tests
 * Tests for API endpoints using a minimal test server
 *
 * Note: These tests run against a minimal Express server without
 * database/Redis dependencies. Full integration tests with services
 * should be run in CI/CD with Docker Compose services.
 */

import express, { Express, Request, Response } from 'express';
import request from 'supertest';
import { z } from 'zod';

// Recreate validation schemas from main app
const assetSymbolSchema = z.string()
  .min(1, 'Asset symbol required')
  .max(10, 'Asset symbol too long')
  .regex(/^[A-Z0-9]+$/i, 'Invalid asset symbol format')
  .transform(s => s.toUpperCase());

const intervalSchema = z.enum(['1m', '1h', '1d']);

const INTERVAL_TABLE_MAP: Record<string, string> = {
  '1m': 'sentiment_aggregated_1m',
  '1h': 'sentiment_aggregated_1h',
  '1d': 'sentiment_aggregated_1d',
} as const;

const historicalQuerySchema = z.object({
  asset: assetSymbolSchema,
  start_time: z.string().refine(s => !isNaN(Date.parse(s)), { message: 'Invalid date format' }),
  end_time: z.string().refine(s => !isNaN(Date.parse(s)), { message: 'Invalid date format' }),
  interval: intervalSchema.default('1h'),
  limit: z.coerce.number().int().min(1).max(10000).default(1000),
  offset: z.coerce.number().int().min(0).default(0),
});

const analyzeBodySchema = z.object({
  text: z.string().min(1, 'Text is required').max(10000, 'Text exceeds 10000 character limit'),
  source: z.enum(['twitter', 'reddit', 'news', 'discord', 'telegram', 'onchain']).default('news'),
});

/**
 * Create a minimal test Express app that mimics the main API
 * without requiring database/Redis connections
 */
function createTestApp(): Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Health endpoints
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    });
  });

  app.get('/health/live', (_req: Request, res: Response) => {
    res.json({ status: 'alive' });
  });

  // Metadata endpoint
  app.get('/v1/metadata/version', (_req: Request, res: Response) => {
    res.json({
      api_version: '1.0.0',
      schema_version: '2.1.0',
      methodology_version: '2.1.0',
      last_updated: '2026-01-19',
    });
  });

  // Mock sentiment endpoint with validation
  app.get('/v1/sentiment/:asset', (req: Request, res: Response) => {
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

    // Return mock data
    res.json({
      asset,
      timestamp: new Date().toISOString(),
      sentiment_score: {
        composite: 0.35,
        magnitude: 0.6,
        scale: '-1 to 1 normalized',
      },
      confidence: {
        level: 0.85,
        interval_95: [0.28, 0.42],
      },
      emotions: {
        fear: 0.15,
        greed: 0.45,
        uncertainty: 0.20,
        optimism: 0.55,
      },
      volume: {
        mention_count: 1500,
      },
    });
  });

  // Mock historical endpoint with validation
  app.get('/v1/historical', (req: Request, res: Response) => {
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

    // Verify table mapping (SQL injection prevention)
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

    // Return mock data
    res.json({
      asset,
      start_time,
      end_time,
      interval,
      data: [
        {
          timestamp: start_time,
          sentiment_score: 0.35,
          magnitude: 0.6,
          confidence: 0.85,
          mention_count: 150,
          breakdown: { positive: 80, negative: 30, neutral: 40 },
        },
      ],
      pagination: {
        limit,
        offset,
        count: 1,
        has_more: false,
      },
    });
  });

  // Mock analyze endpoint with validation
  app.post('/v1/analyze', (req: Request, res: Response) => {
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

    // Return mock analysis
    res.json({
      sentiment: {
        score: 0.4,
        normalized: 0.7,
        classification: 'bullish',
      },
      confidence: 0.85,
      emotions: {
        fear: 0.1,
        greed: 0.3,
        uncertainty: 0.15,
        optimism: 0.5,
        anger: 0.05,
        excitement: 0.35,
      },
      entities: [
        { text: 'BTC', type: 'asset', normalizedName: 'BTC', confidence: 0.95 },
      ],
      meta: {
        model_version: '1.0.0',
        processing_time_ms: 50,
        source,
        text_length: text.length,
      },
    });
  });

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: `Endpoint ${req.method} ${req.path} not found`,
      },
    });
  });

  return app;
}

describe('API Endpoints', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  describe('Health Endpoints', () => {
    it('GET /health should return healthy status', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.version).toBeDefined();
    });

    it('GET /health/live should return alive status', async () => {
      const response = await request(app).get('/health/live');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('alive');
    });
  });

  describe('Metadata Endpoints', () => {
    it('GET /v1/metadata/version should return version info', async () => {
      const response = await request(app).get('/v1/metadata/version');

      expect(response.status).toBe(200);
      expect(response.body.api_version).toBeDefined();
      expect(response.body.schema_version).toBeDefined();
      expect(response.body.methodology_version).toBeDefined();
    });
  });

  describe('Sentiment Endpoints', () => {
    describe('GET /v1/sentiment/:asset', () => {
      it('should return sentiment for valid asset', async () => {
        const response = await request(app).get('/v1/sentiment/BTC');

        expect(response.status).toBe(200);
        expect(response.body.asset).toBe('BTC');
        expect(response.body.sentiment_score).toBeDefined();
        expect(response.body.confidence).toBeDefined();
        expect(response.body.emotions).toBeDefined();
      });

      it('should normalize lowercase asset symbols', async () => {
        const response = await request(app).get('/v1/sentiment/btc');

        expect(response.status).toBe(200);
        expect(response.body.asset).toBe('BTC');
      });

      it('should reject invalid asset symbols', async () => {
        const response = await request(app).get('/v1/sentiment/BTC!');

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      });

      it('should reject empty asset symbols', async () => {
        const response = await request(app).get('/v1/sentiment/');

        expect(response.status).toBe(404); // Express treats this as different route
      });

      it('should reject asset symbols with SQL injection', async () => {
        const response = await request(app).get("/v1/sentiment/'; DROP TABLE--");

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      });

      it('should return proper response structure', async () => {
        const response = await request(app).get('/v1/sentiment/ETH');

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          asset: 'ETH',
          sentiment_score: {
            composite: expect.any(Number),
            magnitude: expect.any(Number),
          },
          confidence: {
            level: expect.any(Number),
            interval_95: expect.any(Array),
          },
          emotions: {
            fear: expect.any(Number),
            greed: expect.any(Number),
            uncertainty: expect.any(Number),
            optimism: expect.any(Number),
          },
          volume: {
            mention_count: expect.any(Number),
          },
        });
      });
    });
  });

  describe('Historical Endpoint', () => {
    const validParams = {
      asset: 'BTC',
      start_time: '2024-01-01T00:00:00Z',
      end_time: '2024-01-15T00:00:00Z',
    };

    describe('GET /v1/historical', () => {
      it('should return historical data with valid params', async () => {
        const response = await request(app)
          .get('/v1/historical')
          .query(validParams);

        expect(response.status).toBe(200);
        expect(response.body.asset).toBe('BTC');
        expect(response.body.data).toBeInstanceOf(Array);
        expect(response.body.pagination).toBeDefined();
      });

      it('should apply default interval', async () => {
        const response = await request(app)
          .get('/v1/historical')
          .query(validParams);

        expect(response.status).toBe(200);
        expect(response.body.interval).toBe('1h');
      });

      it('should accept custom interval', async () => {
        const response = await request(app)
          .get('/v1/historical')
          .query({ ...validParams, interval: '1d' });

        expect(response.status).toBe(200);
        expect(response.body.interval).toBe('1d');
      });

      it('should reject invalid interval', async () => {
        const response = await request(app)
          .get('/v1/historical')
          .query({ ...validParams, interval: '5m' });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      });

      it('should apply default pagination', async () => {
        const response = await request(app)
          .get('/v1/historical')
          .query(validParams);

        expect(response.status).toBe(200);
        expect(response.body.pagination.limit).toBe(1000);
        expect(response.body.pagination.offset).toBe(0);
      });

      it('should accept custom pagination', async () => {
        const response = await request(app)
          .get('/v1/historical')
          .query({ ...validParams, limit: 100, offset: 50 });

        expect(response.status).toBe(200);
        expect(response.body.pagination.limit).toBe(100);
        expect(response.body.pagination.offset).toBe(50);
      });

      it('should reject limit > 10000', async () => {
        const response = await request(app)
          .get('/v1/historical')
          .query({ ...validParams, limit: 20000 });

        expect(response.status).toBe(400);
      });

      it('should reject missing asset', async () => {
        const response = await request(app)
          .get('/v1/historical')
          .query({ start_time: validParams.start_time, end_time: validParams.end_time });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      });

      it('should reject missing date range', async () => {
        const response = await request(app)
          .get('/v1/historical')
          .query({ asset: 'BTC' });

        expect(response.status).toBe(400);
      });

      it('should reject invalid date format', async () => {
        const response = await request(app)
          .get('/v1/historical')
          .query({ ...validParams, start_time: 'not-a-date' });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      });
    });
  });

  describe('Analyze Endpoint', () => {
    describe('POST /v1/analyze', () => {
      it('should analyze valid text', async () => {
        const response = await request(app)
          .post('/v1/analyze')
          .send({ text: 'Bitcoin is bullish!' });

        expect(response.status).toBe(200);
        expect(response.body.sentiment).toBeDefined();
        expect(response.body.confidence).toBeDefined();
        expect(response.body.emotions).toBeDefined();
        expect(response.body.entities).toBeDefined();
      });

      it('should use default source', async () => {
        const response = await request(app)
          .post('/v1/analyze')
          .send({ text: 'Test text' });

        expect(response.status).toBe(200);
        expect(response.body.meta.source).toBe('news');
      });

      it('should accept custom source', async () => {
        const response = await request(app)
          .post('/v1/analyze')
          .send({ text: 'Test text', source: 'twitter' });

        expect(response.status).toBe(200);
        expect(response.body.meta.source).toBe('twitter');
      });

      it('should reject invalid source', async () => {
        const response = await request(app)
          .post('/v1/analyze')
          .send({ text: 'Test text', source: 'invalid' });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      });

      it('should reject empty text', async () => {
        const response = await request(app)
          .post('/v1/analyze')
          .send({ text: '' });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      });

      it('should reject missing text', async () => {
        const response = await request(app)
          .post('/v1/analyze')
          .send({});

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      });

      it('should reject text > 10000 characters', async () => {
        const longText = 'a'.repeat(10001);
        const response = await request(app)
          .post('/v1/analyze')
          .send({ text: longText });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      });

      it('should accept text up to 10000 characters', async () => {
        const maxText = 'a'.repeat(10000);
        const response = await request(app)
          .post('/v1/analyze')
          .send({ text: maxText });

        expect(response.status).toBe(200);
        expect(response.body.meta.text_length).toBe(10000);
      });

      it('should return proper response structure', async () => {
        const response = await request(app)
          .post('/v1/analyze')
          .send({ text: 'BTC is mooning!' });

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          sentiment: {
            score: expect.any(Number),
            normalized: expect.any(Number),
            classification: expect.any(String),
          },
          confidence: expect.any(Number),
          emotions: expect.any(Object),
          entities: expect.any(Array),
          meta: {
            model_version: expect.any(String),
            processing_time_ms: expect.any(Number),
          },
        });
      });
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown endpoints', async () => {
      const response = await request(app).get('/v1/unknown');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 404 for unknown methods', async () => {
      const response = await request(app).delete('/v1/sentiment/BTC');

      expect(response.status).toBe(404);
    });
  });

  describe('Content-Type Handling', () => {
    it('should accept application/json', async () => {
      const response = await request(app)
        .post('/v1/analyze')
        .set('Content-Type', 'application/json')
        .send({ text: 'Test' });

      expect(response.status).toBe(200);
    });

    it('should handle missing content-type for GET requests', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
    });
  });
});
