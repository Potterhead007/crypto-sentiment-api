/**
 * Input Validation Tests
 * Tests for Zod schemas and input validation
 */

import { z } from 'zod';

// Recreate schemas for testing (mimics src/index.ts schemas)
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

describe('Input Validation Schemas', () => {
  describe('assetSymbolSchema', () => {
    it('should accept valid asset symbols', () => {
      expect(assetSymbolSchema.parse('BTC')).toBe('BTC');
      expect(assetSymbolSchema.parse('eth')).toBe('ETH');
      expect(assetSymbolSchema.parse('Btc')).toBe('BTC');
      expect(assetSymbolSchema.parse('SOL')).toBe('SOL');
      expect(assetSymbolSchema.parse('USDT')).toBe('USDT');
    });

    it('should transform to uppercase', () => {
      expect(assetSymbolSchema.parse('btc')).toBe('BTC');
      expect(assetSymbolSchema.parse('Eth')).toBe('ETH');
    });

    it('should accept alphanumeric symbols', () => {
      expect(assetSymbolSchema.parse('USDC')).toBe('USDC');
      expect(assetSymbolSchema.parse('1INCH')).toBe('1INCH');
    });

    it('should reject empty strings', () => {
      expect(() => assetSymbolSchema.parse('')).toThrow();
    });

    it('should reject symbols longer than 10 characters', () => {
      expect(() => assetSymbolSchema.parse('VERYLONGASSET')).toThrow();
    });

    it('should reject symbols with special characters', () => {
      expect(() => assetSymbolSchema.parse('BTC!')).toThrow();
      expect(() => assetSymbolSchema.parse('ETH-USD')).toThrow();
      expect(() => assetSymbolSchema.parse('BTC.USD')).toThrow();
      expect(() => assetSymbolSchema.parse('BTC USD')).toThrow();
    });

    it('should reject symbols with SQL injection attempts', () => {
      expect(() => assetSymbolSchema.parse("'; DROP TABLE--")).toThrow();
      expect(() => assetSymbolSchema.parse('BTC; DELETE')).toThrow();
    });
  });

  describe('assetsQuerySchema', () => {
    it('should parse comma-separated assets', () => {
      const result = assetsQuerySchema.parse('BTC,ETH,SOL');
      expect(result).toEqual(['BTC', 'ETH', 'SOL']);
    });

    it('should trim whitespace', () => {
      const result = assetsQuerySchema.parse('BTC, ETH , SOL');
      expect(result).toEqual(['BTC', 'ETH', 'SOL']);
    });

    it('should transform to uppercase', () => {
      const result = assetsQuerySchema.parse('btc,eth,sol');
      expect(result).toEqual(['BTC', 'ETH', 'SOL']);
    });

    it('should accept single asset', () => {
      const result = assetsQuerySchema.parse('BTC');
      expect(result).toEqual(['BTC']);
    });

    it('should reject empty string', () => {
      expect(() => assetsQuerySchema.parse('')).toThrow();
    });

    it('should reject more than 50 assets', () => {
      const manyAssets = Array.from({ length: 51 }, (_, i) => `A${i}`).join(',');
      expect(() => assetsQuerySchema.parse(manyAssets)).toThrow();
    });

    it('should accept up to 50 assets', () => {
      const assets = Array.from({ length: 50 }, (_, i) => `A${i}`).join(',');
      const result = assetsQuerySchema.parse(assets);
      expect(result).toHaveLength(50);
    });
  });

  describe('intervalSchema', () => {
    it('should accept valid intervals', () => {
      expect(intervalSchema.parse('1m')).toBe('1m');
      expect(intervalSchema.parse('1h')).toBe('1h');
      expect(intervalSchema.parse('1d')).toBe('1d');
    });

    it('should reject invalid intervals', () => {
      expect(() => intervalSchema.parse('5m')).toThrow();
      expect(() => intervalSchema.parse('4h')).toThrow();
      expect(() => intervalSchema.parse('1w')).toThrow();
      expect(() => intervalSchema.parse('')).toThrow();
      expect(() => intervalSchema.parse('invalid')).toThrow();
    });
  });

  describe('dateStringSchema', () => {
    it('should accept valid ISO date strings', () => {
      expect(dateStringSchema.parse('2024-01-15T00:00:00Z')).toBe('2024-01-15T00:00:00Z');
      expect(dateStringSchema.parse('2024-01-15')).toBe('2024-01-15');
    });

    it('should accept various date formats', () => {
      expect(dateStringSchema.parse('2024-01-15T12:30:00')).toBe('2024-01-15T12:30:00');
      expect(dateStringSchema.parse('January 15, 2024')).toBe('January 15, 2024');
    });

    it('should reject invalid date strings', () => {
      expect(() => dateStringSchema.parse('not-a-date')).toThrow();
      expect(() => dateStringSchema.parse('2024-13-45')).toThrow();
      expect(() => dateStringSchema.parse('')).toThrow();
    });
  });

  describe('historicalQuerySchema', () => {
    const validQuery = {
      asset: 'BTC',
      start_time: '2024-01-01T00:00:00Z',
      end_time: '2024-01-15T00:00:00Z',
    };

    it('should parse valid query with defaults', () => {
      const result = historicalQuerySchema.parse(validQuery);
      expect(result.asset).toBe('BTC');
      expect(result.interval).toBe('1h'); // default
      expect(result.limit).toBe(1000); // default
      expect(result.offset).toBe(0); // default
    });

    it('should parse query with all fields', () => {
      const fullQuery = {
        ...validQuery,
        interval: '1d',
        limit: '500',
        offset: '100',
      };
      const result = historicalQuerySchema.parse(fullQuery);
      expect(result.interval).toBe('1d');
      expect(result.limit).toBe(500);
      expect(result.offset).toBe(100);
    });

    it('should coerce string numbers', () => {
      const query = {
        ...validQuery,
        limit: '100',
        offset: '50',
      };
      const result = historicalQuerySchema.parse(query);
      expect(result.limit).toBe(100);
      expect(result.offset).toBe(50);
    });

    it('should reject limit > 10000', () => {
      const query = { ...validQuery, limit: 20000 };
      expect(() => historicalQuerySchema.parse(query)).toThrow();
    });

    it('should reject limit < 1', () => {
      const query = { ...validQuery, limit: 0 };
      expect(() => historicalQuerySchema.parse(query)).toThrow();
    });

    it('should reject negative offset', () => {
      const query = { ...validQuery, offset: -1 };
      expect(() => historicalQuerySchema.parse(query)).toThrow();
    });

    it('should require asset', () => {
      const query = { start_time: validQuery.start_time, end_time: validQuery.end_time };
      expect(() => historicalQuerySchema.parse(query)).toThrow();
    });

    it('should require start_time', () => {
      const query = { asset: 'BTC', end_time: validQuery.end_time };
      expect(() => historicalQuerySchema.parse(query)).toThrow();
    });

    it('should require end_time', () => {
      const query = { asset: 'BTC', start_time: validQuery.start_time };
      expect(() => historicalQuerySchema.parse(query)).toThrow();
    });
  });

  describe('analyzeBodySchema', () => {
    it('should parse valid body with defaults', () => {
      const result = analyzeBodySchema.parse({ text: 'Test sentiment' });
      expect(result.text).toBe('Test sentiment');
      expect(result.source).toBe('news'); // default
    });

    it('should parse body with source', () => {
      const result = analyzeBodySchema.parse({ text: 'Test', source: 'twitter' });
      expect(result.source).toBe('twitter');
    });

    it('should accept all valid sources', () => {
      const sources = ['twitter', 'reddit', 'news', 'discord', 'telegram', 'onchain'];
      for (const source of sources) {
        const result = analyzeBodySchema.parse({ text: 'Test', source });
        expect(result.source).toBe(source);
      }
    });

    it('should reject invalid source', () => {
      expect(() => analyzeBodySchema.parse({ text: 'Test', source: 'invalid' })).toThrow();
    });

    it('should reject empty text', () => {
      expect(() => analyzeBodySchema.parse({ text: '' })).toThrow();
    });

    it('should reject text longer than 10000 characters', () => {
      const longText = 'a'.repeat(10001);
      expect(() => analyzeBodySchema.parse({ text: longText })).toThrow();
    });

    it('should accept text up to 10000 characters', () => {
      const maxText = 'a'.repeat(10000);
      const result = analyzeBodySchema.parse({ text: maxText });
      expect(result.text).toHaveLength(10000);
    });

    it('should require text field', () => {
      expect(() => analyzeBodySchema.parse({})).toThrow();
      expect(() => analyzeBodySchema.parse({ source: 'twitter' })).toThrow();
    });
  });

  describe('SQL Injection Prevention', () => {
    const sqlInjectionAttempts = [
      "'; DROP TABLE users;--",
      "1' OR '1'='1",
      "1; DELETE FROM sentiment_raw;",
      "UNION SELECT * FROM api_keys",
      "'; INSERT INTO api_keys",
      "${table}",
      "{{constructor.constructor('return this')()}}",
    ];

    it('should reject SQL injection in asset symbol', () => {
      for (const attempt of sqlInjectionAttempts) {
        expect(() => assetSymbolSchema.parse(attempt)).toThrow();
      }
    });

    it('should reject SQL injection in assets query', () => {
      for (const attempt of sqlInjectionAttempts) {
        const result = assetsQuerySchema.safeParse(attempt);
        // Either throws or produces invalid symbols
        if (result.success) {
          expect(result.data.every(a => /^[A-Z0-9]+$/.test(a))).toBe(true);
        }
      }
    });
  });
});
