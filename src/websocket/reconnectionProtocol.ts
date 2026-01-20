/**
 * WebSocket Reconnection Protocol
 * Institutional-Grade Cryptocurrency Market Sentiment Analysis API
 *
 * Implements reliable WebSocket connections with:
 * - Automatic reconnection with exponential backoff
 * - Message recovery for missed data during disconnections
 * - Heartbeat monitoring
 * - Session resumption
 * - At-least-once delivery guarantees
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import Redis from 'ioredis';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

export interface ReconnectionConfig {
  /** Initial delay before first reconnection attempt (ms) */
  initialDelayMs: number;
  /** Maximum delay between reconnection attempts (ms) */
  maxDelayMs: number;
  /** Multiplier for exponential backoff */
  backoffMultiplier: number;
  /** Maximum number of reconnection attempts (0 = unlimited) */
  maxAttempts: number;
  /** Jitter factor (0-1) to randomize delays */
  jitterFactor: number;
}

export interface HeartbeatConfig {
  /** Interval between heartbeat pings (ms) */
  intervalMs: number;
  /** Timeout to wait for pong response (ms) */
  timeoutMs: number;
  /** Number of missed heartbeats before disconnect */
  missedThreshold: number;
}

export interface MessageRecoveryConfig {
  /** Duration to buffer messages for recovery (ms) */
  bufferDurationMs: number;
  /** Maximum messages to buffer per client */
  maxBufferSize: number;
  /** Recovery endpoint URL */
  recoveryEndpoint: string;
}

export interface WebSocketClientConfig {
  url: string;
  clientId: string;
  apiKey: string;
  reconnection: ReconnectionConfig;
  heartbeat: HeartbeatConfig;
  recovery: MessageRecoveryConfig;
  protocols?: string[];
}

export interface SessionState {
  sessionId: string;
  lastSequenceNumber: number;
  subscriptions: string[];
  connectedAt: Date;
  lastMessageAt: Date;
}

export interface RecoveryRequest {
  sessionId: string;
  fromSequence: number;
  toSequence?: number;
}

export interface RecoveryResponse {
  messages: BufferedMessage[];
  fromSequence: number;
  toSequence: number;
  complete: boolean;
  nextCursor?: string;
}

export interface BufferedMessage {
  sequenceNumber: number;
  timestamp: string;
  topic: string;
  payload: any;
}

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'recovering'
  | 'failed';

export interface ConnectionMetrics {
  totalConnections: number;
  totalReconnections: number;
  totalMessagesReceived: number;
  totalMessagesRecovered: number;
  lastConnectedAt?: Date;
  lastDisconnectedAt?: Date;
  currentSessionDuration?: number;
}

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

export const DEFAULT_RECONNECTION_CONFIG: ReconnectionConfig = {
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  maxAttempts: 0, // Unlimited
  jitterFactor: 0.3,
};

export const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  intervalMs: 30000,
  timeoutMs: 10000,
  missedThreshold: 3,
};

export const DEFAULT_RECOVERY_CONFIG: MessageRecoveryConfig = {
  bufferDurationMs: 300000, // 5 minutes
  maxBufferSize: 10000,
  recoveryEndpoint: '/v1/stream/replay',
};

// =============================================================================
// WEBSOCKET CLIENT WITH RECONNECTION
// =============================================================================

export class ResilientWebSocketClient extends EventEmitter {
  private config: WebSocketClientConfig;
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'disconnected';
  private session: SessionState | null = null;
  private reconnectAttempts: number = 0;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
  private missedHeartbeats: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private metrics: ConnectionMetrics;

  constructor(config: WebSocketClientConfig) {
    super();
    this.config = {
      ...config,
      reconnection: { ...DEFAULT_RECONNECTION_CONFIG, ...config.reconnection },
      heartbeat: { ...DEFAULT_HEARTBEAT_CONFIG, ...config.heartbeat },
      recovery: { ...DEFAULT_RECOVERY_CONFIG, ...config.recovery },
    };
    this.metrics = {
      totalConnections: 0,
      totalReconnections: 0,
      totalMessagesReceived: 0,
      totalMessagesRecovered: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  /**
   * Connect to WebSocket server
   */
  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      return;
    }

    this.setState('connecting');
    await this.establishConnection();
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.setState('disconnected');
    this.cleanup();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
  }

