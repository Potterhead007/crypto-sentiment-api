/**
 * Default Configuration
 * Institutional-Grade Cryptocurrency Market Sentiment Analysis API
 */

import { URL } from 'url';

// =============================================================================
// ENVIRONMENT VARIABLE HELPERS
// =============================================================================

/**
 * Parses a boolean environment variable with robust handling.
 * Supports: "true", "1", "yes", "on" (case-insensitive)
 */
function parseBoolEnv(value: string | undefined, defaultValue: boolean = false): boolean {
  if (!value) return defaultValue;
  const normalized = value.trim().toLowerCase();
  return ['true', '1', 'yes', 'on'].includes(normalized);
}

/**
 * Parses DATABASE_URL (Railway format) into individual connection params.
 * Supports: postgresql://user:pass@host:port/database?sslmode=require
 */
function parseDatabaseUrl(databaseUrl: string | undefined): {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
} | null {
  if (!databaseUrl) return null;

  try {
    const url = new URL(databaseUrl);
    const sslMode = url.searchParams.get('sslmode');

    return {
      host: url.hostname,
      port: parseInt(url.port || '5432'),
      database: url.pathname.slice(1), // Remove leading '/'
      user: url.username,
      password: url.password,
      ssl: sslMode === 'require' || sslMode === 'verify-full' || sslMode === 'verify-ca',
    };
  } catch {
    console.error('Failed to parse DATABASE_URL');
    return null;
  }
}

/**
 * Parses REDIS_URL into individual connection params.
 * Supports: redis://[:password@]host:port
 */
function parseRedisUrl(redisUrl: string | undefined): {
  host: string;
  port: number;
  password?: string;
  tls: boolean;
} | null {
  if (!redisUrl) return null;

  try {
    const url = new URL(redisUrl);
    return {
      host: url.hostname,
      port: parseInt(url.port || '6379'),
      password: url.password || undefined,
      tls: url.protocol === 'rediss:',
    };
  } catch {
    console.error('Failed to parse REDIS_URL');
    return null;
  }
}

export interface Config {
  server: ServerConfig;
  redis: RedisConfig;
  kafka: KafkaConfig;
  database: DatabaseConfig;
  rateLimiting: RateLimitingConfig;
  websocket: WebSocketConfig;
  monitoring: MonitoringConfig;
  security: SecurityConfig;
  documentation: DocumentationConfig;
}

export interface ServerConfig {
  port: number;
  host: string;
  env: 'development' | 'staging' | 'production';
  region: string;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  tls: boolean;
  keyPrefix: string;
  cluster?: {
    nodes: Array<{ host: string; port: number }>;
  };
}

export interface KafkaConfig {
  brokers: string[];
  clientId: string;
  groupId: string;
  ssl: boolean;
  sasl?: {
    mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512';
    username: string;
    password: string;
  };
  topics: {
    rawSocial: string;
    rawNews: string;
    rawOnchain: string;
    sentimentComputed: string;
    alerts: string;
    auditLog: string;
  };
}

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  poolSize: number;
  idleTimeout: number;
}

export interface RateLimitingConfig {
  enabled: boolean;
  tiers: {
    anonymous: TierLimits;
    professional: TierLimits;
    institutional: TierLimits;
    enterprise: TierLimits;
    strategic: TierLimits;
  };
}

export interface TierLimits {
  requestsPerSecond: number;
  burstCapacity: number;
  burstWindowSeconds: number;
  websocketConnections: number;
  monthlyQuota: number;
}

export interface WebSocketConfig {
  path: string;
  maxConnections: number;
  heartbeatInterval: number;
  heartbeatTimeout: number;
  messageBufferDuration: number;
  maxBufferSize: number;
  sessionTTL: number;
  recoveryEndpoint: string;
  compression: boolean;
}

export interface DocumentationConfig {
  baseUrl: string;
  changelogPath: string;
  rateLimitsPath: string;
  quotasPath: string;
}

