// =============================================================================
// Sentiment Aggregation Pipeline
// Connects data sources -> NLP engine -> database
// =============================================================================

import { EventEmitter } from 'events';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { Kafka, Producer, Consumer, EachMessagePayload } from 'kafkajs';

import { SentimentEngine, SentimentResult, TextInput } from '../nlp/sentimentEngine';
import { TwitterClient, Tweet } from '../datasources/twitter';
import { RedditClient, RedditPost, RedditComment } from '../datasources/reddit';
import { NewsClient, NewsArticle } from '../datasources/news';
import { OnChainClient } from '../datasources/onchain';

// Re-export the transaction type locally
interface OnChainTransaction {
  hash: string;
  chain: string;
  from: string;
  to: string;
  valueUsd: number;
  type: string;
  timestamp: number;
  blockNumber: number;
}

// =============================================================================
// Types
// =============================================================================

interface PipelineConfig {
  kafka: {
    brokers: string[];
    clientId: string;
    groupId: string;
  };
  postgres: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  processing: {
    batchSize: number;
    batchTimeout: number;
    maxRetries: number;
    retryDelay: number;
  };
}

interface RawDataItem {
  source: 'twitter' | 'reddit' | 'news' | 'onchain';
  id: string;
  text: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
  assets?: string[];
}

interface ProcessedSentiment {
  id: string;
  source: string;
  assetId: number;
  time: Date;
  sentimentScore: number;
  magnitude: number;
  confidenceScore: number;
  confidenceLower: number;
  confidenceUpper: number;
  emotions: Record<string, number>;
  entities: string[];
  rawText: string;
  metadata: Record<string, unknown>;
}

interface AggregatedSentiment {
  assetId: number;
  source: string;
  time: Date;
  sentimentScore: number;
  magnitude: number;
  confidenceScore: number;
  mentionCount: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  avgEmotions: Record<string, number>;
}

interface PipelineMetrics {
  itemsReceived: number;
  itemsProcessed: number;
  itemsFailed: number;
  processingTimeMs: number[];
  lastProcessedAt: Date | null;
}

// =============================================================================
// Kafka Topics
// =============================================================================

const TOPICS = {
  RAW_DATA: 'sentiment.raw.data',
  PROCESSED: 'sentiment.processed',
  AGGREGATED: 'sentiment.aggregated',
  ALERTS: 'sentiment.alerts',
  DLQ: 'sentiment.dlq',
} as const;

// =============================================================================
// Aggregation Pipeline
// =============================================================================

export class AggregationPipeline extends EventEmitter {
  private config: PipelineConfig;
  private sentimentEngine: SentimentEngine;
  private kafka: Kafka;
  private producer: Producer;
  private consumer: Consumer;
  private pool: Pool;
  private redis: Redis;

  // Data source clients
  private twitterClient: TwitterClient;
  private redditClient: RedditClient;
  private newsClient: NewsClient;
  private onchainClient: OnChainClient;

  // Processing state
  private isRunning: boolean = false;
  private processingBatch: RawDataItem[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private assetCache: Map<string, number> = new Map();

  // Metrics
  private metrics: PipelineMetrics = {
    itemsReceived: 0,
    itemsProcessed: 0,
    itemsFailed: 0,
    processingTimeMs: [],
    lastProcessedAt: null,
  };

  constructor(config: PipelineConfig) {
    super();
    this.config = config;

    // Initialize NLP engine
    this.sentimentEngine = new SentimentEngine({
      modelPath: process.env.NLP_MODEL_PATH,
      useCryptoLexicon: true,
      enableEmotionAnalysis: true,
      confidenceMethod: 'bca_bootstrap',
    });

    // Initialize Kafka
    this.kafka = new Kafka({
      clientId: config.kafka.clientId,
      brokers: config.kafka.brokers,
      retry: {
        initialRetryTime: 100,
        retries: 8,
      },
    });

    this.producer = this.kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30000,
    });

