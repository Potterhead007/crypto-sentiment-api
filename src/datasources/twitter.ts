/**
 * Twitter/X Data Source Client
 * Institutional-Grade Cryptocurrency Market Sentiment Analysis
 *
 * Supports:
 * - Twitter API v2 (Official)
 * - Fallback to data resellers
 * - Real-time streaming
 * - Historical search
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

export interface TwitterConfig {
  /** Twitter API Bearer Token */
  bearerToken?: string;
  /** API Key (for OAuth 1.0a) */
  apiKey?: string;
  /** API Secret */
  apiSecret?: string;
  /** Access Token */
  accessToken?: string;
  /** Access Token Secret */
  accessTokenSecret?: string;
  /** Rate limit per 15 minutes */
  rateLimitPer15Min?: number;
  /** Fallback provider config */
  fallback?: {
    provider: 'socialdata' | 'tweetscout' | 'apify';
    apiKey: string;
    baseUrl: string;
  };
}

export interface Tweet {
  id: string;
  text: string;
  authorId: string;
  authorUsername: string;
  authorName: string;
  authorFollowers: number;
  authorVerified: boolean;
  createdAt: Date;
  language: string;
  metrics: TweetMetrics;
  entities: TweetEntities;
  referencedTweets?: ReferencedTweet[];
  conversationId?: string;
  inReplyToUserId?: string;
  source?: string;
}

export interface TweetMetrics {
  retweets: number;
  replies: number;
  likes: number;
  quotes: number;
  bookmarks: number;
  impressions: number;
}

export interface TweetEntities {
  hashtags: string[];
  cashtags: string[];
  mentions: string[];
  urls: string[];
}

export interface ReferencedTweet {
  type: 'retweeted' | 'quoted' | 'replied_to';
  id: string;
}

export interface TwitterSearchParams {
  query: string;
  maxResults?: number;
  startTime?: Date;
  endTime?: Date;
  sinceTweetId?: string;
  untilTweetId?: string;
  sortOrder?: 'recency' | 'relevancy';
}

export interface TwitterStreamRule {
  id?: string;
  value: string;
  tag?: string;
}

interface RateLimitState {
  remaining: number;
  limit: number;
  resetAt: Date;
}

// =============================================================================
// TWITTER CLIENT
// =============================================================================

export class TwitterClient extends EventEmitter {
  private config: TwitterConfig;
  private rateLimits: Map<string, RateLimitState> = new Map();
  private streamConnection: AbortController | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private baseBackoffMs: number = 1000;

  constructor(config: TwitterConfig) {
    super();
    this.config = {
      rateLimitPer15Min: 450,
      ...config,
    };
  }

  // ---------------------------------------------------------------------------
  // SEARCH
  // ---------------------------------------------------------------------------

  /**
   * Search for recent tweets
   */
  async searchRecent(params: TwitterSearchParams): Promise<Tweet[]> {
    await this.checkRateLimit('search');

    const tweets: Tweet[] = [];

    try {
      if (this.config.bearerToken) {
        // Use official Twitter API v2
        const response = await this.fetchTwitterAPI('/2/tweets/search/recent', {
          query: params.query,
          max_results: Math.min(params.maxResults || 100, 100),
          start_time: params.startTime?.toISOString(),
          end_time: params.endTime?.toISOString(),
          since_id: params.sinceTweetId,
          until_id: params.untilTweetId,
          sort_order: params.sortOrder,
          'tweet.fields': 'author_id,created_at,entities,public_metrics,referenced_tweets,conversation_id,in_reply_to_user_id,lang,source',
          'user.fields': 'id,name,username,verified,public_metrics',
          'expansions': 'author_id,referenced_tweets.id',
        });

        if (response.data) {
          const users = new Map(
            (response.includes?.users || []).map((u: any) => [u.id, u])
          );

          for (const tweet of response.data) {
            const author = users.get(tweet.author_id);
            tweets.push(this.mapTweet(tweet, author));
          }
        }
      } else if (this.config.fallback) {
        // Use fallback provider
        const fallbackTweets = await this.searchFallback(params);
        tweets.push(...fallbackTweets);
      } else {
        throw new Error('No Twitter API credentials or fallback configured');
      }

      this.emit('search_complete', { query: params.query, count: tweets.length });
      return tweets;

    } catch (error) {
      this.emit('error', { operation: 'search', error });
      throw error;
    }
  }

