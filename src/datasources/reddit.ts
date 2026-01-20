/**
 * Reddit Data Source Client
 * Institutional-Grade Cryptocurrency Market Sentiment Analysis
 *
 * Supports:
 * - Official Reddit API
 * - Subreddit monitoring
 * - Post and comment analysis
 * - Trending detection
 */

import { EventEmitter } from 'events';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

export interface RedditConfig {
  clientId: string;
  clientSecret: string;
  userAgent: string;
  username?: string;
  password?: string;
  refreshToken?: string;
}

export interface RedditPost {
  id: string;
  subreddit: string;
  title: string;
  selftext: string;
  author: string;
  authorKarma?: number;
  createdAt: Date;
  score: number;
  upvoteRatio: number;
  numComments: number;
  permalink: string;
  url: string;
  flair?: string;
  isStickied: boolean;
  isSelf: boolean;
  awards: number;
}

export interface RedditComment {
  id: string;
  postId: string;
  subreddit: string;
  body: string;
  author: string;
  createdAt: Date;
  score: number;
  isSubmitter: boolean;
  parentId: string;
  depth: number;
  awards: number;
}

export interface SubredditInfo {
  name: string;
  subscribers: number;
  activeUsers: number;
  description: string;
  createdAt: Date;
  isNsfw: boolean;
}

export interface RedditSearchParams {
  query: string;
  subreddits?: string[];
  sort?: 'relevance' | 'hot' | 'top' | 'new' | 'comments';
  time?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
  limit?: number;
  after?: string;
}

// =============================================================================
// REDDIT CLIENT
// =============================================================================

export class RedditClient extends EventEmitter {
  private config: RedditConfig;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private baseUrl = 'https://oauth.reddit.com';

  constructor(config: RedditConfig) {
    super();
    this.config = config;
  }

  // ---------------------------------------------------------------------------
  // AUTHENTICATION
  // ---------------------------------------------------------------------------

  private async ensureAuthenticated(): Promise<void> {
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return;
    }

    const credentials = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString('base64');

    let body: string;
    if (this.config.username && this.config.password) {
      body = `grant_type=password&username=${encodeURIComponent(this.config.username)}&password=${encodeURIComponent(this.config.password)}`;
    } else if (this.config.refreshToken) {
      body = `grant_type=refresh_token&refresh_token=${this.config.refreshToken}`;
    } else {
      body = 'grant_type=client_credentials';
    }

