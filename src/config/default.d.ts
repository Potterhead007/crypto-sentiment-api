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
        nodes: Array<{
            host: string;
            port: number;
        }>;
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
        professional: TierLimits;
        institutional: TierLimits;
        enterprise: TierLimits;
        strategic: TierLimits;
    };
}
export interface TierLimits {
    requestsPerSecond: number;
    burstCapacity: number;
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
declare const config: Config;
export default config;
export declare function validateConfig(cfg: Config): void;
//# sourceMappingURL=default.d.ts.map