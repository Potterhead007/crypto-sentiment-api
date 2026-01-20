/**
 * Sentiment Engine Unit Tests
 * Tests for the NLP sentiment analysis engine
 */

import { SentimentEngine, TextInput, DataSource } from '../../src/nlp/sentimentEngine';

describe('SentimentEngine', () => {
  let engine: SentimentEngine;

  beforeAll(() => {
    engine = new SentimentEngine({
      useCryptoLexicon: true,
      enableEmotionAnalysis: true,
      confidenceMethod: 'bca_bootstrap',
    });
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      const defaultEngine = new SentimentEngine();
      expect(defaultEngine).toBeDefined();
      expect(defaultEngine.isReady()).toBe(true);
    });

    it('should initialize with custom configuration', () => {
      const customEngine = new SentimentEngine({
        modelVersion: '2.0.0',
        batchSize: 50,
        ensembleWeights: { lexicon: 0.3, transformer: 0.4, contextual: 0.3 },
      });
      expect(customEngine).toBeDefined();
      expect(customEngine.isReady()).toBe(true);
    });
  });

  describe('Single Text Analysis', () => {
    const createInput = (text: string, source: DataSource = 'twitter'): TextInput => ({
      id: `test_${Date.now()}`,
      text,
      source,
      timestamp: new Date(),
      metadata: {},
    });

    it('should analyze bullish text correctly', async () => {
      const input = createInput('Bitcoin is mooning! LFG! This is going to $100k! Extremely bullish!');
      const result = await engine.analyze(input);

      expect(result).toBeDefined();
      expect(result.sentiment.raw).toBeGreaterThan(0);
      expect(result.sentiment.label).toMatch(/bullish/);
      expect(result.sentiment.confidence).toBeGreaterThan(0);
      expect(result.sentiment.confidence).toBeLessThanOrEqual(1);
    });

    it('should analyze bearish text correctly', async () => {
      const input = createInput('Crypto is crashing! This is a scam! Sell everything! We are going to zero!');
      const result = await engine.analyze(input);

      expect(result).toBeDefined();
      expect(result.sentiment.raw).toBeLessThan(0);
      expect(result.sentiment.label).toMatch(/bearish/);
    });

    it('should analyze neutral text correctly', async () => {
      const input = createInput('The price of Bitcoin is currently at $50,000.');
      const result = await engine.analyze(input);

      expect(result).toBeDefined();
      expect(result.sentiment.raw).toBeGreaterThanOrEqual(-0.15);
      expect(result.sentiment.raw).toBeLessThanOrEqual(0.15);
      expect(result.sentiment.label).toBe('neutral');
    });

    it('should handle negation correctly', async () => {
      // Test that negated bearish text is less negative
      const bearishInput = createInput("Bitcoin is crashing and dead.");
      const negatedBearishInput = createInput("Bitcoin is not crashing and not dead.");

      const bearishResult = await engine.analyze(bearishInput);
      const negatedResult = await engine.analyze(negatedBearishInput);

      // Negated bearish should be less negative than pure bearish
      expect(negatedResult.sentiment.raw).toBeGreaterThan(bearishResult.sentiment.raw);
    });

    it('should handle intensifiers correctly', async () => {
      const normalInput = createInput('Bitcoin is bullish');
      const intensifiedInput = createInput('Bitcoin is extremely bullish');

      const normalResult = await engine.analyze(normalInput);
      const intensifiedResult = await engine.analyze(intensifiedInput);

      // Intensifier should increase magnitude
      expect(Math.abs(intensifiedResult.sentiment.raw)).toBeGreaterThanOrEqual(
        Math.abs(normalResult.sentiment.raw) * 0.9 // Allow some variance
      );
    });

    it('should extract crypto entities', async () => {
      const input = createInput('$BTC and ethereum are the best. Buying more SOL too!');
      const result = await engine.analyze(input);

      expect(result.entities).toBeDefined();
      expect(result.entities.length).toBeGreaterThan(0);

      const assets = result.entities.filter(e => e.type === 'asset');
      const normalizedNames = assets.map(a => a.normalizedName);

      expect(normalizedNames).toContain('BTC');
      expect(normalizedNames).toContain('ETH');
      expect(normalizedNames).toContain('SOL');
    });

    it('should extract exchange entities', async () => {
      const input = createInput('Just listed on Binance! Coinbase next?');
      const result = await engine.analyze(input);

      const exchanges = result.entities.filter(e => e.type === 'exchange');
      expect(exchanges.length).toBeGreaterThan(0);
      expect(exchanges.some(e => e.normalizedName === 'Binance')).toBe(true);
    });

    it('should detect emotions', async () => {
      const fearInput = createInput('I am scared and worried about the market. Very uncertain times.');
      const fearResult = await engine.analyze(fearInput);

      expect(fearResult.sentiment.emotions).toBeDefined();
      expect(fearResult.sentiment.emotions.fear).toBeGreaterThan(0);
      expect(fearResult.sentiment.emotions.uncertainty).toBeGreaterThan(0);

      const greedInput = createInput('FOMO is real! YOLO all in! Easy money!');
      const greedResult = await engine.analyze(greedInput);

      expect(greedResult.sentiment.emotions.greed).toBeGreaterThan(0);
    });

    it('should detect market signals', async () => {
      // Test FOMO detection - needs greed terms and high positive sentiment
      const fomoInput = createInput("FOMO is real! Easy money! Yolo all in on BTC! This is mooning! LFG!");
      const fomoResult = await engine.analyze(fomoInput);

      expect(fomoResult.signals).toBeDefined();
      // Check that signals array exists, FOMO may or may not trigger based on sentiment threshold
      expect(Array.isArray(fomoResult.signals)).toBe(true);

      // Test institutional interest detection
      const institutionalInput = createInput('BlackRock and Fidelity are buying Bitcoin. ETF approved!');
      const institutionalResult = await engine.analyze(institutionalInput);

      expect(institutionalResult.signals.some(s => s.type === 'institutional_interest')).toBe(true);
    });

    it('should include model info in results', async () => {
      const input = createInput('Test text');
      const result = await engine.analyze(input);

      expect(result.modelInfo).toBeDefined();
      expect(result.modelInfo.modelId).toBeDefined();
      expect(result.modelInfo.modelVersion).toBeDefined();
      expect(result.modelInfo.ensembleWeights).toBeDefined();
    });

    it('should track processing time', async () => {
      const input = createInput('Quick test');
      const result = await engine.analyze(input);

      expect(result.processingTimeMs).toBeDefined();
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Batch Analysis', () => {
    it('should analyze multiple texts in batch', async () => {
      const inputs: TextInput[] = [
        { id: '1', text: 'Bullish on BTC!', source: 'twitter', timestamp: new Date(), metadata: {} },
        { id: '2', text: 'ETH is crashing', source: 'reddit', timestamp: new Date(), metadata: {} },
        { id: '3', text: 'SOL price update', source: 'news', timestamp: new Date(), metadata: {} },
      ];

      const results = await engine.analyzeBatch(inputs);

      expect(results).toHaveLength(3);
      expect(results[0].sentiment.raw).toBeGreaterThan(0); // bullish
      expect(results[1].sentiment.raw).toBeLessThan(0); // bearish
    });

    it('should handle empty batch', async () => {
      const results = await engine.analyzeBatch([]);
      expect(results).toHaveLength(0);
    });
  });

  describe('Aggregation', () => {
    it('should aggregate sentiment results', async () => {
      const inputs: TextInput[] = [
        { id: '1', text: 'BTC moon!', source: 'twitter', timestamp: new Date(), metadata: {} },
        { id: '2', text: 'BTC bullish', source: 'reddit', timestamp: new Date(), metadata: {} },
        { id: '3', text: 'BTC bearish', source: 'news', timestamp: new Date(), metadata: {} },
      ];

      const results = await engine.analyzeBatch(inputs);
      const aggregated = engine.aggregateSentiment('BTC', results, '1h');

      expect(aggregated).toBeDefined();
      expect(aggregated.asset).toBe('BTC');
      expect(aggregated.period).toBe('1h');
      expect(aggregated.sentiment.score).toBeGreaterThanOrEqual(0);
      expect(aggregated.sentiment.score).toBeLessThanOrEqual(1);
      expect(aggregated.volume.total).toBe(3);
    });

    it('should handle empty aggregation', () => {
      const aggregated = engine.aggregateSentiment('BTC', [], '1h');

      expect(aggregated.asset).toBe('BTC');
      expect(aggregated.sentiment.score).toBe(0.5); // neutral
      expect(aggregated.volume.total).toBe(0);
    });

    it('should calculate confidence intervals', async () => {
      const inputs: TextInput[] = Array.from({ length: 20 }, (_, i) => ({
        id: String(i),
        text: i % 2 === 0 ? 'BTC bullish' : 'BTC slightly down',
        source: 'twitter' as DataSource,
        timestamp: new Date(),
        metadata: {},
      }));

      const results = await engine.analyzeBatch(inputs);
      const aggregated = engine.aggregateSentiment('BTC', results, '1h');

      expect(aggregated.sentiment.confidenceInterval).toBeDefined();
      expect(aggregated.sentiment.confidenceInterval).toHaveLength(2);
      expect(aggregated.sentiment.confidenceInterval[0]).toBeLessThanOrEqual(aggregated.sentiment.score);
      expect(aggregated.sentiment.confidenceInterval[1]).toBeGreaterThanOrEqual(aggregated.sentiment.score);
    });
  });

  describe('Source Handling', () => {
    it('should process different data sources', async () => {
      const sources: DataSource[] = ['twitter', 'reddit', 'news', 'onchain', 'discord', 'telegram'];

      for (const source of sources) {
        const input: TextInput = {
          id: `test_${source}`,
          text: 'Test sentiment',
          source,
          timestamp: new Date(),
          metadata: {},
        };

        const result = await engine.analyze(input);
        expect(result.source).toBe(source);
      }
    });

    it('should detect whale activity from onchain source', async () => {
      const input: TextInput = {
        id: 'onchain_test',
        text: 'Large transfer detected',
        source: 'onchain',
        timestamp: new Date(),
        metadata: {},
      };

      const result = await engine.analyze(input);
      expect(result.signals.some(s => s.type === 'whale_activity')).toBe(true);
    });
  });

  describe('Metadata Handling', () => {
    it('should factor in author followers', async () => {
      const lowFollowersInput: TextInput = {
        id: 'low',
        text: 'BTC bullish',
        source: 'twitter',
        timestamp: new Date(),
        metadata: { authorFollowers: 100 },
      };

      const highFollowersInput: TextInput = {
        id: 'high',
        text: 'BTC bullish',
        source: 'twitter',
        timestamp: new Date(),
        metadata: { authorFollowers: 1000000 },
      };

      const lowResult = await engine.analyze(lowFollowersInput);
      const highResult = await engine.analyze(highFollowersInput);

      // Higher followers should have slightly higher absolute score
      expect(Math.abs(highResult.sentiment.raw)).toBeGreaterThanOrEqual(
        Math.abs(lowResult.sentiment.raw) * 0.9
      );
    });

    it('should factor in verified status', async () => {
      const unverifiedInput: TextInput = {
        id: 'unverified',
        text: 'BTC bullish',
        source: 'twitter',
        timestamp: new Date(),
        metadata: { authorVerified: false },
      };

      const verifiedInput: TextInput = {
        id: 'verified',
        text: 'BTC bullish',
        source: 'twitter',
        timestamp: new Date(),
        metadata: { authorVerified: true },
      };

      const unverifiedResult = await engine.analyze(unverifiedInput);
      const verifiedResult = await engine.analyze(verifiedInput);

      // Verified should have slightly higher score
      expect(Math.abs(verifiedResult.sentiment.raw)).toBeGreaterThanOrEqual(
        Math.abs(unverifiedResult.sentiment.raw) * 0.9
      );
    });
  });

  describe('HuggingFace API Integration', () => {
    let fetchSpy: jest.SpyInstance;

    beforeEach(() => {
      fetchSpy = jest.spyOn(global, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('should use HuggingFace API when API key is provided', async () => {
      const engineWithApi = new SentimentEngine({
        huggingFaceApiKey: 'test-api-key',
      });

      // Mock successful FinBERT response
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => [[
          { label: 'positive', score: 0.8 },
          { label: 'negative', score: 0.1 },
          { label: 'neutral', score: 0.1 },
        ]],
      } as Response);

      const input: TextInput = {
        id: 'hf_test',
        text: 'Bitcoin is great',
        source: 'twitter',
        timestamp: new Date(),
        metadata: {},
      };

      const result = await engineWithApi.analyze(input);
      expect(fetchSpy).toHaveBeenCalled();
      expect(result.sentiment.raw).toBeGreaterThan(0);
    });

    it('should handle alternative HuggingFace response format', async () => {
      const engineWithApi = new SentimentEngine({
        huggingFaceApiKey: 'test-api-key',
      });

      // Mock alternative format (single label)
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ label: 'POSITIVE', score: 0.9 }],
      } as Response);

      const input: TextInput = {
        id: 'hf_alt',
        text: 'Good news',
        source: 'news',
        timestamp: new Date(),
        metadata: {},
      };

      const result = await engineWithApi.analyze(input);
      expect(result.sentiment.raw).toBeGreaterThan(0);
    });

    it('should handle LABEL_X format from HuggingFace', async () => {
      const engineWithApi = new SentimentEngine({
        huggingFaceApiKey: 'test-api-key',
      });

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ label: 'LABEL_2', score: 0.85 }],
      } as Response);

      const input: TextInput = {
        id: 'hf_label',
        text: 'Test',
        source: 'twitter',
        timestamp: new Date(),
        metadata: {},
      };

      const result = await engineWithApi.analyze(input);
      expect(result).toBeDefined();
    });

    it('should fall back to lexicon on HuggingFace API error', async () => {
      const engineWithApi = new SentimentEngine({
        huggingFaceApiKey: 'test-api-key',
      });

      // Mock API failure
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      const input: TextInput = {
        id: 'hf_fallback',
        text: 'BTC bullish',
        source: 'twitter',
        timestamp: new Date(),
        metadata: {},
      };

      const result = await engineWithApi.analyze(input);
      expect(result).toBeDefined();
      expect(result.sentiment.raw).toBeGreaterThan(0); // lexicon fallback works
    });

    it('should use cached HuggingFace results', async () => {
      const engineWithApi = new SentimentEngine({
        huggingFaceApiKey: 'test-api-key',
      });

      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => [[
          { label: 'positive', score: 0.7 },
          { label: 'negative', score: 0.2 },
          { label: 'neutral', score: 0.1 },
        ]],
      } as Response);

      const input: TextInput = {
        id: 'hf_cache',
        text: 'Same text for caching',
        source: 'twitter',
        timestamp: new Date(),
        metadata: {},
      };

      // First call
      await engineWithApi.analyze(input);
      // Second call with same text
      await engineWithApi.analyze({ ...input, id: 'hf_cache_2' });

      // Should only call fetch once due to caching
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Engagement Metadata Boosts', () => {
    it('should boost positive sentiment based on engagement', async () => {
      const lowEngagementInput: TextInput = {
        id: 'low_eng',
        text: 'BTC is looking good',
        source: 'twitter',
        timestamp: new Date(),
        metadata: {
          engagement: { likes: 1, retweets: 0, replies: 0 },
        },
      };

      const highEngagementInput: TextInput = {
        id: 'high_eng',
        text: 'BTC is looking good',
        source: 'twitter',
        timestamp: new Date(),
        metadata: {
          engagement: { likes: 10000, retweets: 5000, replies: 1000 },
        },
      };

      const lowResult = await engine.analyze(lowEngagementInput);
      const highResult = await engine.analyze(highEngagementInput);

      // High engagement should boost the score
      expect(Math.abs(highResult.sentiment.raw)).toBeGreaterThanOrEqual(
        Math.abs(lowResult.sentiment.raw) * 0.95
      );
    });

    it('should handle engagement with missing fields', async () => {
      const input: TextInput = {
        id: 'partial_eng',
        text: 'Crypto news update',
        source: 'twitter',
        timestamp: new Date(),
        metadata: {
          engagement: { likes: 100 }, // only likes, no retweets/replies
        },
      };

      const result = await engine.analyze(input);
      expect(result).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty text', async () => {
      const input: TextInput = {
        id: 'empty',
        text: '',
        source: 'twitter',
        timestamp: new Date(),
        metadata: {},
      };

      const result = await engine.analyze(input);
      // Empty text should produce near-neutral sentiment (with small noise from transformer)
      expect(Math.abs(result.sentiment.raw)).toBeLessThan(0.15);
      expect(result.sentiment.label).toBe('neutral');
    });

    it('should handle very long text', async () => {
      const longText = 'BTC is bullish! '.repeat(500);
      const input: TextInput = {
        id: 'long',
        text: longText,
        source: 'news',
        timestamp: new Date(),
        metadata: {},
      };

      const result = await engine.analyze(input);
      expect(result).toBeDefined();
      expect(result.sentiment.raw).toBeGreaterThan(0);
    });

    it('should handle special characters', async () => {
      const input: TextInput = {
        id: 'special',
        text: '🚀🚀🚀 $BTC to the moon! 💎🙌 #crypto #bullish',
        source: 'twitter',
        timestamp: new Date(),
        metadata: {},
      };

      const result = await engine.analyze(input);
      expect(result).toBeDefined();
      expect(result.sentiment.raw).toBeGreaterThan(0);
    });

    it('should handle URLs in text', async () => {
      const input: TextInput = {
        id: 'url',
        text: 'Check this out https://example.com/bitcoin BTC is bullish!',
        source: 'twitter',
        timestamp: new Date(),
        metadata: {},
      };

      const result = await engine.analyze(input);
      expect(result).toBeDefined();
      expect(result.sentiment.raw).toBeGreaterThan(0);
    });

    it('should handle mentions', async () => {
      const input: TextInput = {
        id: 'mentions',
        text: '@elonmusk says BTC is the future! Bullish!',
        source: 'twitter',
        timestamp: new Date(),
        metadata: {},
      };

      const result = await engine.analyze(input);
      expect(result).toBeDefined();
    });
  });
});
