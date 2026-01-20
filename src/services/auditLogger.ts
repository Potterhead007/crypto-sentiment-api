/**
 * Comprehensive Audit Logging System
 * Institutional-Grade Cryptocurrency Market Sentiment Analysis API
 *
 * Provides:
 * - Complete audit trail for all API operations
 * - SOC 2 Type II compliant logging
 * - MiFID II recordkeeping compliance (7-year retention)
 * - Tamper-evident log storage
 * - Real-time streaming to SIEM systems
 */

import { Request, Response, NextFunction } from 'express';
import { EventEmitter } from 'events';
import crypto from 'crypto';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

export type AuditEventCategory =
  | 'authentication'
  | 'authorization'
  | 'api_access'
  | 'data_export'
  | 'configuration'
  | 'administrative'
  | 'security'
  | 'billing'
  | 'system';

export type AuditEventSeverity = 'info' | 'warning' | 'error' | 'critical';

export type AuditEventOutcome = 'success' | 'failure' | 'unknown';

export interface AuditEvent {
  /** Unique event identifier */
  eventId: string;
  /** Event timestamp (ISO 8601) */
  timestamp: string;
  /** Event category */
  category: AuditEventCategory;
  /** Specific event type within category */
  eventType: string;
  /** Event severity */
  severity: AuditEventSeverity;
  /** Event outcome */
  outcome: AuditEventOutcome;
  /** Actor information */
  actor: AuditActor;
  /** Target resource */
  target: AuditTarget;
  /** Request context */
  request: AuditRequest;
  /** Response context */
  response: AuditResponse;
  /** Additional event-specific data */
  metadata: Record<string, any>;
  /** Hash of previous event for chain integrity */
  previousEventHash?: string;
  /** Hash of this event */
  eventHash: string;
}

export interface AuditActor {
  /** Actor type: user, service, system */
  type: 'user' | 'service' | 'system';
  /** Actor identifier (user ID, service name) */
  id: string;
  /** Client ID for API access */
  clientId?: string;
  /** Organization/tenant ID */
  organizationId?: string;
  /** Actor's tier/role */
  tier?: string;
  /** Session ID if applicable */
  sessionId?: string;
  /** IP address */
  ipAddress: string;
  /** User agent */
  userAgent?: string;
  /** Geographic location (if available) */
  geoLocation?: {
    country?: string;
    region?: string;
    city?: string;
  };
}

export interface AuditTarget {
  /** Target resource type */
  type: string;
  /** Target resource identifier */
  id?: string;
  /** Target resource name */
  name?: string;
  /** Additional target attributes */
  attributes?: Record<string, any>;
}

export interface AuditRequest {
  /** Request ID */
  requestId: string;
  /** HTTP method */
  method: string;
  /** Request path */
  path: string;
  /** Query parameters (sanitized) */
  queryParams?: Record<string, string>;
  /** Request headers (sanitized) */
  headers?: Record<string, string>;
  /** Request body hash (not the actual body for privacy) */
  bodyHash?: string;
  /** Request body size in bytes */
  bodySize?: number;
}

export interface AuditResponse {
  /** HTTP status code */
  statusCode: number;
  /** Response time in milliseconds */
  latencyMs: number;
  /** Response body size in bytes */
  bodySize?: number;
  /** Error code if applicable */
  errorCode?: string;
  /** Error message if applicable */
  errorMessage?: string;
}

export interface AuditLoggerConfig {
  /** Application name */
  appName: string;
  /** Environment */
  environment: string;
  /** Region */
  region: string;
  /** Whether to enable chain integrity */
  enableChainIntegrity: boolean;
  /** Fields to redact from logs */
  redactFields: string[];
  /** Fields to hash instead of log */
  hashFields: string[];
  /** Async transport for log shipping */
  transports: AuditTransport[];
  /** Retention period in days */
  retentionDays: number;
  /** Sampling rate for high-volume events (0-1) */
  samplingRate?: number;
  /** Events to always log regardless of sampling */
  alwaysLogEvents: string[];
}

export interface AuditTransport {
  name: string;
  send(event: AuditEvent): Promise<void>;
}

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

export const DEFAULT_AUDIT_CONFIG: AuditLoggerConfig = {
  appName: 'crypto-sentiment-api',
  environment: process.env.NODE_ENV || 'development',
  region: process.env.AWS_REGION || 'us-east-1',
  enableChainIntegrity: true,
  redactFields: [
    'password',
    'secret',
    'token',
    'apiKey',
    'api_key',
    'authorization',
    'cookie',
    'creditCard',
    'ssn',
  ],
  hashFields: [
    'email',
    'phone',
    'address',
  ],
  transports: [],
  retentionDays: 2555, // 7 years for MiFID II compliance
  samplingRate: 1.0, // Log everything by default
  alwaysLogEvents: [
    'authentication.login',
    'authentication.logout',
    'authentication.failed',
    'authorization.denied',
    'security.alert',
    'data_export.bulk',
    'configuration.changed',
    'administrative.user_created',
    'administrative.user_deleted',
    'administrative.permissions_changed',
  ],
};

// =============================================================================
// AUDIT LOGGER IMPLEMENTATION
// =============================================================================

export class AuditLogger extends EventEmitter {
  private config: AuditLoggerConfig;
  private lastEventHash: string | null = null;
  private eventCounter: number = 0;
  private buffer: AuditEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<AuditLoggerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_AUDIT_CONFIG, ...config };

    // Start periodic flush
    this.startPeriodicFlush();
  }

  // ---------------------------------------------------------------------------
  // CORE LOGGING METHODS
  // ---------------------------------------------------------------------------

  /**
   * Log an audit event
   */
  async log(event: Partial<AuditEvent>): Promise<AuditEvent> {
    // Check sampling
    if (!this.shouldLog(event.eventType || '')) {
      return event as AuditEvent;
    }

    // Build complete event
    const completeEvent = this.buildEvent(event);

    // Add to buffer
    this.buffer.push(completeEvent);

    // Emit for real-time processing
    this.emit('event', completeEvent);

    // Flush if buffer is large
    if (this.buffer.length >= 100) {
      await this.flush();
    }

    return completeEvent;
  }

  /**
   * Log authentication event
   */
  async logAuthentication(
    eventType: 'login' | 'logout' | 'failed' | 'token_refresh' | 'token_revoked',
    actor: Partial<AuditActor>,
    outcome: AuditEventOutcome,
    metadata: Record<string, any> = {}
  ): Promise<AuditEvent> {
    return this.log({
      category: 'authentication',
      eventType: `authentication.${eventType}`,
      severity: outcome === 'failure' ? 'warning' : 'info',
      outcome,
      actor: actor as AuditActor,
      target: { type: 'authentication_system' },
      metadata,
    });
  }

  /**
   * Log authorization event
   */
  async logAuthorization(
    eventType: 'granted' | 'denied' | 'elevated',
    actor: Partial<AuditActor>,
    target: AuditTarget,
    outcome: AuditEventOutcome,
    metadata: Record<string, any> = {}
  ): Promise<AuditEvent> {
    return this.log({
      category: 'authorization',
      eventType: `authorization.${eventType}`,
      severity: eventType === 'denied' ? 'warning' : 'info',
      outcome,
      actor: actor as AuditActor,
      target,
      metadata,
    });
  }

  /**
   * Log API access event
   */
  async logApiAccess(
    request: AuditRequest,
    response: AuditResponse,
    actor: Partial<AuditActor>,
    metadata: Record<string, any> = {}
  ): Promise<AuditEvent> {
    const outcome: AuditEventOutcome = response.statusCode < 400 ? 'success' : 'failure';

    return this.log({
      category: 'api_access',
      eventType: `api.${request.method.toLowerCase()}.${this.pathToEventType(request.path)}`,
      severity: response.statusCode >= 500 ? 'error' : 'info',
      outcome,
      actor: actor as AuditActor,
      target: {
        type: 'api_endpoint',
        id: request.path,
        name: `${request.method} ${request.path}`,
      },
      request,
      response,
      metadata,
    });
  }

  /**
   * Log data export event
   */
  async logDataExport(
    exportType: 'bulk' | 'historical' | 'report',
    actor: Partial<AuditActor>,
    dataDescription: string,
    recordCount: number,
    metadata: Record<string, any> = {}
  ): Promise<AuditEvent> {
    return this.log({
      category: 'data_export',
      eventType: `data_export.${exportType}`,
      severity: 'info',
      outcome: 'success',
      actor: actor as AuditActor,
      target: {
        type: 'data',
        name: dataDescription,
        attributes: { recordCount },
      },
      metadata: {
        ...metadata,
        recordCount,
        dataDescription,
      },
    });
  }

  /**
   * Log configuration change event
   */
  async logConfigurationChange(
    actor: Partial<AuditActor>,
    configType: string,
    previousValue: any,
    newValue: any,
    metadata: Record<string, any> = {}
  ): Promise<AuditEvent> {
    return this.log({
      category: 'configuration',
      eventType: `configuration.${configType}_changed`,
      severity: 'warning',
      outcome: 'success',
      actor: actor as AuditActor,
      target: {
        type: 'configuration',
        id: configType,
        attributes: {
          previousValue: this.redactSensitive(previousValue),
          newValue: this.redactSensitive(newValue),
        },
      },
      metadata,
    });
  }

  /**
   * Log security event
   */
  async logSecurityEvent(
    eventType: string,
    severity: AuditEventSeverity,
    actor: Partial<AuditActor>,
    description: string,
    metadata: Record<string, any> = {}
  ): Promise<AuditEvent> {
    return this.log({
      category: 'security',
      eventType: `security.${eventType}`,
      severity,
      outcome: 'unknown',
      actor: actor as AuditActor,
      target: {
        type: 'security_system',
        name: description,
      },
      metadata: {
        ...metadata,
        description,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // EVENT BUILDING
  // ---------------------------------------------------------------------------

  private buildEvent(partial: Partial<AuditEvent>): AuditEvent {
    const eventId = this.generateEventId();
    const timestamp = new Date().toISOString();

    const event: AuditEvent = {
      eventId,
      timestamp,
      category: partial.category || 'system',
      eventType: partial.eventType || 'unknown',
      severity: partial.severity || 'info',
      outcome: partial.outcome || 'unknown',
      actor: this.sanitizeActor(partial.actor || { type: 'system', id: 'system', ipAddress: '0.0.0.0' }),
      target: partial.target || { type: 'unknown' },
      request: partial.request || {
        requestId: eventId,
        method: 'INTERNAL',
        path: '/',
      },
      response: partial.response || {
        statusCode: 0,
        latencyMs: 0,
      },
      metadata: this.sanitizeMetadata(partial.metadata || {}),
      eventHash: '', // Will be calculated
    };

    // Add chain integrity
    if (this.config.enableChainIntegrity && this.lastEventHash) {
      event.previousEventHash = this.lastEventHash;
    }

    // Calculate event hash
    event.eventHash = this.calculateEventHash(event);
    this.lastEventHash = event.eventHash;

    return event;
  }

  private generateEventId(): string {
    this.eventCounter++;
    const timestamp = Date.now().toString(36);
    const counter = this.eventCounter.toString(36).padStart(4, '0');
    const random = crypto.randomBytes(4).toString('hex');
    return `evt_${timestamp}_${counter}_${random}`;
  }

  private calculateEventHash(event: AuditEvent): string {
    const hashInput = JSON.stringify({
      eventId: event.eventId,
      timestamp: event.timestamp,
      category: event.category,
      eventType: event.eventType,
      actor: event.actor.id,
      target: event.target.id,
      outcome: event.outcome,
      previousEventHash: event.previousEventHash,
    });

    return crypto.createHash('sha256').update(hashInput).digest('hex');
  }

  // ---------------------------------------------------------------------------
  // SANITIZATION
  // ---------------------------------------------------------------------------

  private sanitizeActor(actor: AuditActor): AuditActor {
    return {
      ...actor,
      // Hash sensitive fields
      ipAddress: this.config.hashFields.includes('ipAddress')
        ? this.hashValue(actor.ipAddress)
        : actor.ipAddress,
    };
  }

  private sanitizeMetadata(metadata: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(metadata)) {
      const lowercaseKey = key.toLowerCase();

      if (this.config.redactFields.some(f => lowercaseKey.includes(f.toLowerCase()))) {
        sanitized[key] = '[REDACTED]';
      } else if (this.config.hashFields.some(f => lowercaseKey.includes(f.toLowerCase()))) {
        sanitized[key] = this.hashValue(String(value));
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.redactSensitive(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  private redactSensitive(obj: any): any {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.redactSensitive(item));
    }

    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowercaseKey = key.toLowerCase();

      if (this.config.redactFields.some(f => lowercaseKey.includes(f.toLowerCase()))) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.redactSensitive(value);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  private hashValue(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex').substring(0, 16);
  }

  // ---------------------------------------------------------------------------
  // UTILITIES
  // ---------------------------------------------------------------------------

  private shouldLog(eventType: string): boolean {
    // Always log critical events
    if (this.config.alwaysLogEvents.includes(eventType)) {
      return true;
    }

    // Apply sampling
    if (this.config.samplingRate && this.config.samplingRate < 1.0) {
      return Math.random() < this.config.samplingRate;
    }

    return true;
  }

  private pathToEventType(path: string): string {
    return path
      .replace(/^\//, '')
      .replace(/\//g, '.')
      .replace(/[^a-zA-Z0-9.]/g, '_')
      .toLowerCase();
  }

  // ---------------------------------------------------------------------------
  // TRANSPORT & FLUSH
  // ---------------------------------------------------------------------------

  private startPeriodicFlush(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch(err => {
        console.error('Audit log flush error:', err);
      });
    }, 5000); // Flush every 5 seconds
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    const events = [...this.buffer];
    this.buffer = [];

    // Send to all transports
    await Promise.all(
      this.config.transports.map(async transport => {
        for (const event of events) {
          try {
            await transport.send(event);
          } catch (error) {
            console.error(`Audit transport ${transport.name} error:`, error);
            this.emit('transport_error', { transport: transport.name, error, event });
          }
        }
      })
    );
  }

  /**
   * Shutdown the logger gracefully
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    await this.flush();
  }
}

// =============================================================================
// EXPRESS MIDDLEWARE
// =============================================================================

export interface AuditMiddlewareOptions {
  logger: AuditLogger;
  getActor: (req: Request) => Partial<AuditActor>;
  excludePaths?: string[];
  includeRequestBody?: boolean;
  includeResponseBody?: boolean;
}

/**
 * Express middleware for automatic API access logging
 */
export function createAuditMiddleware(options: AuditMiddlewareOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Skip excluded paths
    if (options.excludePaths?.some(p => req.path.startsWith(p))) {
      return next();
    }

    const startTime = Date.now();
    const requestId = (req as any).id || crypto.randomBytes(8).toString('hex');

    // Capture response
    const originalJson = res.json.bind(res);
    let responseBody: any;

    res.json = function(body: any) {
      responseBody = body;
      return originalJson(body);
    };

    // Log after response
    res.on('finish', async () => {
      const latencyMs = Date.now() - startTime;

      const auditRequest: AuditRequest = {
        requestId,
        method: req.method,
        path: req.path,
        queryParams: req.query as Record<string, string>,
        headers: options.includeRequestBody ? sanitizeHeaders(req.headers) : undefined,
        bodyHash: req.body ? crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex') : undefined,
        bodySize: req.body ? JSON.stringify(req.body).length : 0,
      };

      const auditResponse: AuditResponse = {
        statusCode: res.statusCode,
        latencyMs,
        bodySize: responseBody ? JSON.stringify(responseBody).length : 0,
        errorCode: responseBody?.error?.code,
        errorMessage: responseBody?.error?.message,
      };

      const actor = options.getActor(req);

      await options.logger.logApiAccess(auditRequest, auditResponse, actor, {
        userAgent: req.headers['user-agent'],
        referer: req.headers['referer'],
      });
    });

    next();
  };

  function sanitizeHeaders(headers: any): Record<string, string> {
    const sanitized: Record<string, string> = {};
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key'];

    for (const [key, value] of Object.entries(headers)) {
      if (sensitiveHeaders.includes(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = String(value);
      }
    }

    return sanitized;
  }
}

// =============================================================================
// TRANSPORTS
// =============================================================================

/**
 * Console transport for development
 */
export class ConsoleAuditTransport implements AuditTransport {
  name = 'console';

  async send(event: AuditEvent): Promise<void> {
    const logLine = JSON.stringify({
      timestamp: event.timestamp,
      eventType: event.eventType,
      severity: event.severity,
      outcome: event.outcome,
      actor: event.actor.id,
      target: event.target.type,
      latencyMs: event.response.latencyMs,
    });

    if (event.severity === 'error' || event.severity === 'critical') {
      console.error(`[AUDIT] ${logLine}`);
    } else if (event.severity === 'warning') {
      console.warn(`[AUDIT] ${logLine}`);
    } else {
      console.log(`[AUDIT] ${logLine}`);
    }
  }
}

/**
 * File transport for persistent logging
 */
export class FileAuditTransport implements AuditTransport {
  name = 'file';
  private fs = require('fs');
  private path: string;

  constructor(logPath: string) {
    this.path = logPath;
  }

  async send(event: AuditEvent): Promise<void> {
    const logLine = JSON.stringify(event) + '\n';
    await this.fs.promises.appendFile(this.path, logLine);
  }
}

/**
 * HTTP transport for SIEM integration
 */
export class HttpAuditTransport implements AuditTransport {
  name: string;
  private endpoint: string;
  private headers: Record<string, string>;
  private batchSize: number;
  private batch: AuditEvent[] = [];

  constructor(
    name: string,
    endpoint: string,
    headers: Record<string, string> = {},
    batchSize: number = 100
  ) {
    this.name = name;
    this.endpoint = endpoint;
    this.headers = headers;
    this.batchSize = batchSize;
  }

  async send(event: AuditEvent): Promise<void> {
    this.batch.push(event);

    if (this.batch.length >= this.batchSize) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.batch.length === 0) return;

    const events = [...this.batch];
    this.batch = [];

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify({ events }),
    });

    if (!response.ok) {
      throw new Error(`HTTP transport error: ${response.status}`);
    }
  }
}

// =============================================================================
// QUERY INTERFACE
// =============================================================================

export interface AuditQuery {
  startTime?: Date;
  endTime?: Date;
  category?: AuditEventCategory;
  eventType?: string;
  actorId?: string;
  clientId?: string;
  organizationId?: string;
  outcome?: AuditEventOutcome;
  severity?: AuditEventSeverity;
  limit?: number;
  offset?: number;
}

export interface AuditQueryResult {
  events: AuditEvent[];
  total: number;
  hasMore: boolean;
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  AuditLogger,
  createAuditMiddleware,
  ConsoleAuditTransport,
  FileAuditTransport,
  HttpAuditTransport,
  DEFAULT_AUDIT_CONFIG,
};
