/**
 * Rate Limiting Middleware
 * Institutional-Grade Cryptocurrency Market Sentiment Analysis API
 *
 * Implements token bucket algorithm with tier-based limits and proper 429 responses.
 */

import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';
import appConfig from '../config/default';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

export type TierName = 'anonymous' | 'professional' | 'institutional' | 'enterprise' | 'strategic';

export interface TierLimits {
  requestsPerSecond: number;
  burstCapacity: number;
  burstWindowSeconds: number;
  websocketConnections: number;
  monthlyQuota: number;
}

export interface RateLimitConfig {
  tiers: Record<TierName, TierLimits>;
  redis: {
    host: string;
    port: number;
    keyPrefix: string;
  };
  headers: {
    enabled: boolean;
    includeRetryAfter: boolean;
  };
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number; // Unix timestamp
  retryAfter?: number; // Seconds
}

export interface ClientContext {
  clientId: string;
  tier: TierName;
  customLimits?: Partial<TierLimits>;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

export const DEFAULT_CONFIG: RateLimitConfig = {
  tiers: {
    // Anonymous tier - heavily restricted for unauthenticated requests
    anonymous: {
      requestsPerSecond: 1,
      burstCapacity: 10,
      burstWindowSeconds: 60,
      websocketConnections: 1,
      monthlyQuota: 1_000,
    },
    professional: {
      requestsPerSecond: 10,
      burstCapacity: 50,
      burstWindowSeconds: 10,
      websocketConnections: 5,
      monthlyQuota: 100_000,
    },
    institutional: {
      requestsPerSecond: 50,
      burstCapacity: 200,
      burstWindowSeconds: 10,
      websocketConnections: 25,
      monthlyQuota: 500_000,
    },
    enterprise: {
      requestsPerSecond: 200,
      burstCapacity: 1000,
      burstWindowSeconds: 10,
      websocketConnections: 100,
      monthlyQuota: 2_000_000,
    },
    strategic: {
      requestsPerSecond: 1000, // Effectively unlimited, custom negotiated
      burstCapacity: 5000,
      burstWindowSeconds: 10,
      websocketConnections: 500,
      monthlyQuota: -1, // Unlimited
    },
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    keyPrefix: 'ratelimit:',
  },
  headers: {
    enabled: true,
    includeRetryAfter: true,
  },
};

// =============================================================================
// TOKEN BUCKET IMPLEMENTATION
// =============================================================================

export class TokenBucket {
  private redis: Redis;
  private config: RateLimitConfig;

  constructor(redis: Redis, config: RateLimitConfig = DEFAULT_CONFIG) {
    this.redis = redis;
    this.config = config;
  }

  /**
   * Check and consume a token from the bucket
   * Uses Redis Lua script for atomic operation
   */
  async consume(clientId: string, tier: TierName, tokens: number = 1): Promise<RateLimitResult> {
    const limits = this.config.tiers[tier];
    const key = `${this.config.redis.keyPrefix}${clientId}`;
    const now = Date.now();

    // Lua script for atomic token bucket operation
    const luaScript = `
      local key = KEYS[1]
      local capacity = tonumber(ARGV[1])
      local refillRate = tonumber(ARGV[2])
      local requested = tonumber(ARGV[3])
      local now = tonumber(ARGV[4])
      local windowMs = tonumber(ARGV[5])

      -- Get current bucket state
      local bucket = redis.call('HMGET', key, 'tokens', 'lastRefill')
      local tokens = tonumber(bucket[1])
      local lastRefill = tonumber(bucket[2])

      -- Initialize if new bucket
      if tokens == nil then
        tokens = capacity
        lastRefill = now
      end

      -- Calculate tokens to add based on time elapsed
      local elapsed = now - lastRefill
      local tokensToAdd = (elapsed / 1000) * refillRate
      tokens = math.min(capacity, tokens + tokensToAdd)

      -- Check if request can be fulfilled
      local allowed = tokens >= requested
      local remaining = tokens
      local retryAfter = 0

      if allowed then
        tokens = tokens - requested
        remaining = tokens
      else
        -- Calculate retry time
        local tokensNeeded = requested - tokens
        retryAfter = math.ceil(tokensNeeded / refillRate)
      end

      -- Update bucket state
      redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', now)
      redis.call('PEXPIRE', key, windowMs)

      return {allowed and 1 or 0, remaining, retryAfter}
    `;

    const result = await this.redis.eval(
      luaScript,
      1,
      key,
      limits.burstCapacity,
      limits.requestsPerSecond,
      tokens,
      now,
      limits.burstWindowSeconds * 1000 * 2 // TTL for cleanup
    ) as [number, number, number];

    const [allowed, remaining, retryAfter] = result;
    const resetTime = Math.floor(now / 1000) + limits.burstWindowSeconds;

    return {
      allowed: allowed === 1,
      limit: limits.requestsPerSecond,
      remaining: Math.floor(remaining),
      resetTime,
      retryAfter: retryAfter > 0 ? retryAfter : undefined,
    };
  }