  /**
   * Subscribe to sentiment updates for assets
   */
  subscribe(assets: string[]): void {
    if (!this.ws || this.state !== 'connected') {
      throw new Error('Not connected');
    }

    const message = {
      type: 'subscribe',
      assets,
      sessionId: this.session?.sessionId,
    };

    this.ws.send(JSON.stringify(message));

    if (this.session) {
      this.session.subscriptions = [
        ...new Set([...this.session.subscriptions, ...assets]),
      ];
    }
  }

  /**
   * Unsubscribe from sentiment updates
   */
  unsubscribe(assets: string[]): void {
    if (!this.ws || this.state !== 'connected') {
      throw new Error('Not connected');
    }

    const message = {
      type: 'unsubscribe',
      assets,
      sessionId: this.session?.sessionId,
    };

    this.ws.send(JSON.stringify(message));

    if (this.session) {
      this.session.subscriptions = this.session.subscriptions.filter(
        (a) => !assets.includes(a)
      );
    }
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Get current session info
   */
  getSession(): SessionState | null {
    return this.session;
  }

  /**
   * Get connection metrics
   */
  getMetrics(): ConnectionMetrics {
    return {
      ...this.metrics,
      currentSessionDuration: this.session
        ? Date.now() - this.session.connectedAt.getTime()
        : undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // CONNECTION MANAGEMENT
  // ---------------------------------------------------------------------------

  private async establishConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const url = this.buildConnectionUrl();
        this.ws = new WebSocket(url, this.config.protocols);

        this.ws.on('open', () => {
          this.onOpen();
          resolve();
        });

        this.ws.on('message', (data) => this.onMessage(data));
        this.ws.on('close', (code, reason) => this.onClose(code, reason.toString()));
        this.ws.on('error', (error) => this.onError(error));
        this.ws.on('pong', () => this.onPong());

      } catch (error) {
        this.onError(error as Error);
        reject(error);
      }
    });
  }

  private buildConnectionUrl(): string {
    const url = new URL(this.config.url);
    url.searchParams.set('apiKey', this.config.apiKey);
    url.searchParams.set('clientId', this.config.clientId);

    // Include session info for resumption
    if (this.session) {
      url.searchParams.set('sessionId', this.session.sessionId);
      url.searchParams.set('lastSequence', String(this.session.lastSequenceNumber));
    }

    return url.toString();
  }

  // ---------------------------------------------------------------------------
  // EVENT HANDLERS
  // ---------------------------------------------------------------------------

  private onOpen(): void {
    this.setState('connected');
    this.reconnectAttempts = 0;
    this.missedHeartbeats = 0;
    this.metrics.totalConnections++;
    this.metrics.lastConnectedAt = new Date();

    // Initialize or resume session
    if (!this.session) {
      this.initializeSession();
    } else {
      this.resumeSession();
    }

    // Start heartbeat
    this.startHeartbeat();

    this.emit('connected', { sessionId: this.session?.sessionId });
  }

  private onMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());
      this.handleMessage(message);
    } catch (error) {
      this.emit('error', new Error(`Failed to parse message: ${error}`));
    }
  }

  private handleMessage(message: any): void {
    // Update session state
    if (this.session) {
      this.session.lastMessageAt = new Date();
      if (message.sequenceNumber) {
        this.session.lastSequenceNumber = message.sequenceNumber;
      }
    }

    this.metrics.totalMessagesReceived++;

    // Handle different message types
    switch (message.type) {
      case 'session_init':
        this.handleSessionInit(message);
        break;

      case 'session_resume':
        this.handleSessionResume(message);
        break;

      case 'sentiment':
        this.emit('sentiment', message.payload);
        break;

      case 'alert':
        this.emit('alert', message.payload);
        break;

      case 'recovery_complete':
        this.handleRecoveryComplete(message);
        break;

      case 'error':
        this.emit('error', new Error(message.message));
        break;

      case 'heartbeat':
        // Server-initiated heartbeat
        this.ws?.send(JSON.stringify({ type: 'heartbeat_ack' }));
        break;

      default:
        this.emit('message', message);
    }
  }

  private onClose(code: number, reason: string): void {
    this.cleanup();
    this.metrics.lastDisconnectedAt = new Date();

    this.emit('disconnected', { code, reason });

    // Determine if we should reconnect
    if (this.shouldReconnect(code)) {
      this.scheduleReconnect();
    } else {
      this.setState('failed');
      this.emit('failed', { code, reason });
    }
  }

  private onError(error: Error): void {
    this.emit('error', error);
  }

  private onPong(): void {
    this.missedHeartbeats = 0;
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  // ---------------------------------------------------------------------------
  // SESSION MANAGEMENT
  // ---------------------------------------------------------------------------

  private initializeSession(): void {
    // Server will send session_init message with session ID
  }

  private handleSessionInit(message: any): void {
    this.session = {
      sessionId: message.sessionId,
      lastSequenceNumber: message.sequenceNumber || 0,
      subscriptions: [],
      connectedAt: new Date(),
      lastMessageAt: new Date(),
    };

    this.emit('session_started', this.session);
  }

  private resumeSession(): void {
    this.setState('recovering');

    // Server will send recovery messages and then session_resume confirmation
    this.emit('recovery_started', {
      sessionId: this.session?.sessionId,
      fromSequence: this.session?.lastSequenceNumber,
    });
  }

  private handleSessionResume(message: any): void {
    if (message.recoveredMessages > 0) {
      this.metrics.totalMessagesRecovered += message.recoveredMessages;
    }

    this.setState('connected');

    // Re-subscribe to previous subscriptions
    if (this.session && this.session.subscriptions.length > 0) {
      this.subscribe(this.session.subscriptions);
    }

    this.emit('session_resumed', {
      sessionId: this.session?.sessionId,
      recoveredMessages: message.recoveredMessages,
    });
  }

  private handleRecoveryComplete(message: any): void {
    this.metrics.totalMessagesRecovered += message.messagesRecovered || 0;

    this.emit('recovery_complete', {
      messagesRecovered: message.messagesRecovered,
      fromSequence: message.fromSequence,
      toSequence: message.toSequence,
    });
  }

  // ---------------------------------------------------------------------------
  // HEARTBEAT MANAGEMENT
  // ---------------------------------------------------------------------------

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.config.heartbeat.intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  private sendHeartbeat(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Send ping
    this.ws.ping();

    // Set timeout for pong response
    this.heartbeatTimeout = setTimeout(() => {
      this.missedHeartbeats++;

      if (this.missedHeartbeats >= this.config.heartbeat.missedThreshold) {
        this.emit('heartbeat_timeout', { missed: this.missedHeartbeats });
        this.ws?.close(4000, 'Heartbeat timeout');
      }
    }, this.config.heartbeat.timeoutMs);
  }

  // ---------------------------------------------------------------------------
  // RECONNECTION LOGIC
  // ---------------------------------------------------------------------------

  private shouldReconnect(closeCode: number): boolean {
    // Don't reconnect on normal closure or authentication errors
    const noReconnectCodes = [
      1000, // Normal closure
      1008, // Policy violation
      4001, // Authentication failed
      4003, // Forbidden
    ];

    if (noReconnectCodes.includes(closeCode)) {
      return false;
    }

    // Check max attempts
    if (
      this.config.reconnection.maxAttempts > 0 &&
      this.reconnectAttempts >= this.config.reconnection.maxAttempts
    ) {
      return false;
    }

    // Check if we're in a terminal state
    if (this.state === 'disconnected' || this.state === 'failed') {
      return false;
    }

    return true;
  }

  private scheduleReconnect(): void {
    this.setState('reconnecting');
    this.reconnectAttempts++;
    this.metrics.totalReconnections++;

    const delay = this.calculateBackoff();

    this.emit('reconnecting', {
      attempt: this.reconnectAttempts,
      delay,
      maxAttempts: this.config.reconnection.maxAttempts,
    });

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.establishConnection();
      } catch (error) {
        // Connection failed, will trigger onClose -> scheduleReconnect
      }
    }, delay);
  }

  private calculateBackoff(): number {
    const { initialDelayMs, maxDelayMs, backoffMultiplier, jitterFactor } =
      this.config.reconnection;

    // Exponential backoff
    let delay = initialDelayMs * Math.pow(backoffMultiplier, this.reconnectAttempts - 1);

    // Cap at max delay
    delay = Math.min(delay, maxDelayMs);

    // Add jitter
    const jitter = delay * jitterFactor * (Math.random() * 2 - 1);
    delay = Math.max(initialDelayMs, delay + jitter);

    return Math.floor(delay);
  }

  // ---------------------------------------------------------------------------
  // CLEANUP & STATE MANAGEMENT
  // ---------------------------------------------------------------------------

  private cleanup(): void {
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setState(newState: ConnectionState): void {
    const previousState = this.state;
    this.state = newState;

    if (previousState !== newState) {
      this.emit('state_change', { previous: previousState, current: newState });
    }
  }
}

// =============================================================================
// SERVER-SIDE MESSAGE BUFFER
// =============================================================================

export class MessageBuffer {
  private buffer: Map<string, BufferedMessage[]> = new Map();
  private config: MessageRecoveryConfig;
  private cleanupTimer: ReturnType<typeof setTimeout>;

  constructor(config: MessageRecoveryConfig = DEFAULT_RECOVERY_CONFIG) {
    this.config = config;

    // Periodic cleanup of old messages
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 60000); // Every minute
  }

  /**
   * Add a message to the buffer for a session
   */
  addMessage(sessionId: string, message: BufferedMessage): void {
    if (!this.buffer.has(sessionId)) {
      this.buffer.set(sessionId, []);
    }

    const sessionBuffer = this.buffer.get(sessionId)!;

    // Enforce max buffer size
    if (sessionBuffer.length >= this.config.maxBufferSize) {
      sessionBuffer.shift(); // Remove oldest
    }

    sessionBuffer.push(message);
  }

  /**
   * Get messages for recovery
   */
  getMessages(request: RecoveryRequest): RecoveryResponse {
    const sessionBuffer = this.buffer.get(request.sessionId) || [];

    const messages = sessionBuffer.filter((m) => {
      const afterFrom = m.sequenceNumber > request.fromSequence;
      const beforeTo = !request.toSequence || m.sequenceNumber <= request.toSequence;
      return afterFrom && beforeTo;
    });

    const fromSequence = messages.length > 0 ? messages[0].sequenceNumber : request.fromSequence;
    const toSequence = messages.length > 0 ? messages[messages.length - 1].sequenceNumber : request.fromSequence;

    return {
      messages,
      fromSequence,
      toSequence,
      complete: true,
    };
  }

  /**
   * Clear buffer for a session
   */
  clearSession(sessionId: string): void {
    this.buffer.delete(sessionId);
  }

  /**
   * Cleanup expired messages
   */
  private cleanup(): void {
    const cutoff = Date.now() - this.config.bufferDurationMs;

    for (const [sessionId, messages] of this.buffer.entries()) {
      const filtered = messages.filter(
        (m) => new Date(m.timestamp).getTime() > cutoff
      );

      if (filtered.length === 0) {
        this.buffer.delete(sessionId);
      } else {
        this.buffer.set(sessionId, filtered);
      }
    }
  }

  /**
   * Stop cleanup timer
   */
  destroy(): void {
    clearInterval(this.cleanupTimer);
  }
}

// =============================================================================
// SERVER-SIDE SESSION MANAGER (Redis-backed for horizontal scaling)
// =============================================================================

export interface SessionManagerConfig {
  redis?: Redis;
  keyPrefix?: string;
  sessionTTL?: number; // seconds
  bufferDurationMs?: number;
  maxBufferSize?: number;
  recoveryEndpoint?: string;
}

export class SessionManager {
  private redis: Redis | null;
  private localSessions: Map<string, SessionState> = new Map(); // Fallback for non-Redis mode
  private messageBuffer: MessageBuffer;
  private sequenceCounter: number = 0;
  private keyPrefix: string;
  private sessionTTL: number;

  constructor(config: SessionManagerConfig = {}) {
    this.redis = config.redis || null;
    this.keyPrefix = config.keyPrefix || 'ws:session:';
    this.sessionTTL = config.sessionTTL || 3600; // 1 hour default
    this.messageBuffer = new MessageBuffer({
      bufferDurationMs: config.bufferDurationMs || DEFAULT_RECOVERY_CONFIG.bufferDurationMs,
      maxBufferSize: config.maxBufferSize || DEFAULT_RECOVERY_CONFIG.maxBufferSize,
      recoveryEndpoint: config.recoveryEndpoint || DEFAULT_RECOVERY_CONFIG.recoveryEndpoint,
    });
  }

