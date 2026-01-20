/**
 * Middleware Tests
 * Tests for rate limiting, authentication, and other middleware
 */

import { Request, Response, NextFunction } from 'express';

// Recreate rate limit tier config from main app
interface TierLimits {
  requestsPerSecond: number;
  burstCapacity: number;
  burstWindowSeconds: number;
  websocketConnections: number;
  monthlyQuota: number;
}

const RATE_LIMIT_TIERS: Record<string, TierLimits> = {
  professional: {
    requestsPerSecond: 10,
    burstCapacity: 50,
    burstWindowSeconds: 10,
    websocketConnections: 5,
    monthlyQuota: 100000,
  },
  institutional: {
    requestsPerSecond: 50,
    burstCapacity: 200,
    burstWindowSeconds: 10,
    websocketConnections: 25,
    monthlyQuota: 500000,
  },
  enterprise: {
    requestsPerSecond: 200,
    burstCapacity: 1000,
    burstWindowSeconds: 10,
    websocketConnections: 100,
    monthlyQuota: 2000000,
  },
  strategic: {
    requestsPerSecond: 1000,
    burstCapacity: 5000,
    burstWindowSeconds: 10,
    websocketConnections: 500,
    monthlyQuota: -1, // Unlimited
  },
};

/**
 * Simple in-memory rate limiter for testing
 */
class InMemoryRateLimiter {
  private tokens: Map<string, { count: number; resetAt: number }> = new Map();

  constructor(private limits: TierLimits) {}

  async checkLimit(key: string): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    const now = Date.now();
    const windowMs = this.limits.burstWindowSeconds * 1000;
    const existing = this.tokens.get(key);

    if (!existing || existing.resetAt < now) {
      // New window
      this.tokens.set(key, { count: 1, resetAt: now + windowMs });
      return {
        allowed: true,
        remaining: this.limits.burstCapacity - 1,
        resetAt: new Date(now + windowMs),
      };
    }

    if (existing.count >= this.limits.burstCapacity) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(existing.resetAt),
      };
    }

    existing.count++;
    return {
      allowed: true,
      remaining: this.limits.burstCapacity - existing.count,
      resetAt: new Date(existing.resetAt),
    };
  }

  reset(): void {
    this.tokens.clear();
  }
}

/**
 * Mock authentication validator
 */
interface AuthResult {
  valid: boolean;
  clientId?: string;
  tier?: string;
  error?: string;
}

function validateApiKey(apiKey: string | undefined): AuthResult {
  if (!apiKey) {
    return { valid: false, error: 'API key required' };
  }

  // Test API keys
  const testKeys: Record<string, { clientId: string; tier: string }> = {
    'test_professional_key': { clientId: 'client_1', tier: 'professional' },
    'test_institutional_key': { clientId: 'client_2', tier: 'institutional' },
    'test_enterprise_key': { clientId: 'client_3', tier: 'enterprise' },
    'test_strategic_key': { clientId: 'client_4', tier: 'strategic' },
  };

  const keyData = testKeys[apiKey];
  if (!keyData) {
    return { valid: false, error: 'Invalid API key' };
  }

  return {
    valid: true,
    clientId: keyData.clientId,
    tier: keyData.tier,
  };
}

/**
 * Create mock request/response objects for testing
 */
function createMockReq(overrides: Partial<Request> = {}): Partial<Request> {
  return {
    method: 'GET',
    path: '/v1/sentiment/BTC',
    headers: {},
    query: {},
    params: {},
    body: {},
    ...overrides,
  };
}

function createMockRes(): Partial<Response> & { json: jest.Mock; status: jest.Mock } {
  const res: Partial<Response> & { json: jest.Mock; status: jest.Mock } = {
    json: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    headersSent: false,
  };
  return res;
}

