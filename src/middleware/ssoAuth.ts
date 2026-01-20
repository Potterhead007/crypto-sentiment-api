/**
 * SSO/SAML Authentication Support
 * Institutional-Grade Cryptocurrency Market Sentiment Analysis API
 *
 * Provides:
 * - SAML 2.0 authentication
 * - OIDC (OpenID Connect) authentication
 * - Enterprise SSO integration
 * - JWT token management
 * - Session management
 */

import { Request, Response, NextFunction, Router } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

export type AuthProvider = 'saml' | 'oidc' | 'api_key' | 'jwt';

export interface SSOConfig {
  /** SAML configuration */
  saml?: SAMLConfig;
  /** OIDC configuration */
  oidc?: OIDCConfig;
  /** JWT configuration */
  jwt: JWTConfig;
  /** Session configuration */
  session: SessionConfig;
  /** Allowed authentication methods */
  allowedMethods: AuthProvider[];
}

export interface SAMLConfig {
  /** Service Provider Entity ID */
  entityId: string;
  /** Assertion Consumer Service URL */
  acsUrl: string;
  /** Single Logout Service URL */
  sloUrl?: string;
  /** Service Provider Certificate */
  certificate: string;
  /** Service Provider Private Key */
  privateKey: string;
  /** Identity Providers */
  identityProviders: SAMLIdentityProvider[];
  /** Attribute mapping */
  attributeMapping: SAMLAttributeMapping;
  /** Whether to sign requests */
  signRequests: boolean;
  /** Whether to encrypt assertions */
  wantEncryptedAssertions: boolean;
  /** Allowed clock skew in seconds */
  allowedClockSkew: number;
}

export interface SAMLIdentityProvider {
  /** IdP identifier */
  id: string;
  /** IdP name */
  name: string;
  /** IdP SSO URL */
  ssoUrl: string;
  /** IdP SLO URL */
  sloUrl?: string;
  /** IdP Certificate */
  certificate: string;
  /** IdP Entity ID */
  entityId: string;
  /** Organization mapping */
  organizationId: string;
}

export interface SAMLAttributeMapping {
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  groups?: string;
  role?: string;
}

export interface OIDCConfig {
  /** OIDC Providers */
  providers: OIDCProvider[];
  /** Client ID */
  clientId: string;
  /** Client Secret */
  clientSecret: string;
  /** Redirect URI */
  redirectUri: string;
  /** Scopes */
  scopes: string[];
  /** Response type */
  responseType: 'code' | 'id_token' | 'code id_token';
}

export interface OIDCProvider {
  /** Provider identifier */
  id: string;
  /** Provider name */
  name: string;
  /** Issuer URL */
  issuer: string;
  /** Authorization endpoint */
  authorizationEndpoint: string;
  /** Token endpoint */
  tokenEndpoint: string;
  /** UserInfo endpoint */
  userInfoEndpoint: string;
  /** JWKS URI */
  jwksUri: string;
  /** Organization mapping */
  organizationId: string;
}

export interface JWTConfig {
  /** JWT secret or private key */
  secret: string;
  /** Token expiration */
  expiresIn: string;
  /** Refresh token expiration */
  refreshExpiresIn: string;
  /** Issuer */
  issuer: string;
  /** Audience */
  audience: string;
  /** Algorithm */
  algorithm: 'HS256' | 'HS384' | 'HS512' | 'RS256' | 'RS384' | 'RS512';
}

export interface SessionConfig {
  /** Session duration in seconds */
  duration: number;
  /** Idle timeout in seconds */
  idleTimeout: number;
  /** Maximum sessions per user */
  maxSessionsPerUser: number;
  /** Whether to enforce single session */
  singleSession: boolean;
}

export interface AuthenticatedUser {
  /** User ID */
  id: string;
  /** Email */
  email: string;
  /** Display name */
  displayName?: string;
  /** First name */
  firstName?: string;
  /** Last name */
  lastName?: string;
  /** Organization ID */
  organizationId: string;
  /** Client ID */
  clientId: string;
  /** Tier */
  tier: string;
  /** Roles */
  roles: string[];
  /** Groups */
  groups: string[];
  /** Authentication provider */
  authProvider: AuthProvider;
  /** Session ID */
  sessionId: string;
  /** Token issued at */
  issuedAt: Date;
  /** Token expires at */
  expiresAt: Date;
}

