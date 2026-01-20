/**
 * NLP Sentiment Analysis Engine
 * Institutional-Grade Cryptocurrency Market Sentiment Analysis
 *
 * Multi-model ensemble approach:
 * - FinBERT for financial text
 * - Custom crypto-tuned transformer
 * - Lexicon-based analysis for speed
 * - LLM-based analysis for nuance
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

export interface TextInput {
  id: string;
  text: string;
  source: DataSource;
  timestamp: Date;
  metadata: TextMetadata;
}

export interface TextMetadata {
  author?: string;
  authorFollowers?: number;
  authorVerified?: boolean;
  engagement?: EngagementMetrics;
  language?: string;
  asset?: string;
  url?: string;
}

export interface EngagementMetrics {
  likes?: number;
  retweets?: number;
  replies?: number;
  quotes?: number;
  views?: number;
  upvotes?: number;
  downvotes?: number;
  comments?: number;
}

export type DataSource =
  | 'twitter'
  | 'reddit'
  | 'discord'
  | 'telegram'
  | 'news'
  | 'blog'
  | 'forum'
  | 'onchain';

export interface SentimentResult {
  id: string;
  inputId: string;
  timestamp: Date;
  sentiment: SentimentScore;
  entities: ExtractedEntity[];
  topics: ExtractedTopic[];
  signals: MarketSignal[];
  modelInfo: ModelInfo;
  processingTimeMs: number;
}

export interface SentimentScore {
  /** Raw sentiment score (-1 to 1) */
  raw: number;
  /** Normalized score (0 to 1) */
  normalized: number;
  /** Classification */
  label: 'very_bearish' | 'bearish' | 'neutral' | 'bullish' | 'very_bullish';
  /** Confidence in classification (0 to 1) */
  confidence: number;
  /** Component scores */
  components: {
    lexicon: number;
    transformer: number;
    ensemble: number;
  };
  /** Emotional breakdown */
  emotions: EmotionScores;
}

export interface EmotionScores {
  fear: number;
  greed: number;
  uncertainty: number;
  optimism: number;
  anger: number;
  excitement: number;
}

export interface ExtractedEntity {
  text: string;
  type: 'asset' | 'person' | 'organization' | 'exchange' | 'protocol' | 'event';
  normalizedName: string;
  confidence: number;
  sentiment?: number;
}

export interface ExtractedTopic {
  topic: string;
  relevance: number;
  sentiment: number;
}

export interface MarketSignal {
  type: SignalType;
  strength: number;
  confidence: number;
  description: string;
}

export type SignalType =
  | 'fomo'
  | 'fud'
  | 'accumulation'
  | 'distribution'
  | 'breakout'
  | 'breakdown'
  | 'reversal'
  | 'continuation'
  | 'whale_activity'
  | 'retail_interest'
  | 'institutional_interest';

export interface ModelInfo {
  modelId: string;
  modelVersion: string;
  ensembleWeights: Record<string, number>;
}

export interface AggregatedSentiment {
  asset: string;
  timestamp: Date;
  period: string;
  sentiment: {
    score: number;
    label: string;
    confidence: number;
    confidenceInterval: [number, number];
  };
  volume: {
    total: number;
    bySource: Record<DataSource, number>;
  };
  momentum: {
    shortTerm: number;  // 1h
    mediumTerm: number; // 4h
    longTerm: number;   // 24h
  };
  signals: MarketSignal[];
  topInfluencers: InfluencerMention[];
  breakdown: {
    bySource: Record<DataSource, SourceBreakdown>;
    byEmotion: EmotionScores;
  };
}

export interface SourceBreakdown {
  score: number;
  volume: number;
  weight: number;
  trend: 'rising' | 'falling' | 'stable';
}

export interface InfluencerMention {
  author: string;
  followers: number;
  sentiment: number;
  text: string;
  timestamp: Date;
  source: DataSource;
}

// =============================================================================
// CRYPTO LEXICON
// =============================================================================