export interface MonitoringConfig {
  metricsEnabled: boolean;
  metricsPath: string;
  tracingEnabled: boolean;
  tracingSampleRate: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface SecurityConfig {
  jwtSecret: string;
  jwtExpiration: string;
  apiKeyHeader: string;
  corsOrigins: string[];
  rateLimitBypassKey?: string;
}

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

const config: Config = {
  server: {
    port: parseInt(process.env.PORT || '3000'),
    host: process.env.HOST || '0.0.0.0',
    env: (process.env.NODE_ENV as Config['server']['env']) || 'development',
    region: process.env.AWS_REGION || 'us-east-1',
  },

  redis: (() => {
    // Support Railway REDIS_URL or individual env vars
    const redisUrlConfig = parseRedisUrl(process.env.REDIS_URL);

    return {
      host: process.env.REDIS_HOST || redisUrlConfig?.host || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '') || redisUrlConfig?.port || 6379,
      password: process.env.REDIS_PASSWORD || redisUrlConfig?.password,
      tls: parseBoolEnv(process.env.REDIS_TLS) || redisUrlConfig?.tls || false,
      keyPrefix: 'sentiment:',
    };
  })(),

  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    clientId: 'sentiment-api',
    groupId: 'sentiment-api-group',
    ssl: process.env.KAFKA_SSL === 'true',
    sasl: process.env.KAFKA_SASL_USERNAME && process.env.KAFKA_SASL_PASSWORD ? {
      mechanism: (process.env.KAFKA_SASL_MECHANISM as 'plain' | 'scram-sha-256' | 'scram-sha-512') || 'scram-sha-512',
      username: process.env.KAFKA_SASL_USERNAME,
      password: process.env.KAFKA_SASL_PASSWORD,
    } : undefined,
    topics: {
      rawSocial: 'raw-social',
      rawNews: 'raw-news',
      rawOnchain: 'raw-onchain',
      sentimentComputed: 'sentiment-computed',
      alerts: 'alerts-triggered',
      auditLog: 'audit-log',
    },
  },

  database: (() => {
    // Support Railway DATABASE_URL or individual env vars
    const dbUrlConfig = parseDatabaseUrl(process.env.DATABASE_URL);

    // Determine SSL: explicit DB_SSL takes precedence, then DATABASE_URL, then production default
    const sslEnabled = parseBoolEnv(process.env.DB_SSL || process.env.DATABASE_SSL) ||
      dbUrlConfig?.ssl ||
      process.env.NODE_ENV === 'production';

    // Helper to get non-empty env var (treats empty strings as undefined)
    const getEnv = (key: string): string | undefined => {
      const value = process.env[key];
      return value && value.trim() !== '' ? value : undefined;
    };

    return {
      host: getEnv('DB_HOST') || dbUrlConfig?.host || 'localhost',
      port: parseInt(getEnv('DB_PORT') || '') || dbUrlConfig?.port || 5432,
      database: getEnv('DB_NAME') || dbUrlConfig?.database || 'sentiment',
      user: getEnv('DB_USER') || dbUrlConfig?.user || 'sentiment',
      password: getEnv('DB_PASSWORD') || dbUrlConfig?.password || '',
      ssl: sslEnabled,
      poolSize: parseInt(process.env.DB_POOL_SIZE || '20'),
      idleTimeout: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
    };
  })(),

  rateLimiting: {
    enabled: true,
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
        requestsPerSecond: 1000,
        burstCapacity: 5000,
        burstWindowSeconds: 10,
        websocketConnections: 500,
        monthlyQuota: -1, // Unlimited
      },
    },
  },

  websocket: {
    path: '/v1/stream',
    maxConnections: 10000,
    heartbeatInterval: 30000,
    heartbeatTimeout: 10000,
    messageBufferDuration: 300000, // 5 minutes
    maxBufferSize: parseInt(process.env.WS_MAX_BUFFER_SIZE || '10000'),
    sessionTTL: parseInt(process.env.WS_SESSION_TTL || '3600'), // 1 hour
    recoveryEndpoint: '/v1/stream/replay',
    compression: true,
  },

  monitoring: {
    metricsEnabled: true,
    metricsPath: '/metrics',
    tracingEnabled: process.env.NODE_ENV === 'production',
    tracingSampleRate: 0.01,
    logLevel: (process.env.LOG_LEVEL as Config['monitoring']['logLevel']) || 'info',
  },

  security: {
    jwtSecret: process.env.JWT_SECRET || (() => {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('CRITICAL: JWT_SECRET environment variable must be set in production');
      }
      return 'dev-only-insecure-secret-do-not-use-in-production';
    })(),
    jwtExpiration: '24h',
    apiKeyHeader: 'X-API-Key',
    corsOrigins: (() => {
      const origins = process.env.CORS_ORIGINS;
      if (!origins && process.env.NODE_ENV === 'production') {
        throw new Error('CRITICAL: CORS_ORIGINS environment variable must be set in production');
      }
      return (origins || 'http://localhost:3000,http://localhost:3001').split(',');
    })(),
  },

  documentation: {
    baseUrl: process.env.DOCS_URL || 'https://docs.sentiment-api.io',
    changelogPath: '/changelog',
    rateLimitsPath: '/rate-limits',
    quotasPath: '/quotas',
  },
};