export interface Session {
  id: string;
  userId: string;
  organizationId: string;
  authProvider: AuthProvider;
  createdAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
  ipAddress: string;
  userAgent: string;
  metadata: Record<string, any>;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  scope: string;
}

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

export const DEFAULT_SSO_CONFIG: Partial<SSOConfig> = {
  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-in-production',
    expiresIn: '1h',
    refreshExpiresIn: '7d',
    issuer: 'crypto-sentiment-api',
    audience: 'crypto-sentiment-api-clients',
    algorithm: 'HS256',
  },
  session: {
    duration: 86400, // 24 hours
    idleTimeout: 3600, // 1 hour
    maxSessionsPerUser: 10,
    singleSession: false,
  },
  allowedMethods: ['api_key', 'jwt'],
};

// =============================================================================
// SESSION MANAGER
// =============================================================================

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private userSessions: Map<string, Set<string>> = new Map();
  private config: SessionConfig;

  constructor(config: SessionConfig) {
    this.config = config;

    // Start cleanup timer
    setInterval(() => this.cleanupExpiredSessions(), 60000);
  }

  /**
   * Create a new session
   */
  createSession(
    userId: string,
    organizationId: string,
    authProvider: AuthProvider,
    ipAddress: string,
    userAgent: string,
    metadata: Record<string, any> = {}
  ): Session {
    // Check max sessions
    const userSessionIds = this.userSessions.get(userId) || new Set();

    if (this.config.singleSession && userSessionIds.size > 0) {
      // Revoke existing sessions
      for (const sessionId of userSessionIds) {
        this.revokeSession(sessionId);
      }
    } else if (userSessionIds.size >= this.config.maxSessionsPerUser) {
      // Remove oldest session
      const oldestSession = this.getOldestSession(userId);
      if (oldestSession) {
        this.revokeSession(oldestSession.id);
      }
    }

    const sessionId = this.generateSessionId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.duration * 1000);

    const session: Session = {
      id: sessionId,
      userId,
      organizationId,
      authProvider,
      createdAt: now,
      lastActiveAt: now,
      expiresAt,
      ipAddress,
      userAgent,
      metadata,
    };

    this.sessions.set(sessionId, session);

    // Track user sessions
    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, new Set());
    }
    this.userSessions.get(userId)!.add(sessionId);

    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): Session | null {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    // Check expiration
    if (new Date() > session.expiresAt) {
      this.revokeSession(sessionId);
      return null;
    }

    // Check idle timeout
    const idleTime = (Date.now() - session.lastActiveAt.getTime()) / 1000;
    if (idleTime > this.config.idleTimeout) {
      this.revokeSession(sessionId);
      return null;
    }

    return session;
  }

  /**
   * Update session activity
   */
  touchSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.lastActiveAt = new Date();
    return true;
  }

  /**
   * Revoke a session
   */
  revokeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    this.sessions.delete(sessionId);

    const userSessionIds = this.userSessions.get(session.userId);
    if (userSessionIds) {
      userSessionIds.delete(sessionId);
      if (userSessionIds.size === 0) {
        this.userSessions.delete(session.userId);
      }
    }

    return true;
  }

  /**
   * Revoke all sessions for a user
   */
  revokeUserSessions(userId: string): number {
    const sessionIds = this.userSessions.get(userId);
    if (!sessionIds) {
      return 0;
    }

    let count = 0;
    for (const sessionId of sessionIds) {
      if (this.revokeSession(sessionId)) {
        count++;
      }
    }

    return count;
  }

  /**
   * Get all sessions for a user
   */
  getUserSessions(userId: string): Session[] {
    const sessionIds = this.userSessions.get(userId);
    if (!sessionIds) {
      return [];
    }

    const sessions: Session[] = [];
    for (const sessionId of sessionIds) {
      const session = this.getSession(sessionId);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  private generateSessionId(): string {
    return `sess_${crypto.randomBytes(32).toString('hex')}`;
  }

  private getOldestSession(userId: string): Session | null {
    const sessionIds = this.userSessions.get(userId);
    if (!sessionIds || sessionIds.size === 0) {
      return null;
    }

    let oldest: Session | null = null;
    for (const sessionId of sessionIds) {
      const session = this.sessions.get(sessionId);
      if (session && (!oldest || session.createdAt < oldest.createdAt)) {
        oldest = session;
      }
    }

    return oldest;
  }

  private cleanupExpiredSessions(): void {
    const now = new Date();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.revokeSession(sessionId);
      }
    }
  }
}

