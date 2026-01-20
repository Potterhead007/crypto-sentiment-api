/**
 * Configuration Tests
 * Tests for configuration validation
 */

import { Config, validateConfig } from '../../src/config/default';

describe('Configuration', () => {
  const createValidConfig = (overrides: Partial<Config> = {}): Config => ({
    server: {
      port: 3000,
      host: '0.0.0.0',
      env: 'development',
      region: 'us-east-1',
      ...overrides.server,
    },
    redis: {
      host: 'localhost',
      port: 6379,
      password: 'test-password',
      tls: false,
      keyPrefix: 'sentiment:',
      ...overrides.redis,
    },
    kafka: {
      brokers: ['localhost:9092'],
      clientId: 'sentiment-api',
      groupId: 'sentiment-api-group',
      ssl: false,
      topics: {
        rawSocial: 'raw-social',
        rawNews: 'raw-news',
        rawOnchain: 'raw-onchain',
        sentimentComputed: 'sentiment-computed',
        alerts: 'alerts-triggered',
        auditLog: 'audit-log',
      },
      ...overrides.kafka,
    },
    database: {
      host: 'localhost',
      port: 5432,
      database: 'sentiment',
      user: 'sentiment',
      password: 'test-password',
      ssl: false,
      poolSize: 20,
      idleTimeout: 30000,
      ...overrides.database,
    },
    rateLimiting: {
      enabled: true,
      tiers: {
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
          monthlyQuota: -1,
        },
      },
      ...overrides.rateLimiting,
    },
    websocket: {
      path: '/v1/stream',
      maxConnections: 10000,
      heartbeatInterval: 30000,
      heartbeatTimeout: 10000,
      messageBufferDuration: 300000,
      compression: true,
      ...overrides.websocket,
    },
    monitoring: {
      metricsEnabled: true,
      metricsPath: '/metrics',
      tracingEnabled: false,
      tracingSampleRate: 0.01,
      logLevel: 'info',
      ...overrides.monitoring,
    },
    security: {
      jwtSecret: 'test-jwt-secret-minimum-32-characters-long',
      jwtExpiration: '24h',
      apiKeyHeader: 'X-API-Key',
      corsOrigins: ['http://localhost:3000'],
      ...overrides.security,
    },
  });

  describe('Development Environment', () => {
    it('should accept valid development config', () => {
      const config = createValidConfig();
      expect(() => validateConfig(config)).not.toThrow();
    });

    it('should accept config without SSL in development', () => {
      const config = createValidConfig({
        database: { ...createValidConfig().database, ssl: false },
        redis: { ...createValidConfig().redis, tls: false },
      });
      expect(() => validateConfig(config)).not.toThrow();
    });

    it('should accept config without passwords in development', () => {
      const config = createValidConfig({
        redis: { ...createValidConfig().redis, password: undefined },
      });
      expect(() => validateConfig(config)).not.toThrow();
    });
  });

  describe('Production Environment', () => {
    const createProductionConfig = (overrides: Partial<Config> = {}): Config => ({
      ...createValidConfig(overrides),
      server: {
        ...createValidConfig().server,
        env: 'production',
        ...overrides.server,
      },
      database: {
        ...createValidConfig().database,
        ssl: true,
        password: 'secure-production-password',
        ...overrides.database,
      },
      redis: {
        ...createValidConfig().redis,
        password: 'secure-redis-password',
        tls: true,
        ...overrides.redis,
      },
      kafka: {
        ...createValidConfig().kafka,
        ssl: true,
        sasl: {
          mechanism: 'scram-sha-512',
          username: 'kafka-user',
          password: 'kafka-password',
        },
        ...overrides.kafka,
      },
      security: {
        ...createValidConfig().security,
        jwtSecret: 'production-secure-jwt-secret-at-least-32-chars',
        corsOrigins: ['https://api.example.com'],
        ...overrides.security,
      },
    });

    it('should accept valid production config', () => {
      const config = createProductionConfig();
      expect(() => validateConfig(config)).not.toThrow();
    });

    it('should reject production config with default JWT secret', () => {
      const config = createProductionConfig({
        security: {
          ...createProductionConfig().security,
          jwtSecret: 'change-me-in-production',
        },
      });
      expect(() => validateConfig(config)).toThrow(/JWT/i);
    });

    it('should reject production config with dev JWT secret', () => {
      const config = createProductionConfig({
        security: {
          ...createProductionConfig().security,
          jwtSecret: 'dev-only-insecure-secret',
        },
      });
      expect(() => validateConfig(config)).toThrow(/JWT/i);
    });

    it('should reject production config with short JWT secret', () => {
      const config = createProductionConfig({
        security: {
          ...createProductionConfig().security,
          jwtSecret: 'short',
        },
      });
      expect(() => validateConfig(config)).toThrow(/JWT/i);
    });

    it('should reject production config without database SSL', () => {
      const config = createProductionConfig({
        database: {
          ...createProductionConfig().database,
          ssl: false,
        },
      });
      expect(() => validateConfig(config)).toThrow(/SSL/i);
    });

    it('should reject production config without database password', () => {
      const config = createProductionConfig({
        database: {
          ...createProductionConfig().database,
          password: '',
        },
      });
      expect(() => validateConfig(config)).toThrow(/password/i);
    });

    it('should reject production config with wildcard CORS', () => {
      const config = createProductionConfig({
        security: {
          ...createProductionConfig().security,
          corsOrigins: ['*'],
        },
      });
      expect(() => validateConfig(config)).toThrow(/CORS/i);
    });

    it('should reject production config without Redis password', () => {
      const config = createProductionConfig({
        redis: {
          ...createProductionConfig().redis,
          password: undefined,
        },
      });
      expect(() => validateConfig(config)).toThrow(/Redis.*password/i);
    });

    it('should warn about production config without Kafka SASL when SSL enabled', () => {
      const config = createProductionConfig({
        kafka: {
          ...createProductionConfig().kafka,
          ssl: true,
          sasl: undefined,
        },
      });
      expect(() => validateConfig(config)).toThrow(/SASL/i);
    });
  });

  describe('Port Validation', () => {
    it('should accept valid ports', () => {
      for (const port of [1, 80, 443, 3000, 8080, 65535]) {
        const config = createValidConfig({
          server: { ...createValidConfig().server, port },
        });
        expect(() => validateConfig(config)).not.toThrow();
      }
    });

    it('should reject port 0', () => {
      const config = createValidConfig({
        server: { ...createValidConfig().server, port: 0 },
      });
      expect(() => validateConfig(config)).toThrow(/port/i);
    });

    it('should reject negative port', () => {
      const config = createValidConfig({
        server: { ...createValidConfig().server, port: -1 },
      });
      expect(() => validateConfig(config)).toThrow(/port/i);
    });

    it('should reject port > 65535', () => {
      const config = createValidConfig({
        server: { ...createValidConfig().server, port: 65536 },
      });
      expect(() => validateConfig(config)).toThrow(/port/i);
    });
  });

  describe('Rate Limiting Tiers', () => {
    it('should have progressive limits', () => {
      const config = createValidConfig();

      expect(config.rateLimiting.tiers.institutional.requestsPerSecond)
        .toBeGreaterThan(config.rateLimiting.tiers.professional.requestsPerSecond);

      expect(config.rateLimiting.tiers.enterprise.requestsPerSecond)
        .toBeGreaterThan(config.rateLimiting.tiers.institutional.requestsPerSecond);

      expect(config.rateLimiting.tiers.strategic.requestsPerSecond)
        .toBeGreaterThan(config.rateLimiting.tiers.enterprise.requestsPerSecond);
    });

    it('should have strategic tier with unlimited quota', () => {
      const config = createValidConfig();
      expect(config.rateLimiting.tiers.strategic.monthlyQuota).toBe(-1);
    });
  });
});