  /**
   * Get current bucket state without consuming tokens
   */
  async peek(clientId: string, tier: TierName): Promise<RateLimitResult> {
    const limits = this.config.tiers[tier];
    const key = `${this.config.redis.keyPrefix}${clientId}`;

    const bucket = await this.redis.hmget(key, 'tokens', 'lastRefill');
    const tokens = parseFloat(bucket[0] || String(limits.burstCapacity));
    const resetTime = Math.floor(Date.now() / 1000) + limits.burstWindowSeconds;

    return {
      allowed: tokens >= 1,
      limit: limits.requestsPerSecond,
      remaining: Math.floor(tokens),
      resetTime,
    };
  }

  /**
   * Reset rate limit for a client (admin use)
   */
  async reset(clientId: string): Promise<void> {
    const key = `${this.config.redis.keyPrefix}${clientId}`;
    await this.redis.del(key);
  }
}

// =============================================================================
// MONTHLY QUOTA TRACKING
// =============================================================================

export class QuotaTracker {
  private redis: Redis;
  private keyPrefix: string;

  constructor(redis: Redis, keyPrefix: string = 'quota:') {
    this.redis = redis;
    this.keyPrefix = keyPrefix;
  }

  /**
   * Increment and check monthly quota
   */
  async checkAndIncrement(
    clientId: string,
    _tier: TierName,
    limits: TierLimits
  ): Promise<{ allowed: boolean; used: number; limit: number }> {
    // Unlimited quota for strategic tier
    if (limits.monthlyQuota === -1) {
      return { allowed: true, used: 0, limit: -1 };
    }

    const key = this.getMonthlyKey(clientId);
    const used = await this.redis.incr(key);

    // Set expiry on first request of the month
    if (used === 1) {
      const endOfMonth = this.getEndOfMonthTimestamp();
      await this.redis.expireat(key, endOfMonth);
    }

    return {
      allowed: used <= limits.monthlyQuota,
      used,
      limit: limits.monthlyQuota,
    };
  }

  /**
   * Get current usage without incrementing
   */
  async getUsage(clientId: string): Promise<number> {
    const key = this.getMonthlyKey(clientId);
    const used = await this.redis.get(key);
    return parseInt(used || '0');
  }

  private getMonthlyKey(clientId: string): string {
    const date = new Date();
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    return `${this.keyPrefix}${clientId}:${monthKey}`;
  }

  private getEndOfMonthTimestamp(): number {
    const date = new Date();
    return Math.floor(
      new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime() / 1000
    );
  }
}

// =============================================================================
// EXPRESS MIDDLEWARE
// =============================================================================

export interface RateLimitMiddlewareOptions {
  redis: Redis;
  config?: RateLimitConfig;
  getClientContext: (req: Request) => Promise<ClientContext> | ClientContext;
  onRateLimited?: (req: Request, result: RateLimitResult) => void;
  skip?: (req: Request) => boolean;
}

/**
 * Creates Express middleware for rate limiting
 */
export function createRateLimitMiddleware(options: RateLimitMiddlewareOptions) {
  const config = options.config || DEFAULT_CONFIG;
  const tokenBucket = new TokenBucket(options.redis, config);
  const quotaTracker = new QuotaTracker(options.redis);

  return async function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    // Skip if configured
    if (options.skip?.(req)) {
      return next();
    }

    try {
      // Get client context (clientId and tier from auth)
      const context = await options.getClientContext(req);
      const tierLimits = config.tiers[context.tier];

      // Check rate limit
      const rateLimitResult = await tokenBucket.consume(
        context.clientId,
        context.tier
      );

      // Check monthly quota
      const quotaResult = await quotaTracker.checkAndIncrement(
        context.clientId,
        context.tier,
        tierLimits
      );

      // Set rate limit headers
      if (config.headers.enabled) {
        res.set({
          'X-RateLimit-Limit': String(tierLimits.requestsPerSecond),
          'X-RateLimit-Remaining': String(rateLimitResult.remaining),
          'X-RateLimit-Reset': String(rateLimitResult.resetTime),
          'X-RateLimit-Policy': `${tierLimits.requestsPerSecond};w=${tierLimits.burstWindowSeconds}`,
          'X-Quota-Limit': String(tierLimits.monthlyQuota),
          'X-Quota-Used': String(quotaResult.used),
        });
      }

      // Check if rate limited
      if (!rateLimitResult.allowed) {
        options.onRateLimited?.(req, rateLimitResult);

        if (config.headers.includeRetryAfter && rateLimitResult.retryAfter) {
          res.set('Retry-After', String(rateLimitResult.retryAfter));
        }

        res.status(429).json({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Rate limit exceeded. Please slow down your request rate.',
            details: {
              limit: tierLimits.requestsPerSecond,
              remaining: 0,
              resetTime: rateLimitResult.resetTime,
              retryAfter: rateLimitResult.retryAfter,
            },
          },
          documentation: `${appConfig.documentation.baseUrl}${appConfig.documentation.rateLimitsPath}`,
        });
        return;
      }

      // Check if quota exceeded
      if (!quotaResult.allowed) {
        res.status(429).json({
          error: {
            code: 'MONTHLY_QUOTA_EXCEEDED',
            message: 'Monthly API quota exceeded. Please upgrade your plan or wait until next month.',
            details: {
              used: quotaResult.used,
              limit: quotaResult.limit,
              resetsAt: new Date(
                new Date().getFullYear(),
                new Date().getMonth() + 1,
                1
              ).toISOString(),
            },
          },
          documentation: `${appConfig.documentation.baseUrl}${appConfig.documentation.quotasPath}`,
          upgrade: 'https://sentiment-api.io/pricing',
        });
        return;
      }

      // Attach context to request for downstream use
      (req as any).rateLimitContext = {
        clientId: context.clientId,
        tier: context.tier,
        remaining: rateLimitResult.remaining,
        quotaUsed: quotaResult.used,
      };

      next();
    } catch (error) {
      // Log error but don't block request on rate limiter failure
      console.error('Rate limiter error:', error);

      // Fail open with warning header
      res.set('X-RateLimit-Status', 'degraded');
      next();
    }
  };
}