// =============================================================================
// TOKEN MANAGER
// =============================================================================

export class TokenManager {
  private config: JWTConfig;
  private refreshTokens: Map<string, { userId: string; expiresAt: Date }> = new Map();

  constructor(config: JWTConfig) {
    this.config = config;

    // Cleanup expired refresh tokens
    setInterval(() => this.cleanupRefreshTokens(), 3600000);
  }

  /**
   * Generate access token
   */
  generateAccessToken(user: AuthenticatedUser): string {
    const payload = {
      sub: user.id,
      email: user.email,
      org: user.organizationId,
      client: user.clientId,
      tier: user.tier,
      roles: user.roles,
      groups: user.groups,
      provider: user.authProvider,
      session: user.sessionId,
    };

    return jwt.sign(payload, this.config.secret, {
      expiresIn: this.config.expiresIn as string,
      issuer: this.config.issuer,
      audience: this.config.audience,
      algorithm: this.config.algorithm,
    } as jwt.SignOptions);
  }

  /**
   * Generate refresh token
   */
  generateRefreshToken(userId: string): string {
    const token = crypto.randomBytes(64).toString('hex');
    const expiresAt = new Date(Date.now() + this.parseExpiration(this.config.refreshExpiresIn));

    this.refreshTokens.set(token, { userId, expiresAt });

    return token;
  }

  /**
   * Generate token pair
   */
  generateTokenPair(user: AuthenticatedUser): TokenPair {
    const accessToken = this.generateAccessToken(user);
    const refreshToken = this.generateRefreshToken(user.id);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.parseExpiration(this.config.expiresIn) / 1000,
      scope: 'read write',
    };
  }

  /**
   * Verify access token
   */
  verifyAccessToken(token: string): jwt.JwtPayload {
    return jwt.verify(token, this.config.secret, {
      issuer: this.config.issuer,
      audience: this.config.audience,
    }) as jwt.JwtPayload;
  }

  /**
   * Verify refresh token
   */
  verifyRefreshToken(token: string): { userId: string } | null {
    const data = this.refreshTokens.get(token);

    if (!data) {
      return null;
    }

    if (new Date() > data.expiresAt) {
      this.refreshTokens.delete(token);
      return null;
    }

    return { userId: data.userId };
  }

  /**
   * Revoke refresh token
   */
  revokeRefreshToken(token: string): boolean {
    return this.refreshTokens.delete(token);
  }

  private parseExpiration(exp: string): number {
    const match = exp.match(/^(\d+)([smhd])$/);
    if (!match) {
      return 3600000; // Default 1 hour
    }

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 3600000;
    }
  }

  private cleanupRefreshTokens(): void {
    const now = new Date();
    for (const [token, data] of this.refreshTokens.entries()) {
      if (now > data.expiresAt) {
        this.refreshTokens.delete(token);
      }
    }
  }
}

// =============================================================================
// SAML HANDLER
// =============================================================================

export class SAMLHandler {
  private config: SAMLConfig;

  constructor(config: SAMLConfig) {
    this.config = config;
  }

  /**
   * Generate SAML AuthnRequest
   */
  generateAuthnRequest(idpId: string): { url: string; requestId: string } {
    const idp = this.config.identityProviders.find(p => p.id === idpId);
    if (!idp) {
      throw new Error(`Identity provider ${idpId} not found`);
    }

    const requestId = `_${crypto.randomBytes(16).toString('hex')}`;
    const issueInstant = new Date().toISOString();

    const authnRequest = `
      <samlp:AuthnRequest
        xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
        xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
        ID="${requestId}"
        Version="2.0"
        IssueInstant="${issueInstant}"
        Destination="${idp.ssoUrl}"
        AssertionConsumerServiceURL="${this.config.acsUrl}"
        ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">
        <saml:Issuer>${this.config.entityId}</saml:Issuer>
        <samlp:NameIDPolicy
          Format="urn:oasis:names:tc:SAML:2.0:nameid-format:emailAddress"
          AllowCreate="true"/>
      </samlp:AuthnRequest>
    `.trim();

    const encodedRequest = Buffer.from(authnRequest).toString('base64');
    const url = `${idp.ssoUrl}?SAMLRequest=${encodeURIComponent(encodedRequest)}`;

    return { url, requestId };
  }