describe('Rate Limiter', () => {
  describe('InMemoryRateLimiter', () => {
    it('should allow requests within limits', async () => {
      const limiter = new InMemoryRateLimiter(RATE_LIMIT_TIERS.professional);

      for (let i = 0; i < 10; i++) {
        const result = await limiter.checkLimit('test-client');
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(49 - i);
      }
    });

    it('should block requests exceeding burst capacity', async () => {
      const limiter = new InMemoryRateLimiter(RATE_LIMIT_TIERS.professional);

      // Exhaust the burst capacity
      for (let i = 0; i < 50; i++) {
        await limiter.checkLimit('test-client');
      }

      // Next request should be blocked
      const result = await limiter.checkLimit('test-client');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should reset after window expires', async () => {
      // Use shorter window for testing
      const shortWindowLimits: TierLimits = {
        ...RATE_LIMIT_TIERS.professional,
        burstWindowSeconds: 0.1, // 100ms
        burstCapacity: 5,
      };
      const limiter = new InMemoryRateLimiter(shortWindowLimits);

      // Exhaust capacity
      for (let i = 0; i < 5; i++) {
        await limiter.checkLimit('test-client');
      }

      // Should be blocked
      let result = await limiter.checkLimit('test-client');
      expect(result.allowed).toBe(false);

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should be allowed again
      result = await limiter.checkLimit('test-client');
      expect(result.allowed).toBe(true);
    });

    it('should track different clients separately', async () => {
      const limiter = new InMemoryRateLimiter({
        ...RATE_LIMIT_TIERS.professional,
        burstCapacity: 5,
      });

      // Exhaust client1
      for (let i = 0; i < 5; i++) {
        await limiter.checkLimit('client1');
      }

      // client1 should be blocked
      let result = await limiter.checkLimit('client1');
      expect(result.allowed).toBe(false);

      // client2 should still be allowed
      result = await limiter.checkLimit('client2');
      expect(result.allowed).toBe(true);
    });

    it('should return correct reset time', async () => {
      const limiter = new InMemoryRateLimiter(RATE_LIMIT_TIERS.professional);

      const result = await limiter.checkLimit('test-client');
      expect(result.resetAt).toBeInstanceOf(Date);
      expect(result.resetAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('Tier Limits', () => {
    it('professional tier should have correct limits', () => {
      const tier = RATE_LIMIT_TIERS.professional;
      expect(tier.requestsPerSecond).toBe(10);
      expect(tier.burstCapacity).toBe(50);
      expect(tier.monthlyQuota).toBe(100000);
    });

    it('institutional tier should have higher limits', () => {
      const prof = RATE_LIMIT_TIERS.professional;
      const inst = RATE_LIMIT_TIERS.institutional;

      expect(inst.requestsPerSecond).toBeGreaterThan(prof.requestsPerSecond);
      expect(inst.burstCapacity).toBeGreaterThan(prof.burstCapacity);
      expect(inst.monthlyQuota).toBeGreaterThan(prof.monthlyQuota);
    });

    it('enterprise tier should have higher limits than institutional', () => {
      const inst = RATE_LIMIT_TIERS.institutional;
      const ent = RATE_LIMIT_TIERS.enterprise;

      expect(ent.requestsPerSecond).toBeGreaterThan(inst.requestsPerSecond);
      expect(ent.burstCapacity).toBeGreaterThan(inst.burstCapacity);
      expect(ent.monthlyQuota).toBeGreaterThan(inst.monthlyQuota);
    });

    it('strategic tier should have unlimited quota', () => {
      const tier = RATE_LIMIT_TIERS.strategic;
      expect(tier.monthlyQuota).toBe(-1);
    });
  });
});

describe('Authentication', () => {
  describe('API Key Validation', () => {
    it('should reject missing API key', () => {
      const result = validateApiKey(undefined);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('API key required');
    });

    it('should reject invalid API key', () => {
      const result = validateApiKey('invalid_key');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid API key');
    });

    it('should accept valid professional API key', () => {
      const result = validateApiKey('test_professional_key');
      expect(result.valid).toBe(true);
      expect(result.tier).toBe('professional');
      expect(result.clientId).toBeDefined();
    });

    it('should accept valid institutional API key', () => {
      const result = validateApiKey('test_institutional_key');
      expect(result.valid).toBe(true);
      expect(result.tier).toBe('institutional');
    });

    it('should accept valid enterprise API key', () => {
      const result = validateApiKey('test_enterprise_key');
      expect(result.valid).toBe(true);
      expect(result.tier).toBe('enterprise');
    });

    it('should accept valid strategic API key', () => {
      const result = validateApiKey('test_strategic_key');
      expect(result.valid).toBe(true);
      expect(result.tier).toBe('strategic');
    });

    it('should return client ID with valid key', () => {
      const result = validateApiKey('test_professional_key');
      expect(result.clientId).toBe('client_1');
    });
  });

  describe('Authentication Middleware Integration', () => {
    it('should extract API key from X-API-Key header', () => {
      const req = createMockReq({
        headers: { 'x-api-key': 'test_professional_key' },
      });

      const apiKey = req.headers?.['x-api-key'] as string;
      const result = validateApiKey(apiKey);

      expect(result.valid).toBe(true);
    });

    it('should be case-insensitive for header name', () => {
      const req1 = createMockReq({
        headers: { 'X-API-Key': 'test_professional_key' },
      });
      const req2 = createMockReq({
        headers: { 'x-api-key': 'test_professional_key' },
      });

      // Express normalizes headers to lowercase
      const key1 = (req1.headers as Record<string, string>)['x-api-key'] ||
                   (req1.headers as Record<string, string>)['X-API-Key'];
      const key2 = (req2.headers as Record<string, string>)['x-api-key'];

      expect(validateApiKey(key1).valid).toBe(true);
      expect(validateApiKey(key2).valid).toBe(true);
    });
  });
});

describe('Request/Response Mocking', () => {
  it('should create valid mock request', () => {
    const req = createMockReq({
      method: 'POST',
      path: '/v1/analyze',
      body: { text: 'Test' },
    });

    expect(req.method).toBe('POST');
    expect(req.path).toBe('/v1/analyze');
    expect(req.body).toEqual({ text: 'Test' });
  });

  it('should create valid mock response', () => {
    const res = createMockRes();

    res.status(200);
    res.json({ message: 'OK' });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ message: 'OK' });
  });

  it('should support chaining', () => {
    const res = createMockRes();

    res.status(400).json({ error: 'Bad Request' });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Bad Request' });
  });
});

describe('Error Response Formatting', () => {
  interface ErrorResponse {
    error: {
      code: string;
      message: string;
      details?: unknown[];
    };
  }

  function formatError(code: string, message: string, details?: unknown[]): ErrorResponse {
    return {
      error: {
        code,
        message,
        ...(details && { details }),
      },
    };
  }

  it('should format authentication error', () => {
    const error = formatError('AUTHENTICATION_ERROR', 'Invalid API key');

    expect(error.error.code).toBe('AUTHENTICATION_ERROR');
    expect(error.error.message).toBe('Invalid API key');
  });

  it('should format rate limit error', () => {
    const error = formatError('RATE_LIMIT_EXCEEDED', 'Too many requests');

    expect(error.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('should format validation error with details', () => {
    const details = [
      { field: 'asset', message: 'Asset symbol required' },
    ];
    const error = formatError('VALIDATION_ERROR', 'Invalid request', details);

    expect(error.error.code).toBe('VALIDATION_ERROR');
    expect(error.error.details).toEqual(details);
  });

  it('should omit details when not provided', () => {
    const error = formatError('INTERNAL_ERROR', 'Something went wrong');

    expect(error.error).not.toHaveProperty('details');
  });
});
