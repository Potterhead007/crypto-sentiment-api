/**
 * Default Configuration
 * Institutional-Grade Cryptocurrency Market Sentiment Analysis API
 */

export interface Config {
  server: ServerConfig;
  redis: RedisConfig;
  kafka: KafkaConfig;
  database: DatabaseConfig;
  rateLimiting: RateLimitingConfig;
  websocket: WebSocketConfig;
  monitoring: MonitoringConfig;
  security: SecurityConfig;
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
  compression: boolean;
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

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    tls: process.env.REDIS_TLS === 'true',
    keyPrefix: 'sentiment:',
  },

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

  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'sentiment',
    user: process.env.DB_USER || 'sentiment',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true',
    poolSize: parseInt(process.env.DB_POOL_SIZE || '20'),
    idleTimeout: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
  },

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

  // Security validation in production
  if (cfg.server.env === 'production') {
    // JWT Secret validation
    if (!cfg.security.jwtSecret ||
        cfg.security.jwtSecret.includes('change-me') ||
        cfg.security.jwtSecret.includes('dev-only') ||
        cfg.security.jwtSecret.length < 32) {
      errors.push('CRITICAL: JWT secret must be a secure value (min 32 chars) in production');
    }

    // Database validation
    if (!cfg.database.ssl) {
      errors.push('Database SSL must be enabled in production');
    }
    if (!cfg.database.password) {
      errors.push('Database password must be set in production');
    }

    // CORS validation
    if (cfg.security.corsOrigins.includes('*')) {
      errors.push('CORS origins cannot be * in production');
    }

    // Redis validation
    if (!cfg.redis.password) {
      errors.push('CRITICAL: Redis password must be set in production (REDIS_PASSWORD)');
    }
    if (!cfg.redis.tls) {
      errors.push('CRITICAL: Redis TLS must be enabled in production (REDIS_TLS=true)');
    }

    // Kafka validation
    if (cfg.kafka.ssl && !cfg.kafka.sasl) {
      errors.push('CRITICAL: Kafka SASL authentication must be configured when SSL is enabled in production');
    }
    if (!cfg.kafka.ssl) {
      errors.push('WARNING: Kafka SSL should be enabled in production (KAFKA_SSL=true)');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}