    const response = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.config.userAgent,
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`Reddit auth failed: ${response.status}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiry = new Date(Date.now() + (data.expires_in - 60) * 1000);

    this.emit('authenticated');
  }

  // ---------------------------------------------------------------------------
  // POSTS
  // ---------------------------------------------------------------------------

  /**
   * Get posts from a subreddit
   */
  async getSubredditPosts(
    subreddit: string,
    options?: {
      sort?: 'hot' | 'new' | 'top' | 'rising';
      time?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
      limit?: number;
      after?: string;
    }
  ): Promise<{ posts: RedditPost[]; after: string | null }> {
    await this.ensureAuthenticated();

    const sort = options?.sort || 'hot';
    const params = new URLSearchParams({
      limit: String(options?.limit || 100),
      raw_json: '1',
    });

    if (options?.time && (sort === 'top')) {
      params.set('t', options.time);
    }
    if (options?.after) {
      params.set('after', options.after);
    }

    const response = await this.fetchReddit(`/r/${subreddit}/${sort}?${params}`);
    const posts = response.data.children.map((child: any) => this.mapPost(child.data));

    return {
      posts,
      after: response.data.after,
    };
  }

  /**
   * Get posts from multiple crypto subreddits
   */
  async getCryptoPosts(options?: {
    sort?: 'hot' | 'new' | 'top' | 'rising';
    limit?: number;
  }): Promise<RedditPost[]> {
    const subreddits = CRYPTO_SUBREDDITS.slice(0, 10); // Top 10
    const allPosts: RedditPost[] = [];

    for (const subreddit of subreddits) {
      try {
        const { posts } = await this.getSubredditPosts(subreddit, {
          sort: options?.sort || 'hot',
          limit: Math.ceil((options?.limit || 100) / subreddits.length),
        });
        allPosts.push(...posts);
      } catch (error) {
        this.emit('error', { subreddit, error });
      }

      // Rate limiting
      await this.sleep(100);
    }

    // Sort by score
    return allPosts.sort((a, b) => b.score - a.score);
  }

  /**
   * Search posts
   */
  async searchPosts(params: RedditSearchParams): Promise<RedditPost[]> {
    await this.ensureAuthenticated();

    const searchParams = new URLSearchParams({
      q: params.query,
      sort: params.sort || 'relevance',
      t: params.time || 'week',
      limit: String(params.limit || 100),
      type: 'link',
      raw_json: '1',
    });

    if (params.subreddits && params.subreddits.length > 0) {
      searchParams.set('restrict_sr', 'true');
    }
    if (params.after) {
      searchParams.set('after', params.after);
    }

    const endpoint = params.subreddits && params.subreddits.length === 1
      ? `/r/${params.subreddits[0]}/search?${searchParams}`
      : `/search?${searchParams}`;

    const response = await this.fetchReddit(endpoint);
    return response.data.children.map((child: any) => this.mapPost(child.data));
  }

  /**
   * Search for crypto-related posts
   */
  async searchCryptoPosts(
    assets: string[],
    options?: {
      time?: 'hour' | 'day' | 'week' | 'month';
      limit?: number;
    }
  ): Promise<RedditPost[]> {
    const query = assets.map(asset => {
      const variations = [asset, `$${asset}`];
      if (ASSET_FULL_NAMES[asset]) {
        variations.push(ASSET_FULL_NAMES[asset]);
      }
      return `(${variations.join(' OR ')})`;
    }).join(' OR ');

    return this.searchPosts({
      query,
      subreddits: CRYPTO_SUBREDDITS.slice(0, 5),
      sort: 'relevance',
      time: options?.time || 'week',
      limit: options?.limit || 100,
    });
  }

  // ---------------------------------------------------------------------------
  // COMMENTS
  // ---------------------------------------------------------------------------

  /**
   * Get comments for a post
   */
  async getPostComments(
    postId: string,
    subreddit: string,
    options?: {
      sort?: 'best' | 'top' | 'new' | 'controversial' | 'old' | 'qa';
      limit?: number;
      depth?: number;
    }
  ): Promise<RedditComment[]> {
    await this.ensureAuthenticated();

    const params = new URLSearchParams({
      sort: options?.sort || 'best',
      limit: String(options?.limit || 200),
      depth: String(options?.depth || 5),
      raw_json: '1',
    });

    const response = await this.fetchReddit(
      `/r/${subreddit}/comments/${postId}?${params}`
    );

    const comments: RedditComment[] = [];
    this.flattenComments(response[1].data.children, postId, subreddit, comments);

    return comments;
  }

  private flattenComments(
    children: any[],
    postId: string,
    subreddit: string,
    result: RedditComment[],
    depth: number = 0
  ): void {
    for (const child of children) {
      if (child.kind === 't1') {
        result.push(this.mapComment(child.data, postId, subreddit, depth));

        if (child.data.replies?.data?.children) {
          this.flattenComments(
            child.data.replies.data.children,
            postId,
            subreddit,
            result,
            depth + 1
          );
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // SUBREDDIT INFO
  // ---------------------------------------------------------------------------

  /**
   * Get subreddit information
   */
  async getSubredditInfo(subreddit: string): Promise<SubredditInfo> {
    await this.ensureAuthenticated();

    const response = await this.fetchReddit(`/r/${subreddit}/about`);
    const data = response.data;

    return {
      name: data.display_name,
      subscribers: data.subscribers,
      activeUsers: data.accounts_active || 0,
      description: data.public_description || data.description || '',
      createdAt: new Date(data.created_utc * 1000),
      isNsfw: data.over18,
    };
  }

  /**
   * Get trending subreddits
   */
  async getTrendingSubreddits(): Promise<string[]> {
    await this.ensureAuthenticated();

    try {
      const response = await this.fetchReddit('/subreddits/popular?limit=100');
      return response.data.children
        .map((child: any) => child.data.display_name)
        .filter((name: string) =>
          CRYPTO_SUBREDDITS.includes(name.toLowerCase()) ||
          name.toLowerCase().includes('crypto') ||
          name.toLowerCase().includes('bitcoin') ||
          name.toLowerCase().includes('ethereum')
        );
    } catch {
      return CRYPTO_SUBREDDITS.slice(0, 10);
    }
  }

  // ---------------------------------------------------------------------------
  // SENTIMENT SIGNALS
  // ---------------------------------------------------------------------------

  /**
   * Get sentiment signals from Reddit activity
   */
  async getSentimentSignals(asset: string): Promise<{
    mentionCount: number;
    averageScore: number;
    sentimentRatio: number;
    trendingScore: number;
    topPosts: RedditPost[];
  }> {
    const posts = await this.searchCryptoPosts([asset], {
      time: 'day',
      limit: 100,
    });

    const mentionCount = posts.length;
    const averageScore = posts.reduce((sum, p) => sum + p.score, 0) / (posts.length || 1);
    const upvoteRatios = posts.map(p => p.upvoteRatio);
    const sentimentRatio = upvoteRatios.reduce((sum, r) => sum + r, 0) / (upvoteRatios.length || 1);

    // Trending score based on recent activity
    const recentPosts = posts.filter(p =>
      Date.now() - p.createdAt.getTime() < 6 * 60 * 60 * 1000 // Last 6 hours
    );
    const trendingScore = recentPosts.length / Math.max(1, posts.length - recentPosts.length);

    return {
      mentionCount,
      averageScore,
      sentimentRatio,
      trendingScore,
      topPosts: posts.slice(0, 5),
    };
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  private async fetchReddit(endpoint: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'User-Agent': this.config.userAgent,
      },
    });

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('retry-after') || '60');
      this.emit('rate_limited', { retryAfter });
      await this.sleep(retryAfter * 1000);
      return this.fetchReddit(endpoint);
    }

    if (!response.ok) {
      throw new Error(`Reddit API error: ${response.status}`);
    }

    return response.json();
  }

  private mapPost(data: any): RedditPost {
    return {
      id: data.id,
      subreddit: data.subreddit,
      title: data.title,
      selftext: data.selftext || '',
      author: data.author,
      createdAt: new Date(data.created_utc * 1000),
      score: data.score,
      upvoteRatio: data.upvote_ratio,
      numComments: data.num_comments,
      permalink: `https://reddit.com${data.permalink}`,
      url: data.url,
      flair: data.link_flair_text,
      isStickied: data.stickied,
      isSelf: data.is_self,
      awards: data.total_awards_received || 0,
    };
  }

  private mapComment(data: any, postId: string, subreddit: string, depth: number): RedditComment {
    return {
      id: data.id,
      postId,
      subreddit,
      body: data.body,
      author: data.author,
      createdAt: new Date(data.created_utc * 1000),
      score: data.score,
      isSubmitter: data.is_submitter,
      parentId: data.parent_id,
      depth,
      awards: data.total_awards_received || 0,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================================================
// CRYPTO SUBREDDITS
// =============================================================================

export const CRYPTO_SUBREDDITS = [
  'cryptocurrency',
  'bitcoin',
  'ethereum',
  'cryptomarkets',
  'altcoin',
  'defi',
  'ethtrader',
  'btc',
  'binance',
  'solana',
  'cardano',
  'dogecoin',
  'shibarmy',
  'cryptomoonshots',
  'satoshistreetbets',
  'wallstreetbetscrypto',
  'nft',
  'opensea',
  'avalanche',
  'cosmosnetwork',
  'polkadot',
  'algorand',
  'chainlink',
  'fantom',
  'arbitrum',
];

const ASSET_FULL_NAMES: Record<string, string> = {
  'BTC': 'bitcoin',
  'ETH': 'ethereum',
  'SOL': 'solana',
  'ADA': 'cardano',
  'DOGE': 'dogecoin',
  'DOT': 'polkadot',
  'AVAX': 'avalanche',
  'LINK': 'chainlink',
  'MATIC': 'polygon',
  'ATOM': 'cosmos',
  'ALGO': 'algorand',
  'FTM': 'fantom',
  'ARB': 'arbitrum',
  'OP': 'optimism',
};

// =============================================================================
// EXPORTS
// =============================================================================

export default RedditClient;