export default config;

// =============================================================================
// CONFIGURATION VALIDATION
// =============================================================================

export function validateConfig(cfg: Config): void {
  const errors: string[] = [];

  // Server validation
  if (cfg.server.port < 1 || cfg.server.port > 65535) {
    errors.push('Invalid server port');
  }

  // Check if running on Railway (has DATABASE_URL or RAILWAY_* env vars)
  const isRailway = !!(process.env.DATABASE_URL || process.env.RAILWAY_ENVIRONMENT);

  // Security validation in production
  if (cfg.server.env === 'production') {
    // JWT Secret validation - required in production
    if (!cfg.security.jwtSecret ||
      cfg.security.jwtSecret.includes('change-me') ||
      cfg.security.jwtSecret.includes('dev-only') ||
      cfg.security.jwtSecret.length < 32) {
      errors.push('CRITICAL: JWT_SECRET must be a secure value (min 32 chars) in production');
    }

    // Database validation - Railway provides DATABASE_URL which includes credentials
    if (!isRailway) {
      if (!cfg.database.password) {
        errors.push('Database password must be set in production');
      }
      if (!cfg.database.ssl) {
        errors.push('Database SSL must be enabled in production');
      }
    } else {
      // Railway: just verify we have a database connection configured
      if (!process.env.DATABASE_URL && !cfg.database.host) {
        errors.push('DATABASE_URL or DB_HOST must be set');
      }
      console.log('[Config] Railway environment detected - using DATABASE_URL for credentials');
    }

    // CORS validation - warn but don't block for Railway auto-domains
    if (cfg.security.corsOrigins.includes('*')) {
      if (isRailway) {
        console.warn('WARNING: CORS_ORIGINS is wildcard (*). Set to your Railway domain for better security.');
      } else {
        errors.push('CRITICAL: CORS_ORIGINS cannot be wildcard (*) in production. Specify allowed domains.');
      }
    }

    // Redis validation (warnings only - Railway managed Redis handles security)
    if (!cfg.redis.password && !process.env.REDIS_URL) {
      console.warn('WARNING: Redis password not set. Acceptable if using Railway managed Redis.');
    }

    // Kafka validation (warnings only - Kafka is optional)
    if (cfg.kafka.brokers[0] !== 'disabled' && cfg.kafka.brokers[0] !== 'localhost:9092') {
      if (cfg.kafka.ssl && !cfg.kafka.sasl) {
        console.warn('WARNING: Kafka SASL authentication not configured when SSL is enabled');
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}