  /**
   * Parse and validate SAML Response
   * Note: In production, use a proper SAML library like saml2-js or passport-saml
   */
  parseResponse(samlResponse: string, _expectedRequestId?: string): SAMLAssertion {
    // Decode response
    const decoded = Buffer.from(samlResponse, 'base64').toString('utf-8');

    // This is a simplified parser - use a proper SAML library in production
    const assertion: SAMLAssertion = {
      issuer: this.extractValue(decoded, 'Issuer'),
      subject: {
        nameId: this.extractValue(decoded, 'NameID'),
        format: 'email',
      },
      conditions: {
        notBefore: new Date(this.extractAttribute(decoded, 'Conditions', 'NotBefore')),
        notOnOrAfter: new Date(this.extractAttribute(decoded, 'Conditions', 'NotOnOrAfter')),
        audience: this.extractValue(decoded, 'Audience'),
      },
      attributes: this.extractAttributes(decoded),
      sessionIndex: this.extractAttribute(decoded, 'AuthnStatement', 'SessionIndex'),
    };

    // Validate conditions
    const now = new Date();
    if (assertion.conditions.notBefore && now < assertion.conditions.notBefore) {
      throw new Error('SAML assertion not yet valid');
    }
    if (assertion.conditions.notOnOrAfter && now > assertion.conditions.notOnOrAfter) {
      throw new Error('SAML assertion has expired');
    }

    return assertion;
  }

  /**
   * Generate Service Provider metadata
   */
  generateMetadata(): string {
    return `
      <?xml version="1.0"?>
      <md:EntityDescriptor
        xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
        entityID="${this.config.entityId}">
        <md:SPSSODescriptor
          AuthnRequestsSigned="${this.config.signRequests}"
          WantAssertionsSigned="true"
          protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
          <md:NameIDFormat>urn:oasis:names:tc:SAML:2.0:nameid-format:emailAddress</md:NameIDFormat>
          <md:AssertionConsumerService
            Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
            Location="${this.config.acsUrl}"
            index="0"/>
          ${this.config.sloUrl ? `
          <md:SingleLogoutService
            Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
            Location="${this.config.sloUrl}"/>
          ` : ''}
        </md:SPSSODescriptor>
      </md:EntityDescriptor>
    `.trim();
  }

  private extractValue(xml: string, tag: string): string {
    const regex = new RegExp(`<[^>]*${tag}[^>]*>([^<]*)<`);
    const match = xml.match(regex);
    return match ? match[1] : '';
  }

  private extractAttribute(xml: string, tag: string, attr: string): string {
    const regex = new RegExp(`<[^>]*${tag}[^>]*${attr}="([^"]*)"`, 'i');
    const match = xml.match(regex);
    return match ? match[1] : '';
  }

  private extractAttributes(xml: string): Record<string, string> {
    const attributes: Record<string, string> = {};
    const regex = /<Attribute Name="([^"]+)"[^>]*>[\s\S]*?<AttributeValue[^>]*>([^<]*)<\/AttributeValue>/g;
    let match;

    while ((match = regex.exec(xml)) !== null) {
      attributes[match[1]] = match[2];
    }

    return attributes;
  }
}

export interface SAMLAssertion {
  issuer: string;
  subject: {
    nameId: string;
    format: string;
  };
  conditions: {
    notBefore: Date;
    notOnOrAfter: Date;
    audience: string;
  };
  attributes: Record<string, string>;
  sessionIndex: string;
}

// =============================================================================
// AUTHENTICATION MIDDLEWARE
// =============================================================================

export interface AuthMiddlewareOptions {
  config: SSOConfig;
  sessionManager: SessionManager;
  tokenManager: TokenManager;
  dbPool: Pool;
  getUserById?: (userId: string) => Promise<any>;
  getOrganizationConfig?: (orgId: string) => Promise<any>;
}

/**
 * Create authentication middleware
 */