  /**
   * Search for crypto-related tweets
   */
  async searchCrypto(
    assets: string[],
    options?: {
      maxResults?: number;
      startTime?: Date;
      languages?: string[];
      minFollowers?: number;
    }
  ): Promise<Tweet[]> {
    // Build crypto-focused query
    const assetQueries = assets.map(asset => {
      const variations = this.getAssetVariations(asset);
      return `(${variations.join(' OR ')})`;
    }).join(' OR ');

    // Filter for quality
    const qualityFilters = [
      '-is:retweet',          // No retweets
      '-is:reply',            // No replies (optionally include)
      'lang:en',              // English only (configurable)
      'has:hashtags OR has:cashtags', // Must have tags
    ];

    if (options?.minFollowers) {
      qualityFilters.push(`followers_count:${options.minFollowers}`);
    }

    const query = `(${assetQueries}) ${qualityFilters.join(' ')}`;

    return this.searchRecent({
      query,
      maxResults: options?.maxResults || 100,
      startTime: options?.startTime,
      sortOrder: 'recency',
    });
  }

  // ---------------------------------------------------------------------------
  // STREAMING
  // ---------------------------------------------------------------------------

  /**
   * Start filtered stream for real-time tweets
   */
  async startStream(rules: TwitterStreamRule[]): Promise<void> {
    if (!this.config.bearerToken) {
      throw new Error('Bearer token required for streaming');
    }

    // Set up stream rules
    await this.setStreamRules(rules);

    // Start stream connection
    this.connectStream();
  }

  /**
   * Stop the stream
   */
  stopStream(): void {
    if (this.streamConnection) {
      this.streamConnection.abort();
      this.streamConnection = null;
      this.emit('stream_stopped');
    }
  }

  private async setStreamRules(rules: TwitterStreamRule[]): Promise<void> {
    // Get existing rules
    const existingResponse = await this.fetchTwitterAPI('/2/tweets/search/stream/rules', {}, 'GET');
    const existingRules = existingResponse.data || [];

    // Delete all existing rules
    if (existingRules.length > 0) {
      await this.fetchTwitterAPI('/2/tweets/search/stream/rules', {
        delete: { ids: existingRules.map((r: any) => r.id) },
      }, 'POST');
    }

    // Add new rules
    if (rules.length > 0) {
      await this.fetchTwitterAPI('/2/tweets/search/stream/rules', {
        add: rules.map(r => ({ value: r.value, tag: r.tag })),
      }, 'POST');
    }
  }