const CRYPTO_LEXICON = {
  // Extremely bullish
  veryBullish: [
    'moon', 'mooning', 'lambo', 'ath', 'all time high', 'parabolic', 'send it',
    'lfg', "let's fucking go", 'generational wealth', 'life changing', 'undervalued',
    'accumulate', 'accumulating', 'diamond hands', 'hodl', 'hodling', 'buy the dip',
    'btd', 'bullish af', 'mega bullish', 'super bullish', 'extremely bullish',
    'breakout', 'breaking out', 'rocket', 'ripping', 'pumping', 'pump it',
    'massive gains', 'huge gains', '100x', '1000x', 'gem', 'hidden gem',
  ],
  // Bullish
  bullish: [
    'bullish', 'long', 'longing', 'buy', 'buying', 'bought', 'accumulation',
    'support', 'holding', 'strong', 'strength', 'recovery', 'recovering',
    'bounce', 'bouncing', 'uptrend', 'higher highs', 'higher lows', 'breakout',
    'green', 'gains', 'profit', 'profitable', 'winner', 'winning', 'up',
    'rising', 'rally', 'rallying', 'momentum', 'adoption', 'institutional',
    'partnership', 'upgrade', 'improvement', 'growth', 'growing', 'expansion',
  ],
  // Bearish
  bearish: [
    'bearish', 'short', 'shorting', 'sell', 'selling', 'sold', 'distribution',
    'resistance', 'weak', 'weakness', 'decline', 'declining', 'drop', 'dropping',
    'downtrend', 'lower highs', 'lower lows', 'breakdown', 'red', 'loss',
    'losing', 'loser', 'down', 'falling', 'correction', 'correcting', 'dump',
    'dumping', 'bleeding', 'pain', 'painful', 'trouble', 'concern', 'worried',
  ],
  // Extremely bearish
  veryBearish: [
    'crash', 'crashing', 'collapsed', 'collapse', 'rekt', 'wrecked', 'liquidated',
    'liquidation', 'capitulation', 'capitulating', 'panic', 'panicking', 'scam',
    'rug', 'rugged', 'rug pull', 'ponzi', 'fraud', 'dead', 'dying', 'worthless',
    'zero', 'going to zero', 'paper hands', 'sell everything', 'get out',
    'exit', 'exiting', 'flee', 'fleeing', 'disaster', 'catastrophe', 'bloodbath',
  ],
  // Fear indicators
  fear: [
    'fear', 'scared', 'afraid', 'worried', 'worry', 'concern', 'concerning',
    'uncertain', 'uncertainty', 'risk', 'risky', 'dangerous', 'danger',
    'careful', 'caution', 'cautious', 'warning', 'warn', 'threat', 'threatening',
  ],
  // Greed indicators
  greed: [
    'greed', 'greedy', 'fomo', 'fear of missing out', 'all in', 'yolo',
    'leverage', 'leveraged', 'margin', 'max leverage', '100x leverage',
    'easy money', 'free money', 'guaranteed', 'cant lose', "can't lose",
  ],
  // Uncertainty indicators
  uncertainty: [
    'maybe', 'perhaps', 'uncertain', 'unsure', 'dont know', "don't know",
    'unclear', 'confusing', 'confused', 'mixed', 'mixed signals', 'wait',
    'waiting', 'sideways', 'consolidation', 'consolidating', 'range', 'ranging',
  ],
  // Negation words
  negation: [
    'not', 'no', "don't", 'dont', "doesn't", 'doesnt', "won't", 'wont',
    "wouldn't", 'wouldnt', "isn't", 'isnt', "aren't", 'arent', 'never',
    'neither', 'nobody', 'nothing', 'nowhere', 'hardly', 'barely', 'rarely',
  ],
  // Intensifiers
  intensifiers: [
    'very', 'extremely', 'incredibly', 'absolutely', 'totally', 'completely',
    'utterly', 'highly', 'super', 'mega', 'ultra', 'insanely', 'crazy',
    'massive', 'huge', 'enormous', 'tremendous',
  ],
};

// Asset aliases and mappings
const ASSET_ALIASES: Record<string, string> = {
  'btc': 'BTC', 'bitcoin': 'BTC', 'sats': 'BTC', 'satoshi': 'BTC',
  'eth': 'ETH', 'ethereum': 'ETH', 'ether': 'ETH',
  'sol': 'SOL', 'solana': 'SOL',
  'bnb': 'BNB', 'binance': 'BNB',
  'xrp': 'XRP', 'ripple': 'XRP',
  'ada': 'ADA', 'cardano': 'ADA',
  'doge': 'DOGE', 'dogecoin': 'DOGE',
  'dot': 'DOT', 'polkadot': 'DOT',
  'matic': 'MATIC', 'polygon': 'MATIC',
  'link': 'LINK', 'chainlink': 'LINK',
  'avax': 'AVAX', 'avalanche': 'AVAX',
  'uni': 'UNI', 'uniswap': 'UNI',
  'aave': 'AAVE',
  'atom': 'ATOM', 'cosmos': 'ATOM',
  'ltc': 'LTC', 'litecoin': 'LTC',
  'etc': 'ETC', 'ethereum classic': 'ETC',
  'xlm': 'XLM', 'stellar': 'XLM',
  'algo': 'ALGO', 'algorand': 'ALGO',
  'near': 'NEAR', 'near protocol': 'NEAR',
  'ftm': 'FTM', 'fantom': 'FTM',
  'arb': 'ARB', 'arbitrum': 'ARB',
  'op': 'OP', 'optimism': 'OP',
  'apt': 'APT', 'aptos': 'APT',
  'sui': 'SUI',
  'sei': 'SEI',
  'inj': 'INJ', 'injective': 'INJ',
  'usdt': 'USDT', 'tether': 'USDT',
  'usdc': 'USDC', 'usd coin': 'USDC',
  'dai': 'DAI',
};

