"use strict";
/**
 * Default Configuration
 * Institutional-Grade Cryptocurrency Market Sentiment Analysis API
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateConfig = validateConfig;
// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================
const config = {
    server: {
        port: parseInt(process.env.PORT || '3000'),
        host: process.env.HOST || '0.0.0.0',
        env: process.env.NODE_ENV || 'development',
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
            professional: {
                requestsPerSecond: 10,
                burstCapacity: 50,
                websocketConnections: 5,
                monthlyQuota: 100_000,
            },
            institutional: {
                requestsPerSecond: 50,
                burstCapacity: 200,
                websocketConnections: 25,
                monthlyQuota: 500_000,
            },
            enterprise: {
                requestsPerSecond: 200,
                burstCapacity: 1000,
                websocketConnections: 100,
                monthlyQuota: 2_000_000,
            },
            strategic: {
                requestsPerSecond: 1000,
                burstCapacity: 5000,
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
        logLevel: process.env.LOG_LEVEL || 'info',
    },
    security: {
        jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
        jwtExpiration: '24h',
        apiKeyHeader: 'X-API-Key',
        corsOrigins: (process.env.CORS_ORIGINS || '*').split(','),
    },
};
exports.default = config;
// =============================================================================
// CONFIGURATION VALIDATION
// =============================================================================
function validateConfig(cfg) {
    const errors = [];
    // Server validation
    if (cfg.server.port < 1 || cfg.server.port > 65535) {
        errors.push('Invalid server port');
    }
    // Security validation in production
    if (cfg.server.env === 'production') {
        if (cfg.security.jwtSecret === 'change-me-in-production') {
            errors.push('JWT secret must be changed in production');
        }
        if (!cfg.database.ssl) {
            errors.push('Database SSL must be enabled in production');
        }
        if (cfg.security.corsOrigins.includes('*')) {
            errors.push('CORS origins should not be * in production');
        }
    }
    if (errors.length > 0) {
        throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
}
//# sourceMappingURL=default.js.map