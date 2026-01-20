/**
 * Entity-Resolved On-Chain Data Module
 * Institutional-Grade Cryptocurrency Market Sentiment Analysis API
 *
 * Provides:
 * - Wallet clustering and entity attribution
 * - Smart money tracking
 * - Whale activity monitoring
 * - Exchange flow analysis
 * - Entity sentiment derivation
 */

import { EventEmitter } from 'events';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

export type EntityType =
  | 'exchange'
  | 'defi_protocol'
  | 'whale'
  | 'smart_money'
  | 'market_maker'
  | 'fund'
  | 'foundation'
  | 'bridge'
  | 'miner'
  | 'staking'
  | 'treasury'
  | 'contract'
  | 'fresh_wallet'
  | 'retail'
  | 'unknown';

export type EntityConfidence = 'high' | 'medium' | 'low' | 'unverified';

export interface ResolvedEntity {
  /** Unique entity identifier */
  entityId: string;
  /** Entity type classification */
  type: EntityType;
  /** Entity name (if known) */
  name: string | null;
  /** Entity labels (e.g., "Binance Hot Wallet", "Jump Trading") */
  labels: string[];
  /** Confidence level */
  confidence: EntityConfidence;
  /** Associated wallet addresses */
  addresses: WalletAddress[];
  /** First seen timestamp */
  firstSeen: Date;
  /** Last activity timestamp */
  lastActive: Date;
  /** Entity metrics */
  metrics: EntityMetrics;
  /** Metadata */
  metadata: Record<string, any>;
}

export interface WalletAddress {
  /** Blockchain address */
  address: string;
  /** Chain ID (1 = Ethereum, 56 = BSC, etc.) */
  chainId: number;
  /** Chain name */
  chain: string;
  /** Is this the primary address? */
  isPrimary: boolean;
  /** Attribution confidence */
  confidence: EntityConfidence;
  /** First seen */
  firstSeen: Date;
  /** Last active */
  lastActive: Date;
  /** Balance in USD */
  balanceUsd: number;
  /** Transaction count */
  txCount: number;
}

export interface EntityMetrics {
  /** Total value held (USD) */
  totalValueUsd: number;
  /** 24h inflow (USD) */
  inflow24h: number;
  /** 24h outflow (USD) */
  outflow24h: number;
  /** Net flow 24h (USD) */
  netFlow24h: number;
  /** 7d net flow (USD) */
  netFlow7d: number;
  /** 30d net flow (USD) */
  netFlow30d: number;
  /** Number of distinct tokens held */
  tokensHeld: number;
  /** Activity score (0-100) */
  activityScore: number;
  /** Historical PnL if trackable */
  estimatedPnl?: number;
}

export interface WalletCluster {
  clusterId: string;
  addresses: string[];
  chainId: number;
  clusterType: 'deposit_correlation' | 'funding_pattern' | 'contract_interaction' | 'timing_analysis' | 'manual';
  confidence: EntityConfidence;
  createdAt: Date;
  updatedAt: Date;
}

export interface OnChainFlow {
  /** Unique flow ID */
  flowId: string;
  /** Timestamp */
  timestamp: Date;
  /** Source entity (if resolved) */
  source: ResolvedEntity | null;
  /** Source address */
  sourceAddress: string;
  /** Destination entity (if resolved) */
  destination: ResolvedEntity | null;
  /** Destination address */
  destinationAddress: string;
  /** Token symbol */
  token: string;
  /** Token contract address */
  tokenAddress: string;
  /** Amount in token units */
  amount: number;
  /** Amount in USD */
  amountUsd: number;
  /** Chain */
  chain: string;
  /** Chain ID */
  chainId: number;
  /** Transaction hash */
  txHash: string;
  /** Flow classification */
  flowType: FlowType;
  /** Sentiment signal */
  sentimentSignal: SentimentSignal;
}

export type FlowType =
  | 'exchange_deposit'
  | 'exchange_withdrawal'
  | 'whale_accumulation'
  | 'whale_distribution'
  | 'smart_money_buy'
  | 'smart_money_sell'
  | 'defi_deposit'
  | 'defi_withdrawal'
  | 'bridge_transfer'
  | 'internal_transfer'
  | 'unknown';

export interface SentimentSignal {
  /** Signal direction */
  direction: 'bullish' | 'bearish' | 'neutral';
  /** Signal strength (0-1) */
  strength: number;
  /** Confidence (0-1) */
  confidence: number;
  /** Reasoning */
  reasoning: string;
}

export interface EntitySentiment {
  /** Token symbol */
  token: string;
  /** Timestamp */
  timestamp: Date;
  /** Sentiment by entity type */
  byEntityType: Record<EntityType, EntityTypeSentiment>;
  /** Aggregate entity sentiment */
  aggregate: {
    score: number;
    direction: 'bullish' | 'bearish' | 'neutral';
    confidence: number;
  };
  /** Key signals */
  signals: EntitySignal[];
}

export interface EntityTypeSentiment {
  /** Entity type */
  type: EntityType;
  /** Sentiment score (0-1) */
  score: number;
  /** Net flow 24h */
  netFlow24h: number;
  /** Number of active entities */
  activeEntities: number;
  /** Accumulating vs distributing */
  behavior: 'accumulating' | 'distributing' | 'neutral';
}

export interface EntitySignal {
  /** Signal ID */
  signalId: string;
  /** Timestamp */
  timestamp: Date;
  /** Signal type */
  type: 'whale_move' | 'smart_money_entry' | 'smart_money_exit' | 'exchange_flow' | 'fresh_wallet_activity';
  /** Entity involved */
  entity: ResolvedEntity;
  /** Token */
  token: string;
  /** Amount USD */
  amountUsd: number;
  /** Direction */
  direction: 'in' | 'out';
  /** Sentiment impact */
  sentimentImpact: 'bullish' | 'bearish' | 'neutral';
  /** Impact strength (0-1) */
  impactStrength: number;
  /** Description */
  description: string;
}

// =============================================================================
// KNOWN ENTITIES DATABASE
// =============================================================================

interface KnownEntity {
  entityId: string;
  type: EntityType;
  name: string;
  labels: string[];
  addresses: { address: string; chain: string; chainId: number }[];
}

const KNOWN_ENTITIES: KnownEntity[] = [
  // Major Exchanges
  {
    entityId: 'binance',
    type: 'exchange',
    name: 'Binance',
    labels: ['CEX', 'Major Exchange'],
    addresses: [
      { address: '0x28c6c06298d514db089934071355e5743bf21d60', chain: 'ethereum', chainId: 1 },
      { address: '0x21a31ee1afc51d94c2efccaa2092ad1028285549', chain: 'ethereum', chainId: 1 },
    ],
  },
  {
    entityId: 'coinbase',
    type: 'exchange',
    name: 'Coinbase',
    labels: ['CEX', 'US Exchange', 'Publicly Traded'],
    addresses: [
      { address: '0x71660c4005ba85c37ccec55d0c4493e66fe775d3', chain: 'ethereum', chainId: 1 },
      { address: '0x503828976d22510aad0201ac7ec88293211d23da', chain: 'ethereum', chainId: 1 },
    ],
  },
  {
    entityId: 'kraken',
    type: 'exchange',
    name: 'Kraken',
    labels: ['CEX', 'US Exchange'],
    addresses: [
      { address: '0x2910543af39aba0cd09dbb2d50200b3e800a63d2', chain: 'ethereum', chainId: 1 },
    ],
  },

  // DeFi Protocols
  {
    entityId: 'uniswap_v3',
    type: 'defi_protocol',
    name: 'Uniswap V3',
    labels: ['DEX', 'AMM'],
    addresses: [
      { address: '0x1f98431c8ad98523631ae4a59f267346ea31f984', chain: 'ethereum', chainId: 1 },
    ],
  },
  {
    entityId: 'aave_v3',
    type: 'defi_protocol',
    name: 'Aave V3',
    labels: ['Lending', 'DeFi'],
    addresses: [
      { address: '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2', chain: 'ethereum', chainId: 1 },
    ],
  },

  // Notable Funds/Smart Money
  {
    entityId: 'jump_trading',
    type: 'smart_money',
    name: 'Jump Trading',
    labels: ['Market Maker', 'Smart Money', 'Institutional'],
    addresses: [
      { address: '0x9507c04b10486547584c37bcbd931b2a4fee9a41', chain: 'ethereum', chainId: 1 },
    ],
  },
  {
    entityId: 'wintermute',
    type: 'market_maker',
    name: 'Wintermute',
    labels: ['Market Maker', 'Smart Money'],
    addresses: [
      { address: '0x00000000ae347930bd1e7b0f35588b92280f9e75', chain: 'ethereum', chainId: 1 },
    ],
  },

  // Bridges
  {
    entityId: 'arbitrum_bridge',
    type: 'bridge',
    name: 'Arbitrum Bridge',
    labels: ['L2 Bridge', 'Arbitrum'],
    addresses: [
      { address: '0x8315177ab297ba92a06054ce80a67ed4dbd7ed3a', chain: 'ethereum', chainId: 1 },
    ],
  },

  // Foundations
  {
    entityId: 'ethereum_foundation',
    type: 'foundation',
    name: 'Ethereum Foundation',
    labels: ['Foundation', 'Core Team'],
    addresses: [
      { address: '0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae', chain: 'ethereum', chainId: 1 },
    ],
  },
];

// =============================================================================
// ENTITY RESOLUTION ENGINE
// =============================================================================

export class EntityResolutionEngine extends EventEmitter {
  private knownEntities: Map<string, ResolvedEntity> = new Map();
  private addressToEntity: Map<string, string> = new Map();
  private clusters: Map<string, WalletCluster> = new Map();
  private flows: OnChainFlow[] = [];
  private entitySentiment: Map<string, EntitySentiment> = new Map();

  constructor() {
    super();
    this.initializeKnownEntities();
  }

  private initializeKnownEntities(): void {
    for (const known of KNOWN_ENTITIES) {
      const entity: ResolvedEntity = {
        entityId: known.entityId,
        type: known.type,
        name: known.name,
        labels: known.labels,
        confidence: 'high',
        addresses: known.addresses.map(a => ({
          address: a.address.toLowerCase(),
          chainId: a.chainId,
          chain: a.chain,
          isPrimary: true,
          confidence: 'high',
          firstSeen: new Date('2020-01-01'),
          lastActive: new Date(),
          balanceUsd: 0,
          txCount: 0,
        })),
        firstSeen: new Date('2020-01-01'),
        lastActive: new Date(),
        metrics: {
          totalValueUsd: 0,
          inflow24h: 0,
          outflow24h: 0,
          netFlow24h: 0,
          netFlow7d: 0,
          netFlow30d: 0,
          tokensHeld: 0,
          activityScore: 50,
        },
        metadata: {},
      };

      this.knownEntities.set(known.entityId, entity);

      // Build address index
      for (const addr of known.addresses) {
        this.addressToEntity.set(addr.address.toLowerCase(), known.entityId);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // ENTITY RESOLUTION
  // ---------------------------------------------------------------------------

  /**
   * Resolve an address to an entity
   */
  resolveAddress(address: string, chainId: number = 1): ResolvedEntity | null {
    const normalizedAddress = address.toLowerCase();

    // Check known entities
    const entityId = this.addressToEntity.get(normalizedAddress);
    if (entityId) {
      return this.knownEntities.get(entityId) || null;
    }

    // Check clusters
    for (const cluster of this.clusters.values()) {
      if (cluster.chainId === chainId && cluster.addresses.includes(normalizedAddress)) {
        const primaryEntityId = this.addressToEntity.get(cluster.addresses[0]);
        if (primaryEntityId) {
          return this.knownEntities.get(primaryEntityId) || null;
        }
      }
    }

    // Return unknown entity placeholder
    return this.createUnknownEntity(normalizedAddress, chainId);
  }

  /**
   * Create placeholder for unknown entity
   */
  private createUnknownEntity(address: string, chainId: number): ResolvedEntity {
    return {
      entityId: `unknown_${address.substring(0, 10)}`,
      type: 'unknown',
      name: null,
      labels: [],
      confidence: 'unverified',
      addresses: [{
        address,
        chainId,
        chain: this.chainIdToName(chainId),
        isPrimary: true,
        confidence: 'unverified',
        firstSeen: new Date(),
        lastActive: new Date(),
        balanceUsd: 0,
        txCount: 0,
      }],
      firstSeen: new Date(),
      lastActive: new Date(),
      metrics: {
        totalValueUsd: 0,
        inflow24h: 0,
        outflow24h: 0,
        netFlow24h: 0,
        netFlow7d: 0,
        netFlow30d: 0,
        tokensHeld: 0,
        activityScore: 0,
      },
      metadata: {},
    };
  }

  /**
   * Get all known entities
   */
  getAllEntities(): ResolvedEntity[] {
    return Array.from(this.knownEntities.values());
  }

  /**
   * Get entities by type
   */
  getEntitiesByType(type: EntityType): ResolvedEntity[] {
    return Array.from(this.knownEntities.values()).filter(e => e.type === type);
  }

  /**
   * Search entities
   */
  searchEntities(query: string): ResolvedEntity[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.knownEntities.values()).filter(e =>
      e.name?.toLowerCase().includes(lowerQuery) ||
      e.labels.some(l => l.toLowerCase().includes(lowerQuery)) ||
      e.entityId.toLowerCase().includes(lowerQuery)
    );
  }

  // ---------------------------------------------------------------------------
  // FLOW PROCESSING
  // ---------------------------------------------------------------------------

  /**
   * Process an on-chain flow event
   */
  processFlow(flowData: {
    txHash: string;
    sourceAddress: string;
    destinationAddress: string;
    token: string;
    tokenAddress: string;
    amount: number;
    amountUsd: number;
    chain: string;
    chainId: number;
    timestamp: Date;
  }): OnChainFlow {
    const source = this.resolveAddress(flowData.sourceAddress, flowData.chainId);
    const destination = this.resolveAddress(flowData.destinationAddress, flowData.chainId);

    // Classify flow type
    const flowType = this.classifyFlowType(source, destination);

    // Generate sentiment signal
    const sentimentSignal = this.generateSentimentSignal(flowType, flowData.amountUsd, source, destination);

    const flow: OnChainFlow = {
      flowId: `flow_${flowData.txHash}_${Date.now()}`,
      timestamp: flowData.timestamp,
      source,
      sourceAddress: flowData.sourceAddress,
      destination,
      destinationAddress: flowData.destinationAddress,
      token: flowData.token,
      tokenAddress: flowData.tokenAddress,
      amount: flowData.amount,
      amountUsd: flowData.amountUsd,
      chain: flowData.chain,
      chainId: flowData.chainId,
      txHash: flowData.txHash,
      flowType,
      sentimentSignal,
    };

    // Store flow
    this.flows.push(flow);
    if (this.flows.length > 10000) {
      this.flows = this.flows.slice(-10000);
    }

    // Update entity metrics
    this.updateEntityMetrics(flow);

    // Emit event for significant flows
    if (flowData.amountUsd > 1000000) {
      this.emit('significant_flow', flow);
    }

    return flow;
  }

  private classifyFlowType(
    source: ResolvedEntity | null,
    destination: ResolvedEntity | null
  ): FlowType {
    const sourceType = source?.type || 'unknown';
    const destType = destination?.type || 'unknown';

    // Exchange flows
    if (destType === 'exchange' && sourceType !== 'exchange') {
      return 'exchange_deposit';
    }
    if (sourceType === 'exchange' && destType !== 'exchange') {
      return 'exchange_withdrawal';
    }

    // Whale flows
    if (sourceType === 'whale') {
      return 'whale_distribution';
    }
    if (destType === 'whale') {
      return 'whale_accumulation';
    }

    // Smart money flows
    if (sourceType === 'smart_money' || sourceType === 'fund' || sourceType === 'market_maker') {
      return 'smart_money_sell';
    }
    if (destType === 'smart_money' || destType === 'fund' || destType === 'market_maker') {
      return 'smart_money_buy';
    }

    // DeFi flows
    if (destType === 'defi_protocol') {
      return 'defi_deposit';
    }
    if (sourceType === 'defi_protocol') {
      return 'defi_withdrawal';
    }

    // Bridge flows
    if (sourceType === 'bridge' || destType === 'bridge') {
      return 'bridge_transfer';
    }

    return 'unknown';
  }

  private generateSentimentSignal(
    flowType: FlowType,
    amountUsd: number,
    source: ResolvedEntity | null,
    destination: ResolvedEntity | null
  ): SentimentSignal {
    // Define sentiment rules
    const rules: Record<FlowType, { direction: SentimentSignal['direction']; baseStrength: number; reasoning: string }> = {
      exchange_deposit: { direction: 'bearish', baseStrength: 0.3, reasoning: 'Tokens moved to exchange (potential sell pressure)' },
      exchange_withdrawal: { direction: 'bullish', baseStrength: 0.3, reasoning: 'Tokens withdrawn from exchange (reduced sell pressure)' },
      whale_accumulation: { direction: 'bullish', baseStrength: 0.5, reasoning: 'Whale accumulation detected' },
      whale_distribution: { direction: 'bearish', baseStrength: 0.5, reasoning: 'Whale distribution detected' },
      smart_money_buy: { direction: 'bullish', baseStrength: 0.6, reasoning: 'Smart money accumulating' },
      smart_money_sell: { direction: 'bearish', baseStrength: 0.6, reasoning: 'Smart money reducing position' },
      defi_deposit: { direction: 'neutral', baseStrength: 0.2, reasoning: 'DeFi protocol deposit' },
      defi_withdrawal: { direction: 'neutral', baseStrength: 0.2, reasoning: 'DeFi protocol withdrawal' },
      bridge_transfer: { direction: 'neutral', baseStrength: 0.1, reasoning: 'Cross-chain bridge transfer' },
      internal_transfer: { direction: 'neutral', baseStrength: 0, reasoning: 'Internal transfer' },
      unknown: { direction: 'neutral', baseStrength: 0, reasoning: 'Unknown flow type' },
    };

    const rule = rules[flowType];

    // Scale strength by amount (log scale)
    const amountFactor = Math.min(1, Math.log10(Math.max(1, amountUsd / 100000)) / 3);
    const strength = Math.min(1, rule.baseStrength * (1 + amountFactor));

    // Confidence based on entity resolution
    let confidence = 0.5;
    if (source?.confidence === 'high' || destination?.confidence === 'high') {
      confidence = 0.8;
    }
    if (source?.confidence === 'high' && destination?.confidence === 'high') {
      confidence = 0.95;
    }

    return {
      direction: rule.direction,
      strength: Math.round(strength * 100) / 100,
      confidence: Math.round(confidence * 100) / 100,
      reasoning: rule.reasoning,
    };
  }

  private updateEntityMetrics(flow: OnChainFlow): void {
    // Update source entity
    if (flow.source && this.knownEntities.has(flow.source.entityId)) {
      const entity = this.knownEntities.get(flow.source.entityId)!;
      entity.metrics.outflow24h += flow.amountUsd;
      entity.metrics.netFlow24h -= flow.amountUsd;
      entity.lastActive = new Date();
    }

    // Update destination entity
    if (flow.destination && this.knownEntities.has(flow.destination.entityId)) {
      const entity = this.knownEntities.get(flow.destination.entityId)!;
      entity.metrics.inflow24h += flow.amountUsd;
      entity.metrics.netFlow24h += flow.amountUsd;
      entity.lastActive = new Date();
    }
  }

  // ---------------------------------------------------------------------------
  // ENTITY SENTIMENT
  // ---------------------------------------------------------------------------

  /**
   * Calculate entity-based sentiment for a token
   */
  calculateEntitySentiment(token: string): EntitySentiment {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Filter flows for this token in last 24h
    const tokenFlows = this.flows.filter(
      f => f.token.toUpperCase() === token.toUpperCase() && f.timestamp >= oneDayAgo
    );

    // Aggregate by entity type
    const byType: Record<EntityType, { inflow: number; outflow: number; entities: Set<string> }> = {} as any;

    const entityTypes: EntityType[] = [
      'exchange', 'whale', 'smart_money', 'market_maker', 'fund',
      'defi_protocol', 'retail', 'unknown',
    ];

    for (const type of entityTypes) {
      byType[type] = { inflow: 0, outflow: 0, entities: new Set() };
    }

    for (const flow of tokenFlows) {
      // Source (outflow)
      if (flow.source) {
        const type = flow.source.type;
        byType[type].outflow += flow.amountUsd;
        byType[type].entities.add(flow.source.entityId);
      }

      // Destination (inflow)
      if (flow.destination) {
        const type = flow.destination.type;
        byType[type].inflow += flow.amountUsd;
        byType[type].entities.add(flow.destination.entityId);
      }
    }

    // Calculate sentiment per entity type
    const byEntityType: Record<EntityType, EntityTypeSentiment> = {} as any;
    let totalWeightedScore = 0;
    let totalWeight = 0;

    const weights: Partial<Record<EntityType, number>> = {
      smart_money: 0.25,
      whale: 0.20,
      fund: 0.15,
      market_maker: 0.15,
      exchange: 0.15,
      defi_protocol: 0.05,
      retail: 0.05,
    };

    for (const type of entityTypes) {
      const data = byType[type];
      const netFlow = data.inflow - data.outflow;
      const totalFlow = data.inflow + data.outflow;

      // Score based on net flow direction and magnitude
      let score = 0.5; // Neutral
      if (totalFlow > 0) {
        score = 0.5 + (netFlow / totalFlow) * 0.5; // 0 to 1
      }

      const behavior: EntityTypeSentiment['behavior'] =
        netFlow > totalFlow * 0.1 ? 'accumulating' :
        netFlow < -totalFlow * 0.1 ? 'distributing' : 'neutral';

      byEntityType[type] = {
        type,
        score: Math.round(score * 100) / 100,
        netFlow24h: Math.round(netFlow),
        activeEntities: data.entities.size,
        behavior,
      };

      // Weighted aggregate
      const weight = weights[type] || 0;
      totalWeightedScore += score * weight;
      totalWeight += weight;
    }

    // Calculate aggregate
    const aggregateScore = totalWeight > 0 ? totalWeightedScore / totalWeight : 0.5;
    const aggregateDirection: 'bullish' | 'bearish' | 'neutral' =
      aggregateScore > 0.55 ? 'bullish' :
      aggregateScore < 0.45 ? 'bearish' : 'neutral';

    // Generate key signals
    const signals = this.generateEntitySignals(token, tokenFlows);

    const sentiment: EntitySentiment = {
      token: token.toUpperCase(),
      timestamp: now,
      byEntityType,
      aggregate: {
        score: Math.round(aggregateScore * 100) / 100,
        direction: aggregateDirection,
        confidence: Math.min(0.95, 0.5 + tokenFlows.length / 100),
      },
      signals,
    };

    this.entitySentiment.set(token.toUpperCase(), sentiment);
    return sentiment;
  }

  private generateEntitySignals(token: string, flows: OnChainFlow[]): EntitySignal[] {
    const signals: EntitySignal[] = [];

    // Find significant flows
    const significantFlows = flows
      .filter(f => f.amountUsd > 500000)
      .sort((a, b) => b.amountUsd - a.amountUsd)
      .slice(0, 10);

    for (const flow of significantFlows) {
      const entity = flow.destination?.type !== 'unknown' ? flow.destination :
                     flow.source?.type !== 'unknown' ? flow.source : null;

      if (!entity) continue;

      const direction = flow.source?.entityId === entity.entityId ? 'out' : 'in';

      let signalType: EntitySignal['type'] = 'whale_move';
      if (entity.type === 'smart_money' || entity.type === 'fund') {
        signalType = direction === 'in' ? 'smart_money_entry' : 'smart_money_exit';
      } else if (entity.type === 'exchange') {
        signalType = 'exchange_flow';
      } else if (entity.type === 'fresh_wallet') {
        signalType = 'fresh_wallet_activity';
      }

      signals.push({
        signalId: `sig_${flow.flowId}`,
        timestamp: flow.timestamp,
        type: signalType,
        entity,
        token,
        amountUsd: flow.amountUsd,
        direction,
        sentimentImpact: flow.sentimentSignal.direction,
        impactStrength: flow.sentimentSignal.strength,
        description: `${entity.name || entity.entityId} ${direction === 'in' ? 'received' : 'sent'} $${(flow.amountUsd / 1000000).toFixed(2)}M ${token}`,
      });
    }

    return signals;
  }

  // ---------------------------------------------------------------------------
  // UTILITIES
  // ---------------------------------------------------------------------------

  private chainIdToName(chainId: number): string {
    const chains: Record<number, string> = {
      1: 'ethereum',
      56: 'bsc',
      137: 'polygon',
      42161: 'arbitrum',
      10: 'optimism',
      43114: 'avalanche',
      250: 'fantom',
      8453: 'base',
    };
    return chains[chainId] || 'unknown';
  }

  /**
   * Get recent flows
   */
  getRecentFlows(limit: number = 100, token?: string): OnChainFlow[] {
    let flows = this.flows;
    if (token) {
      flows = flows.filter(f => f.token.toUpperCase() === token.toUpperCase());
    }
    return flows.slice(-limit).reverse();
  }

  /**
   * Get exchange net flows
   */
  getExchangeNetFlows(token: string, hours: number = 24): {
    netFlow: number;
    deposits: number;
    withdrawals: number;
    sentiment: 'bullish' | 'bearish' | 'neutral';
  } {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const flows = this.flows.filter(
      f => f.token.toUpperCase() === token.toUpperCase() &&
           f.timestamp >= cutoff &&
           (f.flowType === 'exchange_deposit' || f.flowType === 'exchange_withdrawal')
    );

    let deposits = 0;
    let withdrawals = 0;

    for (const flow of flows) {
      if (flow.flowType === 'exchange_deposit') {
        deposits += flow.amountUsd;
      } else {
        withdrawals += flow.amountUsd;
      }
    }

    const netFlow = withdrawals - deposits; // Positive = bullish (more withdrawals)

    return {
      netFlow,
      deposits,
      withdrawals,
      sentiment: netFlow > deposits * 0.1 ? 'bullish' :
                 netFlow < -withdrawals * 0.1 ? 'bearish' : 'neutral',
    };
  }
}

// =============================================================================
// API ROUTES
// =============================================================================

import { Router, Request, Response } from 'express';

export function createEntityResolutionRoutes(engine: EntityResolutionEngine): Router {
  const router = Router();

  // Resolve address
  router.get('/entities/resolve/:address', (req: Request, res: Response) => {
    const chainId = parseInt(req.query.chain_id as string) || 1;
    const entity = engine.resolveAddress(req.params.address, chainId);

    if (!entity || entity.type === 'unknown') {
      res.json({
        resolved: false,
        address: req.params.address,
        chain_id: chainId,
        entity: null,
      });
      return;
    }

    res.json({
      resolved: true,
      address: req.params.address,
      chain_id: chainId,
      entity: {
        id: entity.entityId,
        type: entity.type,
        name: entity.name,
        labels: entity.labels,
        confidence: entity.confidence,
      },
    });
  });

  // Get all entities
  router.get('/entities', (req: Request, res: Response) => {
    const type = req.query.type as EntityType | undefined;
    const entities = type ? engine.getEntitiesByType(type) : engine.getAllEntities();

    res.json({
      count: entities.length,
      entities: entities.map(e => ({
        id: e.entityId,
        type: e.type,
        name: e.name,
        labels: e.labels,
        confidence: e.confidence,
        metrics: e.metrics,
        last_active: e.lastActive,
      })),
    });
  });

  // Search entities
  router.get('/entities/search', (req: Request, res: Response) => {
    const query = req.query.q as string;
    if (!query) {
      res.status(400).json({ error: { code: 'MISSING_QUERY', message: 'Query parameter q is required' } });
      return;
    }

    const entities = engine.searchEntities(query);
    res.json({
      query,
      count: entities.length,
      entities: entities.map(e => ({
        id: e.entityId,
        type: e.type,
        name: e.name,
        labels: e.labels,
      })),
    });
  });

  // Get entity sentiment
  router.get('/entities/sentiment/:token', (req: Request, res: Response) => {
    const sentiment = engine.calculateEntitySentiment(req.params.token);
    res.json(sentiment);
  });

  // Get exchange flows
  router.get('/entities/flows/exchange/:token', (req: Request, res: Response) => {
    const hours = parseInt(req.query.hours as string) || 24;
    const flows = engine.getExchangeNetFlows(req.params.token, hours);
    res.json({
      token: req.params.token.toUpperCase(),
      period_hours: hours,
      ...flows,
    });
  });

  // Get recent flows
  router.get('/entities/flows', (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const token = req.query.token as string | undefined;
    const flows = engine.getRecentFlows(limit, token);

    res.json({
      count: flows.length,
      flows: flows.map(f => ({
        id: f.flowId,
        timestamp: f.timestamp,
        source: f.source ? { id: f.source.entityId, type: f.source.type, name: f.source.name } : null,
        destination: f.destination ? { id: f.destination.entityId, type: f.destination.type, name: f.destination.name } : null,
        token: f.token,
        amount_usd: f.amountUsd,
        flow_type: f.flowType,
        sentiment: f.sentimentSignal,
        tx_hash: f.txHash,
      })),
    });
  });

  return router;
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  EntityResolutionEngine,
  createEntityResolutionRoutes,
  KNOWN_ENTITIES,
};