// =============================================================================
// WEBSOCKET CONNECTION LIMITER
// =============================================================================

export class WebSocketConnectionLimiter {
  private redis: Redis;
  private keyPrefix: string;

  constructor(redis: Redis, keyPrefix: string = 'wsconn:') {
    this.redis = redis;
    this.keyPrefix = keyPrefix;
  }

  /**
   * Register a new WebSocket connection
   * Returns false if limit exceeded
   */
  async registerConnection(
    clientId: string,
    connectionId: string,
    _tier: TierName,
    limits: TierLimits
  ): Promise<{ allowed: boolean; current: number; limit: number }> {
    const key = `${this.keyPrefix}${clientId}`;

    // Atomic check and add
    const luaScript = `
      local key = KEYS[1]
      local connectionId = ARGV[1]
      local limit = tonumber(ARGV[2])

      local current = redis.call('SCARD', key)

      if current >= limit then
        return {0, current, limit}
      end

      redis.call('SADD', key, connectionId)
      redis.call('EXPIRE', key, 86400)  -- 24h TTL for cleanup

      return {1, current + 1, limit}
    `;

    const result = await this.redis.eval(
      luaScript,
      1,
      key,
      connectionId,
      limits.websocketConnections
    ) as [number, number, number];

    const [allowed, current, limit] = result;

    return {
      allowed: allowed === 1,
      current,
      limit,
    };
  }

  /**
   * Unregister a WebSocket connection
   */
  async unregisterConnection(clientId: string, connectionId: string): Promise<void> {
    const key = `${this.keyPrefix}${clientId}`;
    await this.redis.srem(key, connectionId);
  }

  /**
   * Get current connection count
   */
  async getConnectionCount(clientId: string): Promise<number> {
    const key = `${this.keyPrefix}${clientId}`;
    return await this.redis.scard(key);
  }
}

// =============================================================================
// RATE LIMIT RESPONSE HELPERS
// =============================================================================

/**
 * Standard 429 response body structure
 */
export interface RateLimitErrorResponse {
  error: {
    code: 'RATE_LIMIT_EXCEEDED' | 'MONTHLY_QUOTA_EXCEEDED' | 'CONNECTION_LIMIT_EXCEEDED';
    message: string;
    details: {
      limit: number;
      remaining?: number;
      used?: number;
      resetTime?: number;
      retryAfter?: number;
      resetsAt?: string;
    };
  };
  documentation: string;
  upgrade?: string;
}

/**
 * Build standardized rate limit error response
 */
export function buildRateLimitResponse(
  code: RateLimitErrorResponse['error']['code'],
  details: RateLimitErrorResponse['error']['details']
): RateLimitErrorResponse {
  const messages: Record<RateLimitErrorResponse['error']['code'], string> = {
    RATE_LIMIT_EXCEEDED: 'Rate limit exceeded. Please slow down your request rate.',
    MONTHLY_QUOTA_EXCEEDED: 'Monthly API quota exceeded. Please upgrade your plan or wait until next month.',
    CONNECTION_LIMIT_EXCEEDED: 'WebSocket connection limit exceeded. Please close unused connections.',
  };

  return {
    error: {
      code,
      message: messages[code],
      details,
    },
    documentation: `${appConfig.documentation.baseUrl}${appConfig.documentation.rateLimitsPath}`,
    ...(code !== 'RATE_LIMIT_EXCEEDED' && { upgrade: 'https://sentiment-api.io/pricing' }),
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  createRateLimitMiddleware,
  TokenBucket,
  QuotaTracker,
  WebSocketConnectionLimiter,
  DEFAULT_CONFIG,
  buildRateLimitResponse,
};