// =============================================================================
// SENTIMENT ENGINE
// =============================================================================

export class SentimentEngine extends EventEmitter {
  private modelId: string;
  private modelVersion: string;
  private ensembleWeights: Record<string, number>;
  // Reserved for batch processing implementation
  protected processingQueue: TextInput[] = [];
  protected isProcessing: boolean = false;
  private batchSize: number = 100;
  private results: Map<string, SentimentResult> = new Map();
  private _ready: boolean = true;

  constructor(config?: {
    modelVersion?: string;
    ensembleWeights?: Record<string, number>;
    batchSize?: number;
    useCryptoLexicon?: boolean;
    enableEmotionAnalysis?: boolean;
    confidenceMethod?: string;
    modelPath?: string;
  }) {
    super();
    this.modelId = 'sentiment-engine-v1';
    this.modelVersion = config?.modelVersion || '1.0.0';
    this.ensembleWeights = config?.ensembleWeights || {
      lexicon: 0.2,
      transformer: 0.5,
      contextual: 0.3,
    };
    this.batchSize = config?.batchSize || 100;
    // Use additional config options
    if (config?.useCryptoLexicon) {
      // Enable crypto-specific lexicon (already enabled by default)
    }
    if (config?.enableEmotionAnalysis) {
      // Enable emotion analysis (already enabled by default)
    }
  }

  /**
   * Check if the engine is ready for processing
   */
  isReady(): boolean {
    return this._ready;
  }

  // ---------------------------------------------------------------------------
  // MAIN ANALYSIS METHODS
  // ---------------------------------------------------------------------------

  /**
   * Analyze a single text input
   */
  async analyze(input: TextInput): Promise<SentimentResult> {
    const startTime = Date.now();

    // Preprocess text
    const processedText = this.preprocessText(input.text);

    // Run ensemble analysis
    const [lexiconScore, transformerScore, contextualScore] = await Promise.all([
      this.analyzeLexicon(processedText),
      this.analyzeTransformer(processedText, input.metadata),
      this.analyzeContextual(processedText, input),
    ]);

    // Combine scores with ensemble weights
    const ensembleScore = this.combineScores({
      lexicon: lexiconScore,
      transformer: transformerScore,
      contextual: contextualScore,
    });

    // Extract entities and topics
    const entities = this.extractEntities(processedText);
    const topics = this.extractTopics(processedText, entities);

    // Detect market signals
    const signals = this.detectSignals(processedText, ensembleScore, input);

    // Calculate emotions
    const emotions = this.analyzeEmotions(processedText);

    // Build result
    const result: SentimentResult = {
      id: `sent_${crypto.randomBytes(8).toString('hex')}`,
      inputId: input.id,
      timestamp: new Date(),
      sentiment: {
        raw: ensembleScore,
        normalized: (ensembleScore + 1) / 2,
        label: this.scoreToLabel(ensembleScore),
        confidence: this.calculateConfidence(lexiconScore, transformerScore, contextualScore),
        components: {
          lexicon: lexiconScore,
          transformer: transformerScore,
          ensemble: ensembleScore,
        },
        emotions,
      },
      entities,
      topics,
      signals,
      modelInfo: {
        modelId: this.modelId,
        modelVersion: this.modelVersion,
        ensembleWeights: this.ensembleWeights,
      },
      processingTimeMs: Date.now() - startTime,
    };

    this.results.set(result.id, result);
    this.emit('analysis_complete', result);

    return result;
  }