  /**
   * Create a new session
   */
  createSession(clientId: string): SessionState {
    const sessionId = this.generateSessionId();
    const session: SessionState = {
      sessionId,
      lastSequenceNumber: this.sequenceCounter,
      subscriptions: [],
      connectedAt: new Date(),
      lastMessageAt: new Date(),
    };

    // Store in Redis if available, otherwise use local Map
    if (this.redis) {
      this.storeSessionInRedis(session, clientId);
    } else {
      this.localSessions.set(sessionId, session);
    }

    return session;
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<SessionState | undefined> {
    if (this.redis) {
      return this.getSessionFromRedis(sessionId);
    }
    return this.localSessions.get(sessionId);
  }

  /**
   * Synchronous get for backwards compatibility (uses local cache)
   */
  getSessionSync(sessionId: string): SessionState | undefined {
    return this.localSessions.get(sessionId);
  }

  /**
   * Resume an existing session
   */
  resumeSession(
    sessionId: string,
    lastSequence: number
  ): { session: SessionState; recovery: RecoveryResponse } | null {
    // For resume, we check local first, then async Redis load
    let session = this.localSessions.get(sessionId);

    if (!session) {
      // Try to load from Redis synchronously via cache
      // In production, this should be async
      return null;
    }

    // Get missed messages
    const recovery = this.messageBuffer.getMessages({
      sessionId,
      fromSequence: lastSequence,
    });

    // Update session
    session.connectedAt = new Date();
    session.lastMessageAt = new Date();

    // Update in Redis
    if (this.redis) {
      this.updateSessionInRedis(session);
    }

    return { session, recovery };
  }

  /**
   * Async resume with Redis support
   */
  async resumeSessionAsync(
    sessionId: string,
    lastSequence: number
  ): Promise<{ session: SessionState; recovery: RecoveryResponse } | null> {
    let session = this.localSessions.get(sessionId);

    // Try Redis if not in local cache
    if (!session && this.redis) {
      session = await this.getSessionFromRedis(sessionId);
      if (session) {
        this.localSessions.set(sessionId, session);
      }
    }

    if (!session) {
      return null;
    }

    const recovery = this.messageBuffer.getMessages({
      sessionId,
      fromSequence: lastSequence,
    });

    session.connectedAt = new Date();
    session.lastMessageAt = new Date();

    if (this.redis) {
      await this.updateSessionInRedis(session);
    }

    return { session, recovery };
  }

  /**
   * Record a message sent to a session
   */
  recordMessage(sessionId: string, topic: string, payload: any): number {
    const sequenceNumber = ++this.sequenceCounter;

    this.messageBuffer.addMessage(sessionId, {
      sequenceNumber,
      timestamp: new Date().toISOString(),
      topic,
      payload,
    });

    const session = this.localSessions.get(sessionId);
    if (session) {
      session.lastSequenceNumber = sequenceNumber;
      session.lastMessageAt = new Date();

      if (this.redis) {
        this.updateSessionInRedis(session);
      }
    }

    return sequenceNumber;
  }

  /**
   * End a session
   */
  endSession(sessionId: string): void {
    this.localSessions.delete(sessionId);

    if (this.redis) {
      this.redis.del(`${this.keyPrefix}${sessionId}`).catch(() => {});
    }
    // Keep buffer for potential reconnection within buffer duration
  }

  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions(maxAgeMs: number): void {
    const cutoff = Date.now() - maxAgeMs;

    for (const [sessionId, session] of this.localSessions.entries()) {
      if (session.lastMessageAt.getTime() < cutoff) {
        this.localSessions.delete(sessionId);
        this.messageBuffer.clearSession(sessionId);

        if (this.redis) {
          this.redis.del(`${this.keyPrefix}${sessionId}`).catch(() => {});
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // REDIS HELPERS
  // ---------------------------------------------------------------------------

  private async storeSessionInRedis(session: SessionState, clientId: string): Promise<void> {
    if (!this.redis) return;

    const data = {
      ...session,
      clientId,
      connectedAt: session.connectedAt.toISOString(),
      lastMessageAt: session.lastMessageAt.toISOString(),
    };

    await this.redis.setex(
      `${this.keyPrefix}${session.sessionId}`,
      this.sessionTTL,
      JSON.stringify(data)
    );

    // Also cache locally for fast access
    this.localSessions.set(session.sessionId, session);
  }

  private async getSessionFromRedis(sessionId: string): Promise<SessionState | undefined> {
    if (!this.redis) return undefined;

    try {
      const data = await this.redis.get(`${this.keyPrefix}${sessionId}`);
      if (!data) return undefined;

      const parsed = JSON.parse(data);
      return {
        sessionId: parsed.sessionId,
        lastSequenceNumber: parsed.lastSequenceNumber,
        subscriptions: parsed.subscriptions || [],
        connectedAt: new Date(parsed.connectedAt),
        lastMessageAt: new Date(parsed.lastMessageAt),
      };
    } catch {
      return undefined;
    }
  }

  private async updateSessionInRedis(session: SessionState): Promise<void> {
    if (!this.redis) return;

    const data = {
      ...session,
      connectedAt: session.connectedAt.toISOString(),
      lastMessageAt: session.lastMessageAt.toISOString(),
    };

    await this.redis.setex(
      `${this.keyPrefix}${session.sessionId}`,
      this.sessionTTL,
      JSON.stringify(data)
    ).catch(() => {});
  }

  private generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  destroy(): void {
    this.messageBuffer.destroy();
  }
}

// =============================================================================
// PROTOCOL MESSAGES
// =============================================================================

export const ProtocolMessages = {
  // Server -> Client
  sessionInit: (sessionId: string, sequenceNumber: number) => ({
    type: 'session_init',
    sessionId,
    sequenceNumber,
    timestamp: new Date().toISOString(),
  }),

  sessionResume: (sessionId: string, recoveredMessages: number) => ({
    type: 'session_resume',
    sessionId,
    recoveredMessages,
    timestamp: new Date().toISOString(),
  }),

  sentiment: (sequenceNumber: number, payload: any) => ({
    type: 'sentiment',
    sequenceNumber,
    payload,
    timestamp: new Date().toISOString(),
  }),

  alert: (sequenceNumber: number, payload: any) => ({
    type: 'alert',
    sequenceNumber,
    payload,
    timestamp: new Date().toISOString(),
  }),

  recoveryComplete: (
    messagesRecovered: number,
    fromSequence: number,
    toSequence: number
  ) => ({
    type: 'recovery_complete',
    messagesRecovered,
    fromSequence,
    toSequence,
    timestamp: new Date().toISOString(),
  }),

  error: (code: string, message: string) => ({
    type: 'error',
    code,
    message,
    timestamp: new Date().toISOString(),
  }),

  // Client -> Server
  subscribe: (assets: string[], sessionId: string) => ({
    type: 'subscribe',
    assets,
    sessionId,
  }),

  unsubscribe: (assets: string[], sessionId: string) => ({
    type: 'unsubscribe',
    assets,
    sessionId,
  }),

  heartbeatAck: () => ({
    type: 'heartbeat_ack',
    timestamp: new Date().toISOString(),
  }),
};

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  ResilientWebSocketClient,
  MessageBuffer,
  SessionManager,
  ProtocolMessages,
  DEFAULT_RECONNECTION_CONFIG,
  DEFAULT_HEARTBEAT_CONFIG,
  DEFAULT_RECOVERY_CONFIG,
};