export function createAuthMiddleware(options: AuthMiddlewareOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Skip auth for public endpoints
      if (isPublicEndpoint(req.path)) {
        return next();
      }

      let user: AuthenticatedUser | null = null;

      // Try different auth methods
      const authHeader = req.headers['authorization'];
      const apiKey = req.headers['x-api-key'] as string;

      // 1. Try Bearer token (JWT)
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        user = await authenticateJWT(token, options);
      }
      // 2. Try API Key
      else if (apiKey) {
        user = await authenticateApiKey(apiKey, options);
      }

      if (!user) {
        res.status(401).json({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
            documentation: 'https://docs.sentiment-api.io/authentication',
          },
        });
        return;
      }

      // Update session activity
      if (user.sessionId) {
        options.sessionManager.touchSession(user.sessionId);
      }

      // Attach user to request
      (req as any).user = user;

      // Set response headers
      res.setHeader('X-Client-Id', user.clientId);
      res.setHeader('X-Organization-Id', user.organizationId);

      next();
    } catch (error) {
      if ((error as any).name === 'TokenExpiredError') {
        res.status(401).json({
          error: {
            code: 'TOKEN_EXPIRED',
            message: 'Access token has expired',
            documentation: 'https://docs.sentiment-api.io/authentication#token-refresh',
          },
        });
        return;
      }

      res.status(401).json({
        error: {
          code: 'AUTHENTICATION_FAILED',
          message: 'Authentication failed',
        },
      });
    }
  };
}

async function authenticateJWT(
  token: string,
  options: AuthMiddlewareOptions
): Promise<AuthenticatedUser | null> {
  const payload = options.tokenManager.verifyAccessToken(token);

  // Verify session is still valid
  const session = options.sessionManager.getSession(payload.session as string);
  if (!session) {
    return null;
  }

  return {
    id: payload.sub as string,
    email: payload.email as string,
    displayName: payload.name as string,
    organizationId: payload.org as string,
    clientId: payload.client as string,
    tier: payload.tier as string,
    roles: payload.roles as string[],
    groups: payload.groups as string[],
    authProvider: payload.provider as AuthProvider,
    sessionId: payload.session as string,
    issuedAt: new Date((payload.iat as number) * 1000),
    expiresAt: new Date((payload.exp as number) * 1000),
  };
}

async function authenticateApiKey(
  apiKey: string,
  options: AuthMiddlewareOptions
): Promise<AuthenticatedUser | null> {
  // Validate API key format (must start with sk_)
  if (!apiKey.startsWith('sk_') || apiKey.length < 32) {
    return null;
  }

  // Hash the API key for database lookup (use SHA-256)
  const keyHash = crypto
    .createHash('sha256')
    .update(apiKey)
    .digest('hex');

  // Extract prefix for quick lookup (first 12 chars including 'sk_')
  const keyPrefix = apiKey.substring(0, 12);

  try {
    // Query database for API key and associated client
    const result = await options.dbPool.query<{
      key_id: string;
      client_id: string;
      scopes: string[];
      is_active: boolean;
      expires_at: Date | null;
      email: string;
      organization_id: string;
      tier: string;
      client_name: string;
      client_is_active: boolean;
    }>(`
      SELECT
        ak.id as key_id,
        ak.client_id,
        ak.scopes,
        ak.is_active,
        ak.expires_at,
        c.email,
        c.organization_id,
        c.tier,
        c.name as client_name,
        c.is_active as client_is_active
      FROM api_keys ak
      JOIN clients c ON ak.client_id = c.id
      WHERE ak.key_hash = $1 AND ak.key_prefix = $2
    `, [keyHash, keyPrefix]);

    if (result.rows.length === 0) {
      return null;
    }

    const keyData = result.rows[0];

    // Validate key is active
    if (!keyData.is_active) {
      return null;
    }

    // Validate client is active
    if (!keyData.client_is_active) {
      return null;
    }

    // Validate expiration
    if (keyData.expires_at && new Date() > new Date(keyData.expires_at)) {
      return null;
    }

    // Update last_used_at timestamp (fire and forget)
    options.dbPool.query(
      'UPDATE api_keys SET last_used_at = NOW() WHERE id = $1',
      [keyData.key_id]
    ).catch(() => { /* ignore errors on usage update */ });

    // Create session for API key auth
    const session = options.sessionManager.createSession(
      keyData.client_id,
      keyData.organization_id,
      'api_key',
      '0.0.0.0',
      'api-client'
    );

    return {
      id: keyData.client_id,
      email: keyData.email,
      displayName: keyData.client_name,
      organizationId: keyData.organization_id,
      clientId: keyData.client_id,
      tier: keyData.tier,
      roles: keyData.scopes || ['api_user'],
      groups: [],
      authProvider: 'api_key',
      sessionId: session.id,
      issuedAt: new Date(),
      expiresAt: session.expiresAt,
    };
  } catch (error) {
    // Log error but don't expose details
    console.error('API key authentication error:', (error as Error).message);
    return null;
  }
}