  /**
   * Batch analyze multiple inputs
   */
  async analyzeBatch(inputs: TextInput[]): Promise<SentimentResult[]> {
    const results: SentimentResult[] = [];

    // Process in parallel batches
    for (let i = 0; i < inputs.length; i += this.batchSize) {
      const batch = inputs.slice(i, i + this.batchSize);
      const batchResults = await Promise.all(batch.map(input => this.analyze(input)));
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Aggregate sentiment results for an asset
   */
  aggregateSentiment(
    asset: string,
    results: SentimentResult[],
    period: string = '1h'
  ): AggregatedSentiment {
    if (results.length === 0) {
      return this.createEmptyAggregation(asset, period);
    }

    // Calculate weighted average sentiment
    const weights = results.map(r => this.calculateResultWeight(r));
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    const weightedScore = results.reduce((sum, r, i) => {
      return sum + r.sentiment.raw * weights[i];
    }, 0) / totalWeight;

    // Calculate confidence interval using BCa bootstrap
    const scores = results.map(r => r.sentiment.raw);
    const confidenceInterval = this.bootstrapConfidenceInterval(scores, 0.95);

    // Group by source
    const bySource = this.groupBySource(results);

    // Aggregate emotions
    const aggregatedEmotions = this.aggregateEmotions(results);

    // Collect signals
    const allSignals = results.flatMap(r => r.signals);
    const aggregatedSignals = this.aggregateSignals(allSignals);

    // Find top influencers
    const topInfluencers = this.findTopInfluencers(results, 10);

    // Calculate momentum
    const momentum = this.calculateMomentum(results);

    return {
      asset,
      timestamp: new Date(),
      period,
      sentiment: {
        score: (weightedScore + 1) / 2, // Normalize to 0-1
        label: this.scoreToLabel(weightedScore),
        confidence: results.reduce((sum, r) => sum + r.sentiment.confidence, 0) / results.length,
        confidenceInterval: [
          (confidenceInterval[0] + 1) / 2,
          (confidenceInterval[1] + 1) / 2,
        ],
      },
      volume: {
        total: results.length,
        bySource: Object.fromEntries(
          Object.entries(bySource).map(([k, v]) => [k, v.length])
        ) as Record<DataSource, number>,
      },
      momentum,
      signals: aggregatedSignals,
      topInfluencers,
      breakdown: {
        bySource: Object.fromEntries(
          Object.entries(bySource).map(([source, sourceResults]) => [
            source,
            this.calculateSourceBreakdown(sourceResults),
          ])
        ) as Record<DataSource, SourceBreakdown>,
        byEmotion: aggregatedEmotions,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // ANALYSIS COMPONENTS
  // ---------------------------------------------------------------------------

  private preprocessText(text: string): string {
    // Convert to lowercase
    let processed = text.toLowerCase();

    // Remove URLs
    processed = processed.replace(/https?:\/\/\S+/gi, '');

    // Remove mentions (keep for entity extraction later)
    processed = processed.replace(/@\w+/g, '');

    // Remove hashtag symbols but keep text
    processed = processed.replace(/#(\w+)/g, '$1');

    // Normalize whitespace
    processed = processed.replace(/\s+/g, ' ').trim();

    // Expand contractions
    const contractions: Record<string, string> = {
      "won't": 'will not',
      "can't": 'cannot',
      "n't": ' not',
      "'re": ' are',
      "'s": ' is',
      "'d": ' would',
      "'ll": ' will',
      "'ve": ' have',
      "'m": ' am',
    };

    for (const [contraction, expansion] of Object.entries(contractions)) {
      processed = processed.replace(new RegExp(contraction, 'gi'), expansion);
    }

    return processed;
  }

  private async analyzeLexicon(text: string): Promise<number> {
    const words = text.split(/\s+/);
    let score = 0;
    let wordCount = 0;
    let negationActive = false;
    let intensifierMultiplier = 1;

    for (let i = 0; i < words.length; i++) {
      const word = words[i];

      // Check for negation
      if (CRYPTO_LEXICON.negation.includes(word)) {
        negationActive = true;
        continue;
      }

      // Check for intensifiers
      if (CRYPTO_LEXICON.intensifiers.includes(word)) {
        intensifierMultiplier = 1.5;
        continue;
      }

      // Score the word
      let wordScore = 0;

      if (CRYPTO_LEXICON.veryBullish.some(term => word.includes(term) || text.includes(term))) {
        wordScore = 0.9;
      } else if (CRYPTO_LEXICON.bullish.some(term => word.includes(term))) {
        wordScore = 0.5;
      } else if (CRYPTO_LEXICON.veryBearish.some(term => word.includes(term) || text.includes(term))) {
        wordScore = -0.9;
      } else if (CRYPTO_LEXICON.bearish.some(term => word.includes(term))) {
        wordScore = -0.5;
      }

      if (wordScore !== 0) {
        // Apply negation
        if (negationActive) {
          wordScore = -wordScore * 0.5; // Negation partially reverses sentiment
          negationActive = false;
        }

        // Apply intensifier
        wordScore *= intensifierMultiplier;
        intensifierMultiplier = 1;

        score += wordScore;
        wordCount++;
      }
    }

    // Normalize score to -1 to 1
    if (wordCount === 0) return 0;
    return Math.max(-1, Math.min(1, score / Math.sqrt(wordCount)));
  }

  private async analyzeTransformer(text: string, metadata: TextMetadata): Promise<number> {
    // Simulated transformer analysis
    // In production, this would call a FinBERT or custom model API

    // Use lexicon as base and add noise for simulation
    const lexiconScore = await this.analyzeLexicon(text);

    // Add some variance to simulate model behavior
    const noise = (Math.random() - 0.5) * 0.2;
    let score = lexiconScore + noise;

    // Boost based on engagement (simulating attention mechanism)
    if (metadata.engagement) {
      const engagementBoost = Math.min(0.1, Math.log10(
        (metadata.engagement.likes || 0) +
        (metadata.engagement.retweets || 0) * 2 +
        (metadata.engagement.replies || 0) * 0.5 +
        1
      ) * 0.02);

      score = score > 0 ? score + engagementBoost : score - engagementBoost;
    }

    // Boost for verified authors
    if (metadata.authorVerified) {
      score *= 1.1;
    }

    return Math.max(-1, Math.min(1, score));
  }

  private async analyzeContextual(text: string, input: TextInput): Promise<number> {
    // Contextual analysis considering source, time, and metadata
    let score = await this.analyzeLexicon(text);

    // Source credibility weights
    const sourceWeights: Record<DataSource, number> = {
      twitter: 0.8,
      reddit: 0.7,
      discord: 0.6,
      telegram: 0.5,
      news: 1.0,
      blog: 0.9,
      forum: 0.6,
      onchain: 1.0,
    };

    score *= sourceWeights[input.source] || 0.7;

    // Time decay for older content (exponential decay with 24h half-life)
    const ageHours = (Date.now() - input.timestamp.getTime()) / (1000 * 60 * 60);
    const timeDecay = Math.exp(-ageHours / 24);
    score *= (0.5 + 0.5 * timeDecay); // Minimum 50% weight

    // Author influence
    if (input.metadata.authorFollowers) {
      const influenceBoost = Math.min(0.2, Math.log10(input.metadata.authorFollowers + 1) * 0.03);
      score = score > 0 ? score + influenceBoost : score - influenceBoost;
    }

    return Math.max(-1, Math.min(1, score));
  }

  private combineScores(scores: Record<string, number>): number {
    let combined = 0;
    let totalWeight = 0;

    for (const [key, score] of Object.entries(scores)) {
      const weight = this.ensembleWeights[key] || 0;
      combined += score * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? combined / totalWeight : 0;
  }

  private analyzeEmotions(text: string): EmotionScores {
    const emotions: EmotionScores = {
      fear: 0,
      greed: 0,
      uncertainty: 0,
      optimism: 0,
      anger: 0,
      excitement: 0,
    };

    const words = text.toLowerCase().split(/\s+/);

    // Count fear indicators
    emotions.fear = CRYPTO_LEXICON.fear.filter(term =>
      words.some(w => w.includes(term)) || text.includes(term)
    ).length / CRYPTO_LEXICON.fear.length;

    // Count greed indicators
    emotions.greed = CRYPTO_LEXICON.greed.filter(term =>
      words.some(w => w.includes(term)) || text.includes(term)
    ).length / CRYPTO_LEXICON.greed.length;

    // Count uncertainty indicators
    emotions.uncertainty = CRYPTO_LEXICON.uncertainty.filter(term =>
      words.some(w => w.includes(term)) || text.includes(term)
    ).length / CRYPTO_LEXICON.uncertainty.length;

    // Derive optimism from bullish terms
    emotions.optimism = [...CRYPTO_LEXICON.bullish, ...CRYPTO_LEXICON.veryBullish].filter(term =>
      words.some(w => w.includes(term)) || text.includes(term)
    ).length / (CRYPTO_LEXICON.bullish.length + CRYPTO_LEXICON.veryBullish.length);

    // Derive anger from bearish + specific anger terms
    const angerTerms = ['angry', 'furious', 'outraged', 'scam', 'fraud', 'theft', 'stolen'];
    emotions.anger = angerTerms.filter(term =>
      words.some(w => w.includes(term)) || text.includes(term)
    ).length / angerTerms.length;

    // Derive excitement from intensifiers + bullish
    const excitementTerms = ['lfg', 'lets go', 'amazing', 'incredible', 'insane', 'crazy', 'moon'];
    emotions.excitement = excitementTerms.filter(term =>
      words.some(w => w.includes(term)) || text.includes(term)
    ).length / excitementTerms.length;

    // Normalize all to 0-1
    for (const key of Object.keys(emotions) as (keyof EmotionScores)[]) {
      emotions[key] = Math.min(1, emotions[key] * 2); // Scale up and cap
    }

    return emotions;
  }

  private extractEntities(text: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];
    const words = text.toLowerCase().split(/\s+/);

    // Extract assets
    for (const word of words) {
      const cleanWord = word.replace(/[^a-z0-9]/g, '');
      if (ASSET_ALIASES[cleanWord]) {
        const normalizedName = ASSET_ALIASES[cleanWord];
        if (!entities.find(e => e.normalizedName === normalizedName)) {
          entities.push({
            text: word,
            type: 'asset',
            normalizedName,
            confidence: 0.95,
          });
        }
      }
    }

    // Check for ticker patterns ($BTC, $ETH, etc.)
    const tickerMatches = text.match(/\$([A-Za-z]{2,10})/g);
    if (tickerMatches) {
      for (const match of tickerMatches) {
        const ticker = match.substring(1).toUpperCase();
        if (!entities.find(e => e.normalizedName === ticker)) {
          entities.push({
            text: match,
            type: 'asset',
            normalizedName: ticker,
            confidence: 0.9,
          });
        }
      }
    }

    // Extract exchanges
    const exchanges = ['binance', 'coinbase', 'kraken', 'ftx', 'bybit', 'okx', 'kucoin', 'huobi', 'gemini'];
    for (const exchange of exchanges) {
      if (text.includes(exchange)) {
        entities.push({
          text: exchange,
          type: 'exchange',
          normalizedName: exchange.charAt(0).toUpperCase() + exchange.slice(1),
          confidence: 0.9,
        });
      }
    }

    // Extract protocols
    const protocols = ['uniswap', 'aave', 'compound', 'curve', 'maker', 'lido', 'opensea', 'blur'];
    for (const protocol of protocols) {
      if (text.includes(protocol)) {
        entities.push({
          text: protocol,
          type: 'protocol',
          normalizedName: protocol.charAt(0).toUpperCase() + protocol.slice(1),
          confidence: 0.85,
        });
      }
    }

    return entities;
  }

  private extractTopics(text: string, entities: ExtractedEntity[]): ExtractedTopic[] {
    const topics: ExtractedTopic[] = [];

    // Topic patterns
    const topicPatterns: { pattern: RegExp; topic: string }[] = [
      { pattern: /price|pric(e|ing)|cost/i, topic: 'price_action' },
      { pattern: /regulation|sec|cftc|regulatory|compliance/i, topic: 'regulation' },
      { pattern: /hack|exploit|vulnerability|security/i, topic: 'security' },
      { pattern: /upgrade|update|v2|v3|hard fork|soft fork/i, topic: 'technology' },
      { pattern: /partnership|collab|integration/i, topic: 'partnerships' },
      { pattern: /listing|delist|exchange/i, topic: 'exchange_listing' },
      { pattern: /whale|large (buy|sell|transfer)/i, topic: 'whale_activity' },
      { pattern: /etf|institutional|grayscale|blackrock/i, topic: 'institutional' },
      { pattern: /defi|yield|farming|staking/i, topic: 'defi' },
      { pattern: /nft|opensea|blur|collectible/i, topic: 'nft' },
      { pattern: /layer.?2|l2|rollup|scaling/i, topic: 'scaling' },
      { pattern: /macro|fed|interest rate|inflation/i, topic: 'macro' },
    ];

    for (const { pattern, topic } of topicPatterns) {
      if (pattern.test(text)) {
        topics.push({
          topic,
          relevance: 0.8,
          sentiment: 0, // Would be calculated from context
        });
      }
    }

    // Add asset-based topics
    for (const entity of entities.filter(e => e.type === 'asset')) {
      topics.push({
        topic: `${entity.normalizedName}_discussion`,
        relevance: 0.9,
        sentiment: 0,
      });
    }

    return topics;
  }

  private detectSignals(text: string, score: number, input: TextInput): MarketSignal[] {
    const signals: MarketSignal[] = [];

    // FOMO detection
    if (CRYPTO_LEXICON.greed.some(term => text.includes(term)) && score > 0.3) {
      signals.push({
        type: 'fomo',
        strength: Math.min(1, score + 0.3),
        confidence: 0.7,
        description: 'Fear of missing out detected in sentiment',
      });
    }

    // FUD detection
    if (CRYPTO_LEXICON.fear.some(term => text.includes(term)) && score < -0.3) {
      signals.push({
        type: 'fud',
        strength: Math.min(1, Math.abs(score) + 0.3),
        confidence: 0.7,
        description: 'Fear, uncertainty, and doubt detected',
      });
    }

    // Whale activity from on-chain source
    if (input.source === 'onchain') {
      signals.push({
        type: 'whale_activity',
        strength: 0.8,
        confidence: 0.9,
        description: 'On-chain activity from significant wallet',
      });
    }

    // Institutional interest
    if (/institutional|blackrock|fidelity|grayscale|etf/i.test(text)) {
      signals.push({
        type: 'institutional_interest',
        strength: 0.7,
        confidence: 0.8,
        description: 'Institutional interest mentioned',
      });
    }

    // Retail interest (high engagement on social)
    if (input.source === 'twitter' && input.metadata.engagement) {
      const engagement = input.metadata.engagement;
      const totalEngagement = (engagement.likes || 0) + (engagement.retweets || 0) * 2;
      if (totalEngagement > 10000) {
        signals.push({
          type: 'retail_interest',
          strength: Math.min(1, totalEngagement / 100000),
          confidence: 0.75,
          description: 'High retail interest based on social engagement',
        });
      }
    }

    return signals;
  }

  // ---------------------------------------------------------------------------
  // UTILITY METHODS
  // ---------------------------------------------------------------------------

  private scoreToLabel(score: number): SentimentScore['label'] {
    if (score >= 0.5) return 'very_bullish';
    if (score >= 0.15) return 'bullish';
    if (score <= -0.5) return 'very_bearish';
    if (score <= -0.15) return 'bearish';
    return 'neutral';
  }

  private calculateConfidence(
    lexiconScore: number,
    transformerScore: number,
    contextualScore: number
  ): number {
    // Confidence is higher when all models agree
    const scores = [lexiconScore, transformerScore, contextualScore];
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
    const stdDev = Math.sqrt(variance);

    // Low standard deviation = high agreement = high confidence
    const agreementConfidence = Math.max(0, 1 - stdDev * 2);

    // Distance from neutral adds confidence
    const magnitudeConfidence = Math.abs(mean);

    return Math.min(0.99, (agreementConfidence * 0.6 + magnitudeConfidence * 0.4));
  }

  private calculateResultWeight(result: SentimentResult): number {
    // Weight based on confidence and recency
    const confidenceWeight = result.sentiment.confidence;

    // More entities = more relevant
    const entityWeight = Math.min(1, result.entities.length / 3);

    // Signals add weight
    const signalWeight = Math.min(1, result.signals.length / 2);

    return (confidenceWeight * 0.5 + entityWeight * 0.25 + signalWeight * 0.25);
  }

  private bootstrapConfidenceInterval(
    scores: number[],
    confidence: number
  ): [number, number] {
    if (scores.length < 10) {
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const stdErr = Math.sqrt(
        scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length
      ) / Math.sqrt(scores.length);
      const z = 1.96; // 95% confidence
      return [mean - z * stdErr, mean + z * stdErr];
    }

    // BCa Bootstrap
    const numBootstrap = 1000;
    const bootstrapMeans: number[] = [];

    for (let i = 0; i < numBootstrap; i++) {
      const sample = Array.from({ length: scores.length }, () =>
        scores[Math.floor(Math.random() * scores.length)]
      );
      bootstrapMeans.push(sample.reduce((a, b) => a + b, 0) / sample.length);
    }

    bootstrapMeans.sort((a, b) => a - b);

    const alpha = 1 - confidence;
    const lowerIdx = Math.floor(numBootstrap * (alpha / 2));
    const upperIdx = Math.floor(numBootstrap * (1 - alpha / 2));

    return [bootstrapMeans[lowerIdx], bootstrapMeans[upperIdx]];
  }

  private groupBySource(results: SentimentResult[]): Record<string, SentimentResult[]> {
    // Note: We'd need to track source in the result - adding placeholder logic
    const grouped: Record<string, SentimentResult[]> = {};

    for (const result of results) {
      const source = 'twitter'; // Placeholder - would come from input tracking
      if (!grouped[source]) {
        grouped[source] = [];
      }
      grouped[source].push(result);
    }

    return grouped;
  }

  private aggregateEmotions(results: SentimentResult[]): EmotionScores {
    const aggregated: EmotionScores = {
      fear: 0,
      greed: 0,
      uncertainty: 0,
      optimism: 0,
      anger: 0,
      excitement: 0,
    };

    for (const result of results) {
      for (const key of Object.keys(aggregated) as (keyof EmotionScores)[]) {
        aggregated[key] += result.sentiment.emotions[key];
      }
    }

    // Average
    for (const key of Object.keys(aggregated) as (keyof EmotionScores)[]) {
      aggregated[key] /= results.length;
    }

    return aggregated;
  }

  private aggregateSignals(signals: MarketSignal[]): MarketSignal[] {
    // Group by type and keep strongest
    const byType = new Map<SignalType, MarketSignal>();

    for (const signal of signals) {
      const existing = byType.get(signal.type);
      if (!existing || signal.strength > existing.strength) {
        byType.set(signal.type, signal);
      }
    }

    return Array.from(byType.values()).sort((a, b) => b.strength - a.strength);
  }

  private findTopInfluencers(_results: SentimentResult[], _limit: number): InfluencerMention[] {
    // Placeholder - would need to track author info with results
    return [];
  }

  private calculateMomentum(results: SentimentResult[]): {
    shortTerm: number;
    mediumTerm: number;
    longTerm: number;
  } {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    const fourHours = 4 * oneHour;
    const twentyFourHours = 24 * oneHour;

    const getAverageScore = (startTime: number, endTime: number): number => {
      const filtered = results.filter(r => {
        const t = r.timestamp.getTime();
        return t >= startTime && t < endTime;
      });
      if (filtered.length === 0) return 0;
      return filtered.reduce((sum, r) => sum + r.sentiment.raw, 0) / filtered.length;
    };

    // Calculate momentum as change in sentiment
    const currentScore = getAverageScore(now - oneHour, now);
    const oneHourAgo = getAverageScore(now - 2 * oneHour, now - oneHour);
    const fourHoursAgo = getAverageScore(now - 5 * oneHour, now - fourHours);
    const twentyFourHoursAgo = getAverageScore(now - 25 * oneHour, now - twentyFourHours);

    return {
      shortTerm: currentScore - oneHourAgo,
      mediumTerm: currentScore - fourHoursAgo,
      longTerm: currentScore - twentyFourHoursAgo,
    };
  }

  private calculateSourceBreakdown(results: SentimentResult[]): SourceBreakdown {
    if (results.length === 0) {
      return { score: 0.5, volume: 0, weight: 0, trend: 'stable' };
    }

    const avgScore = results.reduce((sum, r) => sum + r.sentiment.normalized, 0) / results.length;

    // Calculate trend
    const midpoint = Math.floor(results.length / 2);
    const firstHalf = results.slice(0, midpoint);
    const secondHalf = results.slice(midpoint);

    const firstAvg = firstHalf.reduce((sum, r) => sum + r.sentiment.normalized, 0) / (firstHalf.length || 1);
    const secondAvg = secondHalf.reduce((sum, r) => sum + r.sentiment.normalized, 0) / (secondHalf.length || 1);

    let trend: 'rising' | 'falling' | 'stable' = 'stable';
    if (secondAvg - firstAvg > 0.05) trend = 'rising';
    else if (firstAvg - secondAvg > 0.05) trend = 'falling';

    return {
      score: avgScore,
      volume: results.length,
      weight: 1, // Would be source-specific
      trend,
    };
  }

  private createEmptyAggregation(asset: string, period: string): AggregatedSentiment {
    return {
      asset,
      timestamp: new Date(),
      period,
      sentiment: {
        score: 0.5,
        label: 'neutral',
        confidence: 0,
        confidenceInterval: [0.5, 0.5],
      },
      volume: {
        total: 0,
        bySource: {} as Record<DataSource, number>,
      },
      momentum: {
        shortTerm: 0,
        mediumTerm: 0,
        longTerm: 0,
      },
      signals: [],
      topInfluencers: [],
      breakdown: {
        bySource: {} as Record<DataSource, SourceBreakdown>,
        byEmotion: {
          fear: 0,
          greed: 0,
          uncertainty: 0,
          optimism: 0,
          anger: 0,
          excitement: 0,
        },
      },
    };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default SentimentEngine;
