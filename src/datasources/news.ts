/**
 * News Data Source Client
 * Institutional-Grade Cryptocurrency Market Sentiment Analysis
 *
 * Aggregates from:
 * - CryptoPanic (crypto-specific)
 * - NewsAPI (general news)
 * - CoinDesk, Cointelegraph RSS
 * - Custom RSS feeds
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

export interface NewsConfig {
  cryptoPanic?: {
    apiKey: string;
  };
  newsApi?: {
    apiKey: string;
  };
  rssFeeds?: string[];
  pollingIntervalMs?: number;
}

export interface NewsArticle {
  id: string;
  title: string;
  description: string;
  content?: string;
  url: string;
  source: NewsSource;
  author?: string;
  publishedAt: Date;
  imageUrl?: string;
  categories: string[];
  assets: string[];
  sentiment?: NewsSentiment;
  importance: 'high' | 'medium' | 'low';
  metadata: Record<string, any>;
}

export interface NewsSource {
  id: string;
  name: string;
  domain: string;
  reliability: number; // 0-1 score
  type: 'mainstream' | 'crypto_native' | 'blog' | 'aggregator';
}

export interface NewsSentiment {
  score: number; // -1 to 1
  label: 'bearish' | 'neutral' | 'bullish';
  votes?: {
    positive: number;
    negative: number;
    neutral: number;
  };
}

export interface NewsSearchParams {
  query?: string;
  assets?: string[];
  sources?: string[];
  categories?: string[];
  startDate?: Date;
  endDate?: Date;
  importance?: 'high' | 'medium' | 'low';
  limit?: number;
  offset?: number;
}

// =============================================================================
// NEWS AGGREGATOR CLIENT
// =============================================================================

export class NewsClient extends EventEmitter {
  private config: NewsConfig;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private lastPollTime: Map<string, Date> = new Map();

  constructor(config: NewsConfig) {
    super();
    this.config = {
      pollingIntervalMs: 60000, // 1 minute default
      ...config,
    };
  }

  // ---------------------------------------------------------------------------
  // AGGREGATED SEARCH
  // ---------------------------------------------------------------------------

  /**
   * Search news from all configured sources
   */
  async search(params: NewsSearchParams): Promise<NewsArticle[]> {
    const results: NewsArticle[] = [];

    // Fetch from all sources in parallel
    const promises: Promise<NewsArticle[]>[] = [];

    if (this.config.cryptoPanic) {
      promises.push(this.searchCryptoPanic(params).catch(() => []));
    }

    if (this.config.newsApi) {
      promises.push(this.searchNewsApi(params).catch(() => []));
    }

    if (this.config.rssFeeds && this.config.rssFeeds.length > 0) {
      promises.push(this.searchRssFeeds(params).catch(() => []));
    }

    const allResults = await Promise.all(promises);
    results.push(...allResults.flat());

    // Deduplicate by URL
    const seen = new Set<string>();
    const deduplicated = results.filter(article => {
      if (seen.has(article.url)) return false;
      seen.add(article.url);
      return true;
    });

    // Sort by date
    deduplicated.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

    // Apply limit
    const limited = deduplicated.slice(0, params.limit || 100);

    this.emit('search_complete', { count: limited.length, params });
    return limited;
  }

  /**
   * Get latest crypto news
   */
  async getLatestCryptoNews(options?: {
    assets?: string[];
    limit?: number;
    importance?: 'high' | 'medium' | 'low';
  }): Promise<NewsArticle[]> {
    return this.search({
      assets: options?.assets,
      limit: options?.limit || 50,
      importance: options?.importance,
      startDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
    });
  }

  /**
   * Get breaking news (high importance, last hour)
   */
  async getBreakingNews(): Promise<NewsArticle[]> {
    return this.search({
      importance: 'high',
      startDate: new Date(Date.now() - 60 * 60 * 1000), // Last hour
      limit: 20,
    });
  }

  // ---------------------------------------------------------------------------
  // CRYPTOPANIC
  // ---------------------------------------------------------------------------

  private async searchCryptoPanic(params: NewsSearchParams): Promise<NewsArticle[]> {
    if (!this.config.cryptoPanic?.apiKey) {
      return [];
    }

    const url = new URL('https://cryptopanic.com/api/v1/posts/');
    url.searchParams.set('auth_token', this.config.cryptoPanic.apiKey);
    url.searchParams.set('public', 'true');

    if (params.assets && params.assets.length > 0) {
      url.searchParams.set('currencies', params.assets.join(','));
    }

    if (params.importance === 'high') {
      url.searchParams.set('filter', 'important');
    } else if (params.importance === 'medium') {
      url.searchParams.set('filter', 'rising');
    }

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`CryptoPanic API error: ${response.status}`);
    }

    const data = await response.json() as { results?: any[] };
    return (data.results || []).map((item: any) => this.mapCryptoPanicArticle(item));
  }

  private mapCryptoPanicArticle(item: any): NewsArticle {
    const sentiment = this.mapCryptoPanicSentiment(item.votes);

    return {
      id: `cp_${item.id}`,
      title: item.title,
      description: item.title, // CryptoPanic doesn't always have description
      url: item.url,
      source: {
        id: item.source?.domain || 'cryptopanic',
        name: item.source?.title || 'CryptoPanic',
        domain: item.source?.domain || 'cryptopanic.com',
        reliability: this.getSourceReliability(item.source?.domain),
        type: 'crypto_native',
      },
      publishedAt: new Date(item.published_at),
      categories: item.kind ? [item.kind] : [],
      assets: (item.currencies || []).map((c: any) => c.code),
      sentiment,
      importance: this.mapCryptoPanicImportance(item),
      metadata: {
        cryptoPanicId: item.id,
        votes: item.votes,
        domain: item.domain,
      },
    };
  }

  private mapCryptoPanicSentiment(votes: any): NewsSentiment | undefined {
    if (!votes) return undefined;

    const positive = votes.positive || 0;
    const negative = votes.negative || 0;
    const total = positive + negative;

    if (total === 0) return undefined;

    const score = (positive - negative) / total;
    return {
      score,
      label: score > 0.2 ? 'bullish' : score < -0.2 ? 'bearish' : 'neutral',
      votes: {
        positive,
        negative,
        neutral: votes.neutral || 0,
      },
    };
  }

  private mapCryptoPanicImportance(item: any): 'high' | 'medium' | 'low' {
    if (item.kind === 'news' && item.votes?.important > 5) return 'high';
    if (item.votes?.positive > 10 || item.votes?.negative > 10) return 'medium';
    return 'low';
  }

  // ---------------------------------------------------------------------------
  // NEWSAPI
  // ---------------------------------------------------------------------------

  private async searchNewsApi(params: NewsSearchParams): Promise<NewsArticle[]> {
    if (!this.config.newsApi?.apiKey) {
      return [];
    }

    const url = new URL('https://newsapi.org/v2/everything');
    url.searchParams.set('apiKey', this.config.newsApi.apiKey);
    url.searchParams.set('language', 'en');
    url.searchParams.set('sortBy', 'publishedAt');
    url.searchParams.set('pageSize', String(Math.min(params.limit || 50, 100)));

    // Build query
    let query = params.query || '';
    if (params.assets && params.assets.length > 0) {
      const assetQuery = params.assets.map(a => {
        const fullName = ASSET_NAMES[a];
        return fullName ? `("${a}" OR "${fullName}")` : `"${a}"`;
      }).join(' OR ');
      query = query ? `(${query}) AND (${assetQuery})` : assetQuery;
    }

    if (!query) {
      query = 'cryptocurrency OR bitcoin OR ethereum OR crypto';
    }

    url.searchParams.set('q', query);

    if (params.startDate) {
      url.searchParams.set('from', params.startDate.toISOString().split('T')[0]);
    }
    if (params.endDate) {
      url.searchParams.set('to', params.endDate.toISOString().split('T')[0]);
    }

    // Crypto-focused domains
    const cryptoDomains = [
      'coindesk.com', 'cointelegraph.com', 'decrypt.co', 'theblock.co',
      'bitcoinmagazine.com', 'cryptoslate.com', 'cryptonews.com',
      'bloomberg.com', 'reuters.com', 'forbes.com', 'cnbc.com',
    ];
    url.searchParams.set('domains', cryptoDomains.join(','));

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`NewsAPI error: ${response.status}`);
    }

    const data = await response.json() as { articles?: any[] };
    return (data.articles || []).map((item: any) => this.mapNewsApiArticle(item, params.assets));
  }

  private mapNewsApiArticle(item: any, requestedAssets?: string[]): NewsArticle {
    const domain = new URL(item.url).hostname.replace('www.', '');

    return {
      id: `na_${crypto.createHash('md5').update(item.url).digest('hex').substring(0, 12)}`,
      title: item.title,
      description: item.description || '',
      content: item.content,
      url: item.url,
      source: {
        id: domain,
        name: item.source?.name || domain,
        domain,
        reliability: this.getSourceReliability(domain),
        type: this.getSourceType(domain),
      },
      author: item.author,
      publishedAt: new Date(item.publishedAt),
      imageUrl: item.urlToImage,
      categories: this.extractCategories(item.title + ' ' + (item.description || '')),
      assets: requestedAssets || this.extractAssets(item.title + ' ' + (item.description || '')),
      importance: this.calculateImportance(item),
      metadata: {
        newsApiSource: item.source,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // RSS FEEDS
  // ---------------------------------------------------------------------------

  private async searchRssFeeds(params: NewsSearchParams): Promise<NewsArticle[]> {
    const feeds = this.config.rssFeeds || DEFAULT_RSS_FEEDS;
    const articles: NewsArticle[] = [];

    for (const feedUrl of feeds) {
      try {
        const feedArticles = await this.fetchRssFeed(feedUrl, params);
        articles.push(...feedArticles);
      } catch (error) {
        this.emit('feed_error', { feedUrl, error });
      }
    }

    return articles;
  }

  private async fetchRssFeed(feedUrl: string, params: NewsSearchParams): Promise<NewsArticle[]> {
    // Use a simple fetch - in production would use a proper RSS parser
    const response = await fetch(feedUrl);
    if (!response.ok) {
      throw new Error(`RSS feed error: ${response.status}`);
    }

    const text = await response.text();
    return this.parseRssFeed(text, feedUrl, params);
  }

  private parseRssFeed(xml: string, feedUrl: string, params: NewsSearchParams): NewsArticle[] {
    const articles: NewsArticle[] = [];

    // Simple XML parsing - in production use proper parser like xml2js
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1];

      const title = this.extractXmlTag(itemXml, 'title');
      const link = this.extractXmlTag(itemXml, 'link');
      const description = this.extractXmlTag(itemXml, 'description');
      const pubDate = this.extractXmlTag(itemXml, 'pubDate');

      if (!title || !link) continue;

      const publishedAt = pubDate ? new Date(pubDate) : new Date();

      // Apply date filters
      if (params.startDate && publishedAt < params.startDate) continue;
      if (params.endDate && publishedAt > params.endDate) continue;

      // Apply asset filter
      const extractedAssets = this.extractAssets(title + ' ' + (description || ''));
      if (params.assets && params.assets.length > 0) {
        const hasMatchingAsset = params.assets.some(a =>
          extractedAssets.includes(a) ||
          title.toLowerCase().includes(a.toLowerCase())
        );
        if (!hasMatchingAsset) continue;
      }

      const domain = new URL(feedUrl).hostname.replace('www.', '');

      articles.push({
        id: `rss_${crypto.createHash('md5').update(link).digest('hex').substring(0, 12)}`,
        title: this.decodeHtmlEntities(title),
        description: this.decodeHtmlEntities(description || ''),
        url: link,
        source: {
          id: domain,
          name: domain,
          domain,
          reliability: this.getSourceReliability(domain),
          type: this.getSourceType(domain),
        },
        publishedAt,
        categories: this.extractCategories(title + ' ' + (description || '')),
        assets: extractedAssets,
        importance: 'medium',
        metadata: {
          feedUrl,
        },
      });
    }

    return articles;
  }

  private extractXmlTag(xml: string, tag: string): string | null {
    const regex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
    const match = regex.exec(xml);
    return match ? (match[1] || match[2] || '').trim() : null;
  }

  private decodeHtmlEntities(text: string): string {
    const entities: Record<string, string> = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&nbsp;': ' ',
    };

    return text.replace(/&[^;]+;/g, match => entities[match] || match);
  }

  // ---------------------------------------------------------------------------
  // POLLING
  // ---------------------------------------------------------------------------

  /**
   * Start polling for new articles
   */
  startPolling(assets?: string[]): void {
    if (this.pollingTimer) {
      this.stopPolling();
    }

    const poll = async () => {
      try {
        const articles = await this.search({
          assets,
          startDate: this.lastPollTime.get('default') || new Date(Date.now() - 5 * 60 * 1000),
          limit: 50,
        });

        if (articles.length > 0) {
          this.emit('new_articles', articles);
        }

        this.lastPollTime.set('default', new Date());
      } catch (error) {
        this.emit('polling_error', error);
      }
    };

    // Initial poll
    poll();

    // Set interval
    this.pollingTimer = setInterval(poll, this.config.pollingIntervalMs);
    this.emit('polling_started');
  }

  /**
   * Stop polling
   */
  stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
      this.emit('polling_stopped');
    }
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  private getSourceReliability(domain?: string): number {
    if (!domain) return 0.5;

    const reliabilityScores: Record<string, number> = {
      'bloomberg.com': 0.95,
      'reuters.com': 0.95,
      'wsj.com': 0.9,
      'ft.com': 0.9,
      'coindesk.com': 0.85,
      'theblock.co': 0.85,
      'cointelegraph.com': 0.8,
      'decrypt.co': 0.8,
      'bitcoinmagazine.com': 0.75,
      'cryptoslate.com': 0.7,
      'cryptonews.com': 0.65,
      'ambcrypto.com': 0.6,
      'u.today': 0.55,
    };

    return reliabilityScores[domain.toLowerCase()] || 0.5;
  }

  private getSourceType(domain: string): NewsSource['type'] {
    const mainstream = ['bloomberg.com', 'reuters.com', 'wsj.com', 'ft.com', 'cnbc.com', 'forbes.com'];
    const cryptoNative = ['coindesk.com', 'cointelegraph.com', 'theblock.co', 'decrypt.co', 'bitcoinmagazine.com'];
    const aggregator = ['cryptopanic.com', 'cryptoslate.com'];

    if (mainstream.includes(domain.toLowerCase())) return 'mainstream';
    if (cryptoNative.includes(domain.toLowerCase())) return 'crypto_native';
    if (aggregator.includes(domain.toLowerCase())) return 'aggregator';
    return 'blog';
  }

  private extractAssets(text: string): string[] {
    const assets: string[] = [];
    const lowerText = text.toLowerCase();

    for (const [symbol, name] of Object.entries(ASSET_NAMES)) {
      if (
        lowerText.includes(symbol.toLowerCase()) ||
        lowerText.includes(name.toLowerCase()) ||
        text.includes(`$${symbol}`)
      ) {
        assets.push(symbol);
      }
    }

    return [...new Set(assets)];
  }

  private extractCategories(text: string): string[] {
    const categories: string[] = [];
    const lowerText = text.toLowerCase();

    const categoryPatterns: Record<string, RegExp> = {
      'regulation': /regul|sec|cftc|law|legal|compliance|ban|restrict/i,
      'defi': /defi|yield|farming|liquidity|amm|swap|lending/i,
      'nft': /nft|collectible|opensea|blur|art/i,
      'exchange': /exchange|binance|coinbase|kraken|listing|delist/i,
      'price': /price|surge|crash|rally|drop|pump|dump/i,
      'technology': /upgrade|fork|update|launch|mainnet|testnet/i,
      'security': /hack|exploit|vulnerability|breach|theft|stolen/i,
      'adoption': /adopt|partner|integration|accept|payment/i,
      'macro': /fed|inflation|interest|economy|recession|gdp/i,
      'institutional': /institution|grayscale|blackrock|fidelity|etf/i,
    };

    for (const [category, pattern] of Object.entries(categoryPatterns)) {
      if (pattern.test(lowerText)) {
        categories.push(category);
      }
    }

    return categories;
  }

  private calculateImportance(item: any): 'high' | 'medium' | 'low' {
    const title = (item.title || '').toLowerCase();

    // High importance keywords
    const highImportance = [
      'breaking', 'urgent', 'sec', 'fed', 'regulation', 'hack', 'exploit',
      'crash', 'surge', 'billion', 'etf approv', 'blackrock', 'ban',
    ];

    if (highImportance.some(kw => title.includes(kw))) {
      return 'high';
    }

    // Source-based importance
    const highImportanceSources = ['bloomberg.com', 'reuters.com', 'wsj.com'];
    if (item.source?.name && highImportanceSources.some(s =>
      item.source.name.toLowerCase().includes(s.split('.')[0])
    )) {
      return 'medium';
    }

    return 'low';
  }
}

// =============================================================================
// CONSTANTS
// =============================================================================

const ASSET_NAMES: Record<string, string> = {
  'BTC': 'bitcoin',
  'ETH': 'ethereum',
  'SOL': 'solana',
  'BNB': 'binance',
  'XRP': 'ripple',
  'ADA': 'cardano',
  'DOGE': 'dogecoin',
  'DOT': 'polkadot',
  'AVAX': 'avalanche',
  'LINK': 'chainlink',
  'MATIC': 'polygon',
  'UNI': 'uniswap',
  'ATOM': 'cosmos',
  'LTC': 'litecoin',
  'ARB': 'arbitrum',
  'OP': 'optimism',
};

const DEFAULT_RSS_FEEDS = [
  'https://cointelegraph.com/rss',
  'https://www.coindesk.com/arc/outboundfeeds/rss/',
  'https://decrypt.co/feed',
  'https://bitcoinmagazine.com/.rss/full/',
  'https://thedefiant.io/feed',
];

// =============================================================================
// EXPORTS
// =============================================================================

export default NewsClient;