  private async connectStream(): Promise<void> {
    this.streamConnection = new AbortController();

    try {
      const url = new URL('https://api.twitter.com/2/tweets/search/stream');
      url.searchParams.set('tweet.fields', 'author_id,created_at,entities,public_metrics,lang');
      url.searchParams.set('user.fields', 'id,name,username,verified,public_metrics');
      url.searchParams.set('expansions', 'author_id');

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${this.config.bearerToken}`,
        },
        signal: this.streamConnection.signal,
      });

      if (!response.ok) {
        throw new Error(`Stream connection failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      this.reconnectAttempts = 0;
      this.emit('stream_connected');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\r\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            try {
              const data = JSON.parse(line);
              if (data.data) {
                const tweet = this.mapTweet(data.data, data.includes?.users?.[0]);
                this.emit('tweet', tweet);
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }

    } catch (error: any) {
      if (error.name === 'AbortError') {
        return; // Intentional stop
      }

      this.emit('stream_error', error);

      // Attempt reconnection
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const backoff = this.baseBackoffMs * Math.pow(2, this.reconnectAttempts);
        this.emit('stream_reconnecting', { attempt: this.reconnectAttempts, backoffMs: backoff });

        await this.sleep(backoff);
        this.connectStream();
      } else {
        this.emit('stream_failed', { attempts: this.reconnectAttempts });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // USER LOOKUP
  // ---------------------------------------------------------------------------

  /**
   * Get user by username
   */
  async getUser(username: string): Promise<any> {
    await this.checkRateLimit('users');

    const response = await this.fetchTwitterAPI(`/2/users/by/username/${username}`, {
      'user.fields': 'id,name,username,verified,public_metrics,description,created_at',
    });

    return response.data;
  }

  /**
   * Get user's recent tweets
   */
  async getUserTweets(userId: string, maxResults: number = 100): Promise<Tweet[]> {
    await this.checkRateLimit('user_tweets');

    const response = await this.fetchTwitterAPI(`/2/users/${userId}/tweets`, {
      max_results: Math.min(maxResults, 100),
      'tweet.fields': 'author_id,created_at,entities,public_metrics,referenced_tweets,lang',
      'user.fields': 'id,name,username,verified,public_metrics',
      'expansions': 'author_id',
    });

    const tweets: Tweet[] = [];
    if (response.data) {
      const author = response.includes?.users?.[0];
      for (const tweet of response.data) {
        tweets.push(this.mapTweet(tweet, author));
      }
    }

    return tweets;
  }

  // ---------------------------------------------------------------------------
  // INFLUENCER TRACKING
  // ---------------------------------------------------------------------------

  /**
   * Get tweets from crypto influencers
   */
  async getInfluencerTweets(influencerUsernames: string[]): Promise<Tweet[]> {
    const allTweets: Tweet[] = [];

    // Batch users to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < influencerUsernames.length; i += batchSize) {
      const batch = influencerUsernames.slice(i, i + batchSize);

      const batchPromises = batch.map(async username => {
        try {
          const user = await this.getUser(username);
          if (user) {
            return this.getUserTweets(user.id, 10);
          }
          return [];
        } catch {
          return [];
        }
      });

      const batchResults = await Promise.all(batchPromises);
      allTweets.push(...batchResults.flat());

      // Rate limit pause between batches
      if (i + batchSize < influencerUsernames.length) {
        await this.sleep(1000);
      }
    }

    return allTweets;
  }

  // ---------------------------------------------------------------------------
  // FALLBACK PROVIDERS
  // ---------------------------------------------------------------------------

  private async searchFallback(params: TwitterSearchParams): Promise<Tweet[]> {
    if (!this.config.fallback) {
      throw new Error('No fallback provider configured');
    }

    const { provider, apiKey, baseUrl } = this.config.fallback;

    switch (provider) {
      case 'socialdata':
        return this.searchSocialData(params, apiKey, baseUrl);
      case 'tweetscout':
        return this.searchTweetScout(params, apiKey, baseUrl);
      case 'apify':
        return this.searchApify(params, apiKey, baseUrl);
      default:
        throw new Error(`Unknown fallback provider: ${provider}`);
    }
  }

  private async searchSocialData(
    params: TwitterSearchParams,
    apiKey: string,
    baseUrl: string
  ): Promise<Tweet[]> {
    const response = await fetch(`${baseUrl}/twitter/search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: params.query,
        limit: params.maxResults || 100,
        start_date: params.startTime?.toISOString(),
        end_date: params.endTime?.toISOString(),
      }),
    });

    if (!response.ok) {
      throw new Error(`SocialData API error: ${response.status}`);
    }

    const data = await response.json() as { tweets?: any[] };
    return (data.tweets || []).map((t: any) => this.mapFallbackTweet(t, 'socialdata'));
  }

  private async searchTweetScout(
    _params: TwitterSearchParams,
    apiKey: string,
    baseUrl: string
  ): Promise<Tweet[]> {
    const response = await fetch(`${baseUrl}/v1/search`, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`TweetScout API error: ${response.status}`);
    }

    const data = await response.json() as { results?: any[] };
    return (data.results || []).map((t: any) => this.mapFallbackTweet(t, 'tweetscout'));
  }

  private async searchApify(
    params: TwitterSearchParams,
    apiKey: string,
    baseUrl: string
  ): Promise<Tweet[]> {
    // Apify actor-based search
    const response = await fetch(`${baseUrl}/v2/acts/apify~twitter-scraper/runs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        searchTerms: [params.query],
        maxTweets: params.maxResults || 100,
        startUrls: [],
      }),
    });

    if (!response.ok) {
      throw new Error(`Apify API error: ${response.status}`);
    }

    await response.json(); // Would need to poll for results
    // Simplified placeholder - full implementation would poll for results
    return [];
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  private async fetchTwitterAPI(
    endpoint: string,
    params: Record<string, any>,
    method: 'GET' | 'POST' = 'GET'
  ): Promise<any> {
    const url = new URL(`https://api.twitter.com${endpoint}`);

    let body: string | undefined;
    if (method === 'GET') {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    } else {
      body = JSON.stringify(params);
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        'Authorization': `Bearer ${this.config.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body,
    });

    // Update rate limits from headers
    this.updateRateLimits(endpoint, response.headers);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Twitter API error: ${response.status} - ${JSON.stringify(error)}`);
    }