    this.consumer = this.kafka.consumer({
      groupId: config.kafka.groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
    });

    // Initialize PostgreSQL
    this.pool = new Pool({
      host: config.postgres.host,
      port: config.postgres.port,
      database: config.postgres.database,
      user: config.postgres.user,
      password: config.postgres.password,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    // Initialize Redis
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
      maxRetriesPerRequest: 3,
    });

    // Initialize data source clients
    this.twitterClient = new TwitterClient({
      bearerToken: process.env.TWITTER_BEARER_TOKEN || '',
    });

    this.redditClient = new RedditClient({
      clientId: process.env.REDDIT_CLIENT_ID || '',
      clientSecret: process.env.REDDIT_CLIENT_SECRET || '',
      userAgent: 'CryptoSentimentAPI/1.0',
    });

    this.newsClient = new NewsClient({
      newsApi: {
        apiKey: process.env.NEWS_API_KEY || '',
      },
    });

    this.onchainClient = new OnChainClient({
      etherscan: {
        apiKey: process.env.ETHERSCAN_API_KEY || '',
      },
    });
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Pipeline is already running');
    }

    console.log('[Pipeline] Starting aggregation pipeline...');

    try {
      // Connect to services
      await Promise.all([
        this.producer.connect(),
        this.consumer.connect(),
        this.loadAssetCache(),
      ]);

      // Subscribe to topics
      await this.consumer.subscribe({
        topics: [TOPICS.RAW_DATA],
        fromBeginning: false,
      });

      // Start consuming
      this.isRunning = true;
      await this.consumer.run({
        eachMessage: this.handleMessage.bind(this),
      });

      // Start data source collectors
      this.startDataCollectors();

      // Start aggregation timer
      this.startAggregationTimer();

      console.log('[Pipeline] Aggregation pipeline started');
      this.emit('started');
    } catch (error) {
      console.error('[Pipeline] Failed to start:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('[Pipeline] Stopping aggregation pipeline...');
    this.isRunning = false;

    // Stop batch timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Process remaining batch
    if (this.processingBatch.length > 0) {
      await this.processBatch();
    }

    // Disconnect from services
    await Promise.all([
      this.producer.disconnect(),
      this.consumer.disconnect(),
      this.pool.end(),
      this.redis.quit(),
    ]);

    console.log('[Pipeline] Aggregation pipeline stopped');
    this.emit('stopped');
  }

  // ===========================================================================
  // Data Collection
  // ===========================================================================

  private startDataCollectors(): void {
    // Twitter collector
    this.twitterClient.on('tweet', (tweet: Tweet) => {
      this.ingestData({
        source: 'twitter',
        id: tweet.id,
        text: tweet.text,
        timestamp: new Date(tweet.createdAt),
        metadata: {
          author_id: tweet.authorId,
          metrics: tweet.metrics,
        },
        assets: this.extractAssets(tweet.text),
      });
    });

    // Reddit collector
    this.redditClient.on('post', (post: RedditPost) => {
      this.ingestData({
        source: 'reddit',
        id: post.id,
        text: `${post.title} ${post.selftext || ''}`,
        timestamp: new Date(post.createdAt),
        metadata: {
          subreddit: post.subreddit,
          score: post.score,
          upvote_ratio: post.upvoteRatio,
          num_comments: post.numComments,
        },
        assets: this.extractAssets(`${post.title} ${post.selftext || ''}`),
      });
    });

    this.redditClient.on('comment', (comment: RedditComment) => {
      this.ingestData({
        source: 'reddit',
        id: comment.id,
        text: comment.body,
        timestamp: new Date(comment.createdAt),
        metadata: {
          subreddit: comment.subreddit,
          score: comment.score,
          parent_id: comment.parentId,
        },
        assets: this.extractAssets(comment.body),
      });
    });

    // News collector
    this.newsClient.on('article', (article: NewsArticle) => {
      this.ingestData({
        source: 'news',
        id: article.id,
        text: `${article.title} ${article.description || ''}`,
        timestamp: new Date(article.publishedAt),
        metadata: {
          source: article.source,
          url: article.url,
          sentiment: article.sentiment,
          categories: article.categories,
        },
        assets: article.assets || this.extractAssets(`${article.title} ${article.description || ''}`),
      });
    });

    // On-chain collector
    this.onchainClient.on('transaction', (tx: OnChainTransaction) => {
      // On-chain data is handled differently - no text sentiment
      this.processOnchainTransaction(tx);
    });

    // Start collecting (these methods may not exist yet, so we wrap them safely)
    try {
      this.twitterClient.startStream?.([
        { value: 'crypto', tag: 'crypto' },
        { value: 'bitcoin', tag: 'bitcoin' },
        { value: 'ethereum', tag: 'ethereum' },
      ]);
    } catch (e) {
      console.error('[Pipeline] Failed to start Twitter stream:', e);
    }
    try {
      (this.newsClient as any).startPolling?.();
    } catch (e) {
      console.error('[Pipeline] Failed to start News polling:', e);
    }
    try {
      this.onchainClient.startWhaleMonitoring?.();
    } catch (e) {
      console.error('[Pipeline] Failed to start on-chain monitoring:', e);
    }
  }

  private async ingestData(item: RawDataItem): Promise<void> {
    this.metrics.itemsReceived++;

    // Send to Kafka for processing
    try {
      await this.producer.send({
        topic: TOPICS.RAW_DATA,
        messages: [
          {
            key: item.id,
            value: JSON.stringify(item),
            timestamp: item.timestamp.getTime().toString(),
          },
        ],
      });
    } catch (error) {
      console.error('[Pipeline] Failed to send to Kafka:', error);
      this.metrics.itemsFailed++;
    }
  }

  // ===========================================================================
  // Message Processing
  // ===========================================================================

  private async handleMessage({ message }: EachMessagePayload): Promise<void> {
    if (!message.value) {
      return;
    }

    try {
      const item: RawDataItem = JSON.parse(message.value.toString());
      this.processingBatch.push(item);

      // Process batch if size threshold reached
      if (this.processingBatch.length >= this.config.processing.batchSize) {
        await this.processBatch();
      } else if (!this.batchTimer) {
        // Set timer for batch processing
        this.batchTimer = setTimeout(
          () => this.processBatch(),
          this.config.processing.batchTimeout
        );
      }
    } catch (error) {
      console.error('[Pipeline] Failed to parse message:', error);
      await this.sendToDeadLetterQueue(message.value.toString(), error);
    }
  }

  private async processBatch(): Promise<void> {
    if (this.processingBatch.length === 0) {
      return;
    }

    // Clear timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    const batch = [...this.processingBatch];
    this.processingBatch = [];

    const startTime = Date.now();

    try {
      // Process all items in parallel
      const results = await Promise.allSettled(
        batch.map(item => this.processItem(item))
      );

      // Count successes and failures
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'fulfilled') {
          successCount++;
        } else {
          failCount++;
          await this.sendToDeadLetterQueue(JSON.stringify(batch[i]), result.reason);
        }
      }

      this.metrics.itemsProcessed += successCount;
      this.metrics.itemsFailed += failCount;

      const processingTime = Date.now() - startTime;
      this.metrics.processingTimeMs.push(processingTime);
      if (this.metrics.processingTimeMs.length > 100) {
        this.metrics.processingTimeMs.shift();
      }

      this.metrics.lastProcessedAt = new Date();

      console.log(
        `[Pipeline] Processed batch: ${successCount} success, ${failCount} failed, ${processingTime}ms`
      );
    } catch (error) {
      console.error('[Pipeline] Batch processing failed:', error);
    }
  }

  private async processItem(item: RawDataItem): Promise<void> {
    // Skip items without assets
    if (!item.assets || item.assets.length === 0) {
      return;
    }

    // Analyze sentiment
    const input: TextInput = {
      id: item.id,
      text: item.text,
      source: item.source,
      timestamp: item.timestamp,
      metadata: item.metadata as any,
    };

    const result: SentimentResult = await this.sentimentEngine.analyze(input);

    // Store processed sentiment for each asset
    for (const assetSymbol of item.assets) {
      const assetId = await this.getOrCreateAsset(assetSymbol);

      const emotions = result.sentiment.emotions;
      const processed: ProcessedSentiment = {
        id: item.id,
        source: item.source,
        assetId,
        time: item.timestamp,
        sentimentScore: result.sentiment.raw,
        magnitude: result.sentiment.normalized,
        confidenceScore: result.sentiment.confidence,
        confidenceLower: result.sentiment.confidence * 0.9,
        confidenceUpper: result.sentiment.confidence * 1.1,
        emotions: {
          fear: emotions.fear,
          greed: emotions.greed,
          uncertainty: emotions.uncertainty,
          optimism: emotions.optimism,
          anger: emotions.anger,
          excitement: emotions.excitement,
        },
        entities: result.entities.map(e => e.text),
        rawText: item.text.substring(0, 1000), // Truncate for storage
        metadata: item.metadata,
      };

      await this.storeSentiment(processed);

      // Check for alerts
      await this.checkAlerts(processed, assetSymbol);
    }
  }

  // ===========================================================================
  // Database Operations
  // ===========================================================================

  private async loadAssetCache(): Promise<void> {
    const result = await this.pool.query<{ id: number; symbol: string }>(
      'SELECT id, symbol FROM assets'
    );

    for (const row of result.rows) {
      this.assetCache.set(row.symbol.toUpperCase(), row.id);
    }

    console.log(`[Pipeline] Loaded ${this.assetCache.size} assets into cache`);
  }

  private async getOrCreateAsset(symbol: string): Promise<number> {
    const upperSymbol = symbol.toUpperCase();

    // Check cache
    const cached = this.assetCache.get(upperSymbol);
    if (cached) {
      return cached;
    }

    // Insert or get from database
    const result = await this.pool.query<{ id: number }>(
      `INSERT INTO assets (symbol, name, asset_type)
       VALUES ($1, $1, 'cryptocurrency')
       ON CONFLICT (symbol) DO UPDATE SET symbol = EXCLUDED.symbol
       RETURNING id`,
      [upperSymbol]
    );

    const id = result.rows[0].id;
    this.assetCache.set(upperSymbol, id);
    return id;
  }

  private async storeSentiment(processed: ProcessedSentiment): Promise<void> {
    await this.pool.query(
      `INSERT INTO sentiment_raw (
        time, asset_id, source, sentiment_score, magnitude,
        confidence_score, confidence_lower, confidence_upper,
        emotion_fear, emotion_greed, emotion_uncertainty,
        emotion_optimism, emotion_anger, emotion_excitement,
        entities, raw_text, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
      )`,
      [
        processed.time,
        processed.assetId,
        processed.source,
        processed.sentimentScore,
        processed.magnitude,
        processed.confidenceScore,
        processed.confidenceLower,
        processed.confidenceUpper,
        processed.emotions.fear || 0,
        processed.emotions.greed || 0,
        processed.emotions.uncertainty || 0,
        processed.emotions.optimism || 0,
        processed.emotions.anger || 0,
        processed.emotions.excitement || 0,
        processed.entities,
        processed.rawText,
        JSON.stringify(processed.metadata),
      ]
    );

    // Update real-time cache
    await this.updateRealtimeCache(processed);
  }

  private async updateRealtimeCache(processed: ProcessedSentiment): Promise<void> {
    const key = `sentiment:realtime:${processed.assetId}`;

    // Use Redis sorted set for time-series data
    await this.redis.zadd(
      key,
      processed.time.getTime(),
      JSON.stringify({
        score: processed.sentimentScore,
        confidence: processed.confidenceScore,
        source: processed.source,
      })
    );

    // Trim to last hour
    const oneHourAgo = Date.now() - 3600000;
    await this.redis.zremrangebyscore(key, '-inf', oneHourAgo);

    // Set expiry
    await this.redis.expire(key, 7200); // 2 hours
  }

  // ===========================================================================
  // Aggregation
  // ===========================================================================

  private startAggregationTimer(): void {
    // Run aggregation every minute
    setInterval(() => this.runAggregation(), 60000);
  }

  private async runAggregation(): Promise<void> {
    try {
      // Aggregate last minute's data
      const now = new Date();
      const oneMinuteAgo = new Date(now.getTime() - 60000);

      const result = await this.pool.query<{
        asset_id: number;
        source: string;
        avg_score: number;
        avg_magnitude: number;
        avg_confidence: number;
        mention_count: number;
        positive_count: number;
        negative_count: number;
        neutral_count: number;
        avg_fear: number;
        avg_greed: number;
        avg_uncertainty: number;
        avg_optimism: number;
      }>(
        `SELECT
          asset_id,
          source,
          AVG(sentiment_score) as avg_score,
          AVG(magnitude) as avg_magnitude,
          AVG(confidence_score) as avg_confidence,
          COUNT(*) as mention_count,
          COUNT(*) FILTER (WHERE sentiment_score > 0.2) as positive_count,
          COUNT(*) FILTER (WHERE sentiment_score < -0.2) as negative_count,
          COUNT(*) FILTER (WHERE sentiment_score BETWEEN -0.2 AND 0.2) as neutral_count,
          AVG(emotion_fear) as avg_fear,
          AVG(emotion_greed) as avg_greed,
          AVG(emotion_uncertainty) as avg_uncertainty,
          AVG(emotion_optimism) as avg_optimism
        FROM sentiment_raw
        WHERE time >= $1 AND time < $2
        GROUP BY asset_id, source`,
        [oneMinuteAgo, now]
      );

      // Store aggregated data
      for (const row of result.rows) {
        const aggregated: AggregatedSentiment = {
          assetId: row.asset_id,
          source: row.source,
          time: oneMinuteAgo,
          sentimentScore: row.avg_score,
          magnitude: row.avg_magnitude,
          confidenceScore: row.avg_confidence,
          mentionCount: Number(row.mention_count),
          positiveCount: Number(row.positive_count),
          negativeCount: Number(row.negative_count),
          neutralCount: Number(row.neutral_count),
          avgEmotions: {
            fear: row.avg_fear,
            greed: row.avg_greed,
            uncertainty: row.avg_uncertainty,
            optimism: row.avg_optimism,
          },
        };

        await this.storeAggregated(aggregated);

        // Publish to Kafka
        await this.producer.send({
          topic: TOPICS.AGGREGATED,
          messages: [
            {
              key: `${row.asset_id}:${row.source}`,
              value: JSON.stringify(aggregated),
              timestamp: now.getTime().toString(),
            },
          ],
        });
      }

      console.log(`[Pipeline] Aggregated ${result.rows.length} asset-source combinations`);
    } catch (error) {
      console.error('[Pipeline] Aggregation failed:', error);
    }
  }

  private async storeAggregated(aggregated: AggregatedSentiment): Promise<void> {
    await this.pool.query(
      `INSERT INTO sentiment_aggregated_1m (
        time, asset_id, source, sentiment_score, magnitude,
        confidence_score, mention_count, positive_count,
        negative_count, neutral_count,
        avg_emotion_fear, avg_emotion_greed,
        avg_emotion_uncertainty, avg_emotion_optimism
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
      )
      ON CONFLICT (time, asset_id, source) DO UPDATE SET
        sentiment_score = EXCLUDED.sentiment_score,
        magnitude = EXCLUDED.magnitude,
        confidence_score = EXCLUDED.confidence_score,
        mention_count = EXCLUDED.mention_count,
        positive_count = EXCLUDED.positive_count,
        negative_count = EXCLUDED.negative_count,
        neutral_count = EXCLUDED.neutral_count`,
      [
        aggregated.time,
        aggregated.assetId,
        aggregated.source,
        aggregated.sentimentScore,
        aggregated.magnitude,
        aggregated.confidenceScore,
        aggregated.mentionCount,
        aggregated.positiveCount,
        aggregated.negativeCount,
        aggregated.neutralCount,
        aggregated.avgEmotions.fear,
        aggregated.avgEmotions.greed,
        aggregated.avgEmotions.uncertainty,
        aggregated.avgEmotions.optimism,
      ]
    );
  }

  // ===========================================================================
  // Alerts
  // ===========================================================================

  private async checkAlerts(
    processed: ProcessedSentiment,
    assetSymbol: string
  ): Promise<void> {
    // Get recent sentiment for comparison
    const key = `sentiment:realtime:${processed.assetId}`;
    const recentData = await this.redis.zrange(key, -100, -1);

    if (recentData.length < 10) {
      return; // Not enough data for meaningful alerts
    }

    const scores = recentData.map(d => JSON.parse(d).score as number);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const stdDev = Math.sqrt(
      scores.reduce((sum, s) => sum + Math.pow(s - avgScore, 2), 0) / scores.length
    );

    // Alert if current score is > 2 standard deviations from mean
    const zScore = Math.abs(processed.sentimentScore - avgScore) / stdDev;

    if (zScore > 2) {
      const alert = {
        type: 'sentiment_anomaly',
        asset: assetSymbol,
        assetId: processed.assetId,
        currentScore: processed.sentimentScore,
        avgScore,
        zScore,
        direction: processed.sentimentScore > avgScore ? 'positive' : 'negative',
        timestamp: new Date(),
        source: processed.source,
      };

      await this.producer.send({
        topic: TOPICS.ALERTS,
        messages: [
          {
            key: assetSymbol,
            value: JSON.stringify(alert),
          },
        ],
      });

      this.emit('alert', alert);
      console.log(`[Pipeline] Alert: ${assetSymbol} sentiment anomaly (z=${zScore.toFixed(2)})`);
    }
  }

  // ===========================================================================
  // On-chain Processing
  // ===========================================================================

  private async processOnchainTransaction(tx: OnChainTransaction): Promise<void> {
    // Determine asset from contract address or chain
    const assetSymbol = this.getAssetFromChain(tx.chain);
    const assetId = await this.getOrCreateAsset(assetSymbol);

    // Calculate sentiment based on transaction characteristics
    let sentimentScore = 0;
    let sentimentType = 'neutral';

    if (tx.type === 'whale_accumulation') {
      sentimentScore = 0.3;
      sentimentType = 'bullish';
    } else if (tx.type === 'whale_distribution') {
      sentimentScore = -0.3;
      sentimentType = 'bearish';
    } else if (tx.type === 'exchange_inflow') {
      sentimentScore = -0.2; // Selling pressure
      sentimentType = 'bearish';
    } else if (tx.type === 'exchange_outflow') {
      sentimentScore = 0.2; // Accumulation
      sentimentType = 'bullish';
    }

    // Store in onchain_flows table
    await this.pool.query(
      `INSERT INTO onchain_flows (
        time, asset_id, chain, transaction_type, from_address,
        to_address, value_usd, sentiment_impact, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        new Date(tx.timestamp),
        assetId,
        tx.chain,
        tx.type,
        tx.from,
        tx.to,
        tx.valueUsd,
        sentimentScore,
        JSON.stringify({
          txHash: tx.hash,
          blockNumber: tx.blockNumber,
          sentimentType,
        }),
      ]
    );

    // Emit for real-time subscribers
    this.emit('onchain', {
      asset: assetSymbol,
      type: tx.type,
      valueUsd: tx.valueUsd,
      sentimentImpact: sentimentScore,
    });
  }

  private getAssetFromChain(chain: string): string {
    const chainAssets: Record<string, string> = {
      ethereum: 'ETH',
      bsc: 'BNB',
      polygon: 'MATIC',
      arbitrum: 'ETH',
      optimism: 'ETH',
      avalanche: 'AVAX',
      solana: 'SOL',
    };
    return chainAssets[chain.toLowerCase()] || 'ETH';
  }

  // ===========================================================================
  // Utilities
  // ===========================================================================

  private extractAssets(text: string): string[] {
    const assets: Set<string> = new Set();

    // Common crypto symbols and names
    const patterns = [
      /\$([A-Z]{2,10})\b/g, // $BTC, $ETH
      /\b(BTC|ETH|SOL|BNB|XRP|ADA|DOGE|DOT|MATIC|AVAX|LINK|UNI|ATOM)\b/gi,
      /\b(Bitcoin|Ethereum|Solana|Binance|Ripple|Cardano|Dogecoin|Polkadot|Polygon|Avalanche|Chainlink|Uniswap|Cosmos)\b/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const symbol = match[1].toUpperCase();
        // Map common names to symbols
        const nameToSymbol: Record<string, string> = {
          BITCOIN: 'BTC',
          ETHEREUM: 'ETH',
          SOLANA: 'SOL',
          BINANCE: 'BNB',
          RIPPLE: 'XRP',
          CARDANO: 'ADA',
          DOGECOIN: 'DOGE',
          POLKADOT: 'DOT',
          POLYGON: 'MATIC',
          AVALANCHE: 'AVAX',
          CHAINLINK: 'LINK',
          UNISWAP: 'UNI',
          COSMOS: 'ATOM',
        };
        assets.add(nameToSymbol[symbol] || symbol);
      }
    }

    return Array.from(assets);
  }

  private async sendToDeadLetterQueue(
    message: string,
    error: unknown
  ): Promise<void> {
    try {
      await this.producer.send({
        topic: TOPICS.DLQ,
        messages: [
          {
            value: JSON.stringify({
              originalMessage: message,
              error: error instanceof Error ? error.message : String(error),
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      });
    } catch (dlqError) {
      console.error('[Pipeline] Failed to send to DLQ:', dlqError);
    }
  }

  // ===========================================================================
  // Metrics & Health
  // ===========================================================================

  getMetrics(): PipelineMetrics & { avgProcessingTimeMs: number } {
    const avgProcessingTimeMs =
      this.metrics.processingTimeMs.length > 0
        ? this.metrics.processingTimeMs.reduce((a, b) => a + b, 0) /
          this.metrics.processingTimeMs.length
        : 0;

    return {
      ...this.metrics,
      avgProcessingTimeMs,
    };
  }

  async healthCheck(): Promise<{
    healthy: boolean;
    components: Record<string, boolean>;
  }> {
    const components: Record<string, boolean> = {};

    // Check Kafka
    try {
      const admin = this.kafka.admin();
      await admin.connect();
      await admin.listTopics();
      await admin.disconnect();
      components.kafka = true;
    } catch {
      components.kafka = false;
    }

    // Check PostgreSQL
    try {
      await this.pool.query('SELECT 1');
      components.postgres = true;
    } catch {
      components.postgres = false;
    }

    // Check Redis
    try {
      await this.redis.ping();
      components.redis = true;
    } catch {
      components.redis = false;
    }

    // Check NLP engine
    components.nlp = this.sentimentEngine.isReady();

    const healthy = Object.values(components).every(v => v);

    return { healthy, components };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createPipeline(): AggregationPipeline {
  return new AggregationPipeline({
    kafka: {
      brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
      clientId: 'sentiment-pipeline',
      groupId: 'sentiment-processors',
    },
    postgres: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'sentiment',
      user: process.env.DB_USER || 'sentiment',
      password: process.env.DB_PASSWORD || '',
    },
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
    },
    processing: {
      batchSize: parseInt(process.env.PIPELINE_BATCH_SIZE || '100'),
      batchTimeout: parseInt(process.env.PIPELINE_BATCH_TIMEOUT || '5000'),
      maxRetries: 3,
      retryDelay: 1000,
    },
  });
}