function isPublicEndpoint(path: string): boolean {
  const publicPaths = [
    '/health',
    '/health/ready',
    '/health/live',
    '/auth/saml/metadata',
    '/auth/saml/login',
    '/auth/saml/acs',
    '/auth/oidc/callback',
  ];

  return publicPaths.some(p => path.startsWith(p));
}

// =============================================================================
// AUTH ROUTES
// =============================================================================

export function createAuthRoutes(options: AuthMiddlewareOptions): Router {
  const router = Router();

  // Token refresh
  router.post('/auth/token/refresh', async (req: Request, res: Response) => {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      res.status(400).json({
        error: {
          code: 'MISSING_REFRESH_TOKEN',
          message: 'Refresh token is required',
        },
      });
      return;
    }

    const result = options.tokenManager.verifyRefreshToken(refresh_token);
    if (!result) {
      res.status(401).json({
        error: {
          code: 'INVALID_REFRESH_TOKEN',
          message: 'Invalid or expired refresh token',
        },
      });
      return;
    }

    // Get user and generate new tokens
    const user = await options.getUserById?.(result.userId);
    if (!user) {
      res.status(401).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
        },
      });
      return;
    }

    // Revoke old refresh token
    options.tokenManager.revokeRefreshToken(refresh_token);

    // Generate new token pair
    const session = options.sessionManager.getUserSessions(result.userId)[0];
    const authenticatedUser: AuthenticatedUser = {
      ...user,
      sessionId: session?.id || '',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
    };

    const tokens = options.tokenManager.generateTokenPair(authenticatedUser);

    res.json(tokens);
  });

  // Logout
  router.post('/auth/logout', async (req: Request, res: Response) => {
    const user = (req as any).user as AuthenticatedUser;

    if (user?.sessionId) {
      options.sessionManager.revokeSession(user.sessionId);
    }

    res.json({ success: true });
  });

  // Get current user
  router.get('/auth/me', async (req: Request, res: Response) => {
    const user = (req as any).user as AuthenticatedUser;

    if (!user) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Not authenticated',
        },
      });
      return;
    }

    res.json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      organizationId: user.organizationId,
      tier: user.tier,
      roles: user.roles,
      authProvider: user.authProvider,
    });
  });

  // List sessions
  router.get('/auth/sessions', async (req: Request, res: Response) => {
    const user = (req as any).user as AuthenticatedUser;

    if (!user) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Not authenticated',
        },
      });
      return;
    }

    const sessions = options.sessionManager.getUserSessions(user.id);

    res.json({
      sessions: sessions.map(s => ({
        id: s.id,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
        expiresAt: s.expiresAt,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        current: s.id === user.sessionId,
      })),
    });
  });

  // Revoke session
  router.delete('/auth/sessions/:sessionId', async (req: Request, res: Response) => {
    const user = (req as any).user as AuthenticatedUser;
    const { sessionId } = req.params;

    if (!user) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Not authenticated',
        },
      });
      return;
    }

    // Can only revoke own sessions
    const sessions = options.sessionManager.getUserSessions(user.id);
    if (!sessions.find(s => s.id === sessionId)) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Cannot revoke this session',
        },
      });
      return;
    }

    options.sessionManager.revokeSession(sessionId);

    res.json({ success: true });
  });

  return router;
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  SessionManager,
  TokenManager,
  SAMLHandler,
  createAuthMiddleware,
  createAuthRoutes,
  DEFAULT_SSO_CONFIG,
};