    return response.json();
  }

  private mapTweet(data: any, author?: any): Tweet {
    return {
      id: data.id,
      text: data.text,
      authorId: data.author_id,
      authorUsername: author?.username || '',
      authorName: author?.name || '',
      authorFollowers: author?.public_metrics?.followers_count || 0,
      authorVerified: author?.verified || false,
      createdAt: new Date(data.created_at),
      language: data.lang || 'en',
      metrics: {
        retweets: data.public_metrics?.retweet_count || 0,
        replies: data.public_metrics?.reply_count || 0,
        likes: data.public_metrics?.like_count || 0,
        quotes: data.public_metrics?.quote_count || 0,
        bookmarks: data.public_metrics?.bookmark_count || 0,
        impressions: data.public_metrics?.impression_count || 0,
      },
      entities: {
        hashtags: (data.entities?.hashtags || []).map((h: any) => h.tag),
        cashtags: (data.entities?.cashtags || []).map((c: any) => c.tag),
        mentions: (data.entities?.mentions || []).map((m: any) => m.username),
        urls: (data.entities?.urls || []).map((u: any) => u.expanded_url),
      },
      referencedTweets: data.referenced_tweets?.map((r: any) => ({
        type: r.type,
        id: r.id,
      })),
      conversationId: data.conversation_id,
      inReplyToUserId: data.in_reply_to_user_id,
      source: data.source,
    };
  }

  private mapFallbackTweet(data: any, _provider: string): Tweet {
    // Generic mapping for fallback providers
    return {
      id: data.id || data.tweet_id || crypto.randomBytes(8).toString('hex'),
      text: data.text || data.content || data.full_text || '',
      authorId: data.author_id || data.user_id || '',
      authorUsername: data.username || data.screen_name || data.author?.username || '',
      authorName: data.name || data.author?.name || '',
      authorFollowers: data.followers_count || data.author?.followers_count || 0,
      authorVerified: data.verified || data.author?.verified || false,
      createdAt: new Date(data.created_at || data.timestamp || Date.now()),
      language: data.lang || data.language || 'en',
      metrics: {
        retweets: data.retweet_count || data.retweets || 0,
        replies: data.reply_count || data.replies || 0,
        likes: data.favorite_count || data.likes || 0,
        quotes: data.quote_count || 0,
        bookmarks: 0,
        impressions: data.views || 0,
      },
      entities: {
        hashtags: data.hashtags || [],
        cashtags: data.cashtags || [],
        mentions: data.mentions || [],
        urls: data.urls || [],
      },
    };
  }

  private getAssetVariations(asset: string): string[] {
    const variations = [`$${asset}`, `#${asset}`, asset];

    // Add common variations
    const aliases: Record<string, string[]> = {
      'BTC': ['bitcoin', '#bitcoin', '$btc'],
      'ETH': ['ethereum', '#ethereum', '$eth', 'ether'],
      'SOL': ['solana', '#solana', '$sol'],
      'DOGE': ['dogecoin', '#dogecoin', '$doge'],
      'XRP': ['ripple', '#ripple', '$xrp'],
    };

    if (aliases[asset.toUpperCase()]) {
      variations.push(...aliases[asset.toUpperCase()]);
    }

    return variations;
  }

  private async checkRateLimit(endpoint: string): Promise<void> {
    const state = this.rateLimits.get(endpoint);
    if (state && state.remaining <= 1 && new Date() < state.resetAt) {
      const waitMs = state.resetAt.getTime() - Date.now();
      this.emit('rate_limited', { endpoint, waitMs });
      await this.sleep(waitMs);
    }
  }

  private updateRateLimits(endpoint: string, headers: Headers): void {
    const remaining = headers.get('x-rate-limit-remaining');
    const limit = headers.get('x-rate-limit-limit');
    const reset = headers.get('x-rate-limit-reset');

    if (remaining && limit && reset) {
      this.rateLimits.set(endpoint, {
        remaining: parseInt(remaining),
        limit: parseInt(limit),
        resetAt: new Date(parseInt(reset) * 1000),
      });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================================================
// CRYPTO INFLUENCERS DATABASE
// =============================================================================

export const CRYPTO_INFLUENCERS = [
  // Analysts & Traders
  'CryptoCred', 'CryptoCapo_', 'EmperorBTC', 'CryptoDonAlt', 'TheCryptoLark',
  'CryptoWendyO', 'AltcoinPsycho', 'CryptoGodJohn', 'CryptoYoda', 'IAmNomad',

  // Founders & Builders
  'VitalikButerin', 'cabortel', 'SBF_FTX', 'cabortel', 'aaborel',
  'el33th4xor', 'taaborelvp', 'rajgokal', 'aaborelrod', 'hosaborelskinson',

  // News & Media
  'Cointelegraph', 'CoinDesk', 'TheBlock__', 'WuBlockchain', 'crypto',
  'BitcoinMagazine', 'decrypt_co', 'DeFiPulse', 'MessariCrypto',

  // Institutions
  'Grayscale', 'MicroStrategy', 'ARaborelKInvest', 'GalaxyDigitalHQ',
];

// =============================================================================
// EXPORTS
// =============================================================================

export default TwitterClient;
