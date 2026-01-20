/**
 * On-Chain Data Source Client
 * Institutional-Grade Cryptocurrency Market Sentiment Analysis
 *
 * Provides:
 * - Whale transaction monitoring
 * - Exchange flow analysis
 * - Smart contract activity
 * - DeFi protocol metrics
 */

import { EventEmitter } from 'events';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

export interface OnChainConfig {
  etherscan?: {
    apiKey: string;
  };
  bscscan?: {
    apiKey: string;
  };
  polygonscan?: {
    apiKey: string;
  };
  arbiscan?: {
    apiKey: string;
  };
  glassnode?: {
    apiKey: string;
  };
  nansen?: {
    apiKey: string;
  };
  dune?: {
    apiKey: string;
  };
  alchemy?: {
    apiKey: string;
    network?: string;
  };
  whaleAlertThresholdUsd?: number;
  pollingIntervalMs?: number;
}

export interface WhaleTransaction {
  id: string;
  hash: string;
  chain: Chain;
  blockNumber: number;
  timestamp: Date;
  from: WalletInfo;
  to: WalletInfo;
  token: TokenInfo;
  amount: number;
  amountUsd: number;
  type: TransactionType;
  sentiment: TransactionSentiment;
}

export interface WalletInfo {
  address: string;
  label?: string;
  type?: WalletType;
  isContract: boolean;
}

export type WalletType =
  | 'exchange'
  | 'whale'
  | 'smart_money'
  | 'fund'
  | 'defi_protocol'
  | 'bridge'
  | 'unknown';

export interface TokenInfo {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  priceUsd?: number;
}

export type Chain = 'ethereum' | 'bsc' | 'polygon' | 'arbitrum' | 'optimism' | 'avalanche' | 'solana';

export type TransactionType =
  | 'exchange_deposit'
  | 'exchange_withdrawal'
  | 'whale_transfer'
  | 'defi_interaction'
  | 'bridge_transfer'
  | 'contract_deployment'
  | 'nft_transfer'
  | 'unknown';

export interface TransactionSentiment {
  signal: 'bullish' | 'bearish' | 'neutral';
  strength: number; // 0-1
  confidence: number; // 0-1
  reasoning: string;
}

export interface ExchangeFlow {
  exchange: string;
  chain: Chain;
  token: string;
  period: string;
  inflow: number;
  outflow: number;
  netFlow: number;
  inflowUsd: number;
  outflowUsd: number;
  netFlowUsd: number;
  transactionCount: number;
  timestamp: Date;
}

export interface OnChainMetrics {
  asset: string;
  chain: Chain;
  timestamp: Date;
  activeAddresses24h: number;
  transactionCount24h: number;
  transactionVolume24h: number;
  transactionVolumeUsd24h: number;
  averageTxValue: number;
  medianTxValue: number;
  newAddresses24h: number;
  exchangeNetFlow24h: number;
  whaleTransactions24h: number;
  defiTvl?: number;
  gasPrice?: number;
}

export interface DefiMetrics {
  protocol: string;
  chain: Chain;
  tvl: number;
  tvlChange24h: number;
  volume24h: number;
  users24h: number;
  transactions24h: number;
  fees24h: number;
  timestamp: Date;
}

// =============================================================================
// ON-CHAIN CLIENT
// =============================================================================

export class OnChainClient extends EventEmitter {
  private config: OnChainConfig;
  private explorerApis: Map<Chain, { baseUrl: string; apiKey?: string }>;
  private knownLabels: Map<string, WalletInfo> = new Map();
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private lastProcessedBlocks: Map<Chain, number> = new Map();

  constructor(config: OnChainConfig) {
    super();
    this.config = {
      whaleAlertThresholdUsd: 1000000, // $1M default
      pollingIntervalMs: 30000, // 30 seconds
      ...config,
    };

    this.explorerApis = new Map([
      ['ethereum', { baseUrl: 'https://api.etherscan.io/api', apiKey: config.etherscan?.apiKey }],
      ['bsc', { baseUrl: 'https://api.bscscan.com/api', apiKey: config.bscscan?.apiKey }],
      ['polygon', { baseUrl: 'https://api.polygonscan.com/api', apiKey: config.polygonscan?.apiKey }],
      ['arbitrum', { baseUrl: 'https://api.arbiscan.io/api', apiKey: config.arbiscan?.apiKey }],
    ]);

    this.initializeKnownLabels();
  }

  // ---------------------------------------------------------------------------
  // WHALE MONITORING
  // ---------------------------------------------------------------------------

  /**
   * Get recent whale transactions
   */
  async getWhaleTransactions(options?: {
    chain?: Chain;
    token?: string;
    minAmountUsd?: number;
    limit?: number;
    startBlock?: number;
  }): Promise<WhaleTransaction[]> {
    const chain = options?.chain || 'ethereum';
    const minAmount = options?.minAmountUsd || this.config.whaleAlertThresholdUsd!;

    // Get recent large transfers
    const transactions = await this.fetchLargeTransfers(chain, {
      token: options?.token,
      startBlock: options?.startBlock,
      limit: options?.limit || 100,
    });

    // Filter by USD value and enrich with labels
    const whaleTransactions: WhaleTransaction[] = [];

    for (const tx of transactions) {
      if ((tx.amountUsd ?? 0) >= minAmount) {
        const enriched = await this.enrichTransaction(tx, chain);
        whaleTransactions.push(enriched);
      }
    }

    return whaleTransactions.sort((a, b) => b.amountUsd - a.amountUsd);
  }

  /**
   * Monitor whale activity in real-time
   */
  startWhaleMonitoring(options?: {
    chains?: Chain[];
    tokens?: string[];
    minAmountUsd?: number;
  }): void {
    if (this.pollingTimer) {
      this.stopWhaleMonitoring();
    }

    const chains = options?.chains || ['ethereum'];
    const minAmount = options?.minAmountUsd || this.config.whaleAlertThresholdUsd!;

    const poll = async () => {
      for (const chain of chains) {
        try {
          const lastBlock = this.lastProcessedBlocks.get(chain);
          const transactions = await this.getWhaleTransactions({
            chain,
            token: options?.tokens?.[0],
            minAmountUsd: minAmount,
            startBlock: lastBlock,
            limit: 50,
          });

          for (const tx of transactions) {
            this.emit('whale_transaction', tx);
          }

          // Update last processed block
          if (transactions.length > 0) {
            const maxBlock = Math.max(...transactions.map(t => t.blockNumber));
            this.lastProcessedBlocks.set(chain, maxBlock);
          }
        } catch (error) {
          this.emit('monitoring_error', { chain, error });
        }
      }
    };

    poll();
    this.pollingTimer = setInterval(poll, this.config.pollingIntervalMs);
    this.emit('monitoring_started', { chains });
  }

  /**
   * Stop whale monitoring
   */
  stopWhaleMonitoring(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
      this.emit('monitoring_stopped');
    }
  }

  // ---------------------------------------------------------------------------
  // EXCHANGE FLOWS
  // ---------------------------------------------------------------------------

  /**
   * Get exchange flow metrics
   */
  async getExchangeFlows(options: {
    token: string;
    chain?: Chain;
    period?: '1h' | '4h' | '24h' | '7d';
  }): Promise<ExchangeFlow[]> {
    const chain = options.chain || 'ethereum';
    const period = options.period || '24h';

    // Get transfers to/from known exchange addresses
    const exchanges = this.getExchangeAddresses(chain);
    const flows: ExchangeFlow[] = [];

    for (const [exchangeName, addresses] of Object.entries(exchanges)) {
      let inflow = 0;
      let outflow = 0;
      let txCount = 0;

      for (const address of addresses) {
        try {
          const transfers = await this.getTokenTransfers(chain, {
            address,
            token: options.token,
            period,
          });

          for (const transfer of transfers) {
            if (transfer.to.toLowerCase() === address.toLowerCase()) {
              inflow += transfer.amountUsd;
              txCount++;
            } else if (transfer.from.toLowerCase() === address.toLowerCase()) {
              outflow += transfer.amountUsd;
              txCount++;
            }
          }
        } catch {
          // Skip failed requests
        }
      }

      if (inflow > 0 || outflow > 0) {
        flows.push({
          exchange: exchangeName,
          chain,
          token: options.token,
          period,
          inflow: inflow / (this.getTokenPrice(options.token) || 1),
          outflow: outflow / (this.getTokenPrice(options.token) || 1),
          netFlow: (outflow - inflow) / (this.getTokenPrice(options.token) || 1),
          inflowUsd: inflow,
          outflowUsd: outflow,
          netFlowUsd: outflow - inflow,
          transactionCount: txCount,
          timestamp: new Date(),
        });
      }
    }

    return flows;
  }

  /**
   * Get aggregated exchange flow sentiment
   */
  async getExchangeFlowSentiment(token: string): Promise<{
    sentiment: 'bullish' | 'bearish' | 'neutral';
    netFlowUsd: number;
    strength: number;
    details: ExchangeFlow[];
  }> {
    const flows = await this.getExchangeFlows({ token, period: '24h' });

    const totalNetFlow = flows.reduce((sum, f) => sum + f.netFlowUsd, 0);

    // Positive net flow = more withdrawals = bullish
    // Negative net flow = more deposits = bearish
    const sentiment: 'bullish' | 'bearish' | 'neutral' =
      totalNetFlow > 1000000 ? 'bullish' :
      totalNetFlow < -1000000 ? 'bearish' : 'neutral';

    const strength = Math.min(1, Math.abs(totalNetFlow) / 10000000); // Scale by $10M

    return {
      sentiment,
      netFlowUsd: totalNetFlow,
      strength,
      details: flows,
    };
  }

  // ---------------------------------------------------------------------------
  // ON-CHAIN METRICS
  // ---------------------------------------------------------------------------

  /**
   * Get on-chain metrics for an asset
   */
  async getOnChainMetrics(asset: string, chain: Chain = 'ethereum'): Promise<OnChainMetrics> {
    const tokenAddress = this.getTokenAddress(asset, chain);

    // Fetch various metrics
    const [
      activeAddresses,
      transactionStats,
      exchangeFlow,
    ] = await Promise.all([
      this.getActiveAddresses(chain, tokenAddress),
      this.getTransactionStats(chain, tokenAddress),
      this.getExchangeFlows({ token: asset, chain, period: '24h' }),
    ]);

    const netExchangeFlow = exchangeFlow.reduce((sum, f) => sum + f.netFlowUsd, 0);

    return {
      asset,
      chain,
      timestamp: new Date(),
      activeAddresses24h: activeAddresses,
      transactionCount24h: transactionStats.count,
      transactionVolume24h: transactionStats.volume,
      transactionVolumeUsd24h: transactionStats.volumeUsd,
      averageTxValue: transactionStats.averageValue,
      medianTxValue: transactionStats.medianValue,
      newAddresses24h: transactionStats.newAddresses,
      exchangeNetFlow24h: netExchangeFlow,
      whaleTransactions24h: transactionStats.whaleCount,
    };
  }

  // ---------------------------------------------------------------------------
  // WALLET ANALYSIS
  // ---------------------------------------------------------------------------

  /**
   * Analyze a wallet address
   */
  async analyzeWallet(address: string, chain: Chain = 'ethereum'): Promise<{
    info: WalletInfo;
    balance: { token: string; amount: number; valueUsd: number }[];
    recentActivity: WhaleTransaction[];
    metrics: {
      totalTransactions: number;
      totalVolumeUsd: number;
      firstSeen: Date;
      lastActive: Date;
    };
  }> {
    const [info, balance, transactions] = await Promise.all([
      this.getWalletInfo(address, chain),
      this.getWalletBalance(address, chain),
      this.getWalletTransactions(address, chain, 50),
    ]);

    const totalVolumeUsd = transactions.reduce((sum, tx) => sum + tx.amountUsd, 0);
    const firstSeen = transactions.length > 0
      ? new Date(Math.min(...transactions.map(t => t.timestamp.getTime())))
      : new Date();
    const lastActive = transactions.length > 0
      ? new Date(Math.max(...transactions.map(t => t.timestamp.getTime())))
      : new Date();

    return {
      info,
      balance,
      recentActivity: transactions.slice(0, 10),
      metrics: {
        totalTransactions: transactions.length,
        totalVolumeUsd,
        firstSeen,
        lastActive,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // PRIVATE METHODS
  // ---------------------------------------------------------------------------

  private async fetchLargeTransfers(
    chain: Chain,
    options: { token?: string; startBlock?: number; limit?: number }
  ): Promise<Partial<WhaleTransaction>[]> {
    const explorer = this.explorerApis.get(chain);
    if (!explorer) throw new Error(`Unsupported chain: ${chain}`);

    const params = new URLSearchParams({
      module: 'account',
      action: options.token ? 'tokentx' : 'txlist',
      sort: 'desc',
      page: '1',
      offset: String(options.limit || 100),
    });

    if (explorer.apiKey) {
      params.set('apikey', explorer.apiKey);
    }
    if (options.startBlock) {
      params.set('startblock', String(options.startBlock));
    }

    // For whale detection, we query known whale addresses
    const whaleAddresses = this.getWhaleAddresses(chain);

    const transactions: Partial<WhaleTransaction>[] = [];

    for (const address of whaleAddresses.slice(0, 5)) {
      try {
        params.set('address', address);
        const response = await fetch(`${explorer.baseUrl}?${params}`);
        const data = await response.json() as { status: string; result?: any[] };

        if (data.status === '1' && data.result) {
          for (const tx of data.result) {
            const amount = parseFloat(tx.value) / Math.pow(10, parseInt(tx.tokenDecimal || '18'));
            const price = this.getTokenPrice(tx.tokenSymbol || 'ETH');
            const amountUsd = amount * (price || 0);

            transactions.push({
              hash: tx.hash,
              chain,
              blockNumber: parseInt(tx.blockNumber),
              timestamp: new Date(parseInt(tx.timeStamp) * 1000),
              from: { address: tx.from, isContract: false },
              to: { address: tx.to, isContract: tx.contractAddress !== '' },
              token: {
                symbol: tx.tokenSymbol || 'ETH',
                name: tx.tokenName || 'Ethereum',
                address: tx.contractAddress || '0x0',
                decimals: parseInt(tx.tokenDecimal || '18'),
                priceUsd: price,
              },
              amount,
              amountUsd,
            });
          }
        }
      } catch {
        // Continue with other addresses
      }

      await this.sleep(200); // Rate limiting
    }

    return transactions;
  }

  private async enrichTransaction(
    tx: Partial<WhaleTransaction>,
    chain: Chain
  ): Promise<WhaleTransaction> {
    // Enrich with labels
    const fromInfo = await this.getWalletInfo(tx.from!.address, chain);
    const toInfo = await this.getWalletInfo(tx.to!.address, chain);

    // Determine transaction type
    const type = this.classifyTransaction(fromInfo, toInfo);

    // Calculate sentiment
    const sentiment = this.calculateTransactionSentiment(type, tx.amountUsd!, fromInfo, toInfo);

    return {
      id: `onchain_${tx.hash}_${Date.now()}`,
      hash: tx.hash!,
      chain,
      blockNumber: tx.blockNumber!,
      timestamp: tx.timestamp!,
      from: fromInfo,
      to: toInfo,
      token: tx.token!,
      amount: tx.amount!,
      amountUsd: tx.amountUsd!,
      type,
      sentiment,
    };
  }

  private async getWalletInfo(address: string, chain: Chain): Promise<WalletInfo> {
    // Check cache first
    const cacheKey = `${chain}:${address.toLowerCase()}`;
    if (this.knownLabels.has(cacheKey)) {
      return this.knownLabels.get(cacheKey)!;
    }

    // Check if it's a contract
    const isContract = await this.isContractAddress(address, chain);

    // Try to identify wallet type
    const type = this.identifyWalletType(address, chain);
    const label = this.getAddressLabel(address, chain);

    const info: WalletInfo = {
      address,
      label,
      type,
      isContract,
    };

    this.knownLabels.set(cacheKey, info);
    return info;
  }

  private async isContractAddress(address: string, chain: Chain): Promise<boolean> {
    const explorer = this.explorerApis.get(chain);
    if (!explorer) return false;

    try {
      const params = new URLSearchParams({
        module: 'proxy',
        action: 'eth_getCode',
        address,
      });
      if (explorer.apiKey) params.set('apikey', explorer.apiKey);

      const response = await fetch(`${explorer.baseUrl}?${params}`);
      const data = await response.json() as { result?: string };

      return !!(data.result && data.result !== '0x');
    } catch {
      return false;
    }
  }

  private identifyWalletType(address: string, chain: Chain): WalletType {
    const lowerAddress = address.toLowerCase();

    // Check exchange addresses
    for (const [, addresses] of Object.entries(this.getExchangeAddresses(chain))) {
      if (addresses.some(a => a.toLowerCase() === lowerAddress)) {
        return 'exchange';
      }
    }

    // Check known whales
    if (this.getWhaleAddresses(chain).some(a => a.toLowerCase() === lowerAddress)) {
      return 'whale';
    }

    // Check DeFi protocols
    if (DEFI_PROTOCOLS[chain]?.some(p => p.addresses.some(a => a.toLowerCase() === lowerAddress))) {
      return 'defi_protocol';
    }

    return 'unknown';
  }

  private getAddressLabel(address: string, chain: Chain): string | undefined {
    const lowerAddress = address.toLowerCase();

    // Check exchanges
    for (const [name, addresses] of Object.entries(this.getExchangeAddresses(chain))) {
      if (addresses.some(a => a.toLowerCase() === lowerAddress)) {
        return name;
      }
    }

    // Check DeFi protocols
    for (const protocol of DEFI_PROTOCOLS[chain] || []) {
      if (protocol.addresses.some(a => a.toLowerCase() === lowerAddress)) {
        return protocol.name;
      }
    }

    return undefined;
  }

  private classifyTransaction(from: WalletInfo, to: WalletInfo): TransactionType {
    if (to.type === 'exchange' && from.type !== 'exchange') {
      return 'exchange_deposit';
    }
    if (from.type === 'exchange' && to.type !== 'exchange') {
      return 'exchange_withdrawal';
    }
    if (from.type === 'whale' || to.type === 'whale') {
      return 'whale_transfer';
    }
    if (from.type === 'defi_protocol' || to.type === 'defi_protocol') {
      return 'defi_interaction';
    }
    if (from.type === 'bridge' || to.type === 'bridge') {
      return 'bridge_transfer';
    }
    return 'unknown';
  }

  private calculateTransactionSentiment(
    type: TransactionType,
    amountUsd: number,
    from: WalletInfo,
    to: WalletInfo
  ): TransactionSentiment {
    const rules: Record<TransactionType, { signal: 'bullish' | 'bearish' | 'neutral'; baseStrength: number; reasoning: string }> = {
      exchange_deposit: {
        signal: 'bearish',
        baseStrength: 0.4,
        reasoning: 'Tokens moved to exchange - potential sell pressure',
      },
      exchange_withdrawal: {
        signal: 'bullish',
        baseStrength: 0.4,
        reasoning: 'Tokens withdrawn from exchange - reduced sell pressure',
      },
      whale_transfer: {
        signal: 'neutral',
        baseStrength: 0.3,
        reasoning: 'Large whale transfer detected',
      },
      defi_interaction: {
        signal: 'neutral',
        baseStrength: 0.2,
        reasoning: 'DeFi protocol interaction',
      },
      bridge_transfer: {
        signal: 'neutral',
        baseStrength: 0.1,
        reasoning: 'Cross-chain bridge transfer',
      },
      contract_deployment: {
        signal: 'neutral',
        baseStrength: 0.1,
        reasoning: 'Smart contract deployment',
      },
      nft_transfer: {
        signal: 'neutral',
        baseStrength: 0.1,
        reasoning: 'NFT transfer',
      },
      unknown: {
        signal: 'neutral',
        baseStrength: 0,
        reasoning: 'Unknown transaction type',
      },
    };

    const rule = rules[type];

    // Scale strength by amount (log scale)
    const amountFactor = Math.min(1, Math.log10(Math.max(1, amountUsd / 100000)) / 3);
    const strength = Math.min(1, rule.baseStrength * (1 + amountFactor));

    // Confidence based on label availability
    let confidence = 0.5;
    if (from.label && to.label) confidence = 0.9;
    else if (from.label || to.label) confidence = 0.7;

    return {
      signal: rule.signal,
      strength,
      confidence,
      reasoning: rule.reasoning,
    };
  }

  private getExchangeAddresses(chain: Chain): Record<string, string[]> {
    return EXCHANGE_ADDRESSES[chain] || {};
  }

  private getWhaleAddresses(chain: Chain): string[] {
    return WHALE_ADDRESSES[chain] || [];
  }

  private getTokenAddress(symbol: string, chain: Chain): string | undefined {
    return TOKEN_ADDRESSES[chain]?.[symbol.toUpperCase()];
  }

  private getTokenPrice(symbol: string): number | undefined {
    // In production, would fetch from price oracle
    const mockPrices: Record<string, number> = {
      'ETH': 3500,
      'BTC': 95000,
      'WETH': 3500,
      'WBTC': 95000,
      'USDT': 1,
      'USDC': 1,
      'DAI': 1,
    };
    return mockPrices[symbol.toUpperCase()];
  }

  private async getActiveAddresses(_chain: Chain, _tokenAddress?: string): Promise<number> {
    // Placeholder - would query from analytics provider
    return Math.floor(Math.random() * 100000) + 50000;
  }

  private async getTransactionStats(_chain: Chain, _tokenAddress?: string): Promise<{
    count: number;
    volume: number;
    volumeUsd: number;
    averageValue: number;
    medianValue: number;
    newAddresses: number;
    whaleCount: number;
  }> {
    // Placeholder - would query from analytics provider
    return {
      count: Math.floor(Math.random() * 500000) + 100000,
      volume: Math.floor(Math.random() * 1000000),
      volumeUsd: Math.floor(Math.random() * 5000000000),
      averageValue: Math.floor(Math.random() * 10000),
      medianValue: Math.floor(Math.random() * 1000),
      newAddresses: Math.floor(Math.random() * 10000),
      whaleCount: Math.floor(Math.random() * 100),
    };
  }

  private async getWalletBalance(
    _address: string,
    _chain: Chain
  ): Promise<{ token: string; amount: number; valueUsd: number }[]> {
    // Placeholder - would query from explorer or Alchemy
    return [];
  }

  private async getWalletTransactions(
    _address: string,
    _chain: Chain,
    _limit: number
  ): Promise<WhaleTransaction[]> {
    // Would query from explorer
    return [];
  }

  private async getTokenTransfers(
    _chain: Chain,
    _options: { address: string; token?: string; period: string }
  ): Promise<{ from: string; to: string; amountUsd: number }[]> {
    // Placeholder
    return [];
  }

  private initializeKnownLabels(): void {
    // Pre-populate with known addresses
    for (const [chain, exchanges] of Object.entries(EXCHANGE_ADDRESSES)) {
      for (const [name, addresses] of Object.entries(exchanges)) {
        for (const address of addresses) {
          this.knownLabels.set(`${chain}:${address.toLowerCase()}`, {
            address,
            label: name,
            type: 'exchange',
            isContract: false,
          });
        }
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================================================
// CONSTANTS
// =============================================================================

const EXCHANGE_ADDRESSES: Record<Chain, Record<string, string[]>> = {
  ethereum: {
    'Binance': [
      '0x28c6c06298d514db089934071355e5743bf21d60',
      '0x21a31ee1afc51d94c2efccaa2092ad1028285549',
    ],
    'Coinbase': [
      '0x71660c4005ba85c37ccec55d0c4493e66fe775d3',
      '0x503828976d22510aad0201ac7ec88293211d23da',
    ],
    'Kraken': [
      '0x2910543af39aba0cd09dbb2d50200b3e800a63d2',
    ],
    'OKX': [
      '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b',
    ],
    'Bitfinex': [
      '0x876eabf441b2ee5b5b0554fd502a8e0600950cfa',
    ],
  },
  bsc: {},
  polygon: {},
  arbitrum: {},
  optimism: {},
  avalanche: {},
  solana: {},
};

const WHALE_ADDRESSES: Record<Chain, string[]> = {
  ethereum: [
    '0x9845e1909dca337944a0272f1f9f7249833d2d19', // Jump Trading
    '0x00000000ae347930bd1e7b0f35588b92280f9e75', // Wintermute
    '0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae', // Ethereum Foundation
  ],
  bsc: [],
  polygon: [],
  arbitrum: [],
  optimism: [],
  avalanche: [],
  solana: [],
};

const DEFI_PROTOCOLS: Record<Chain, { name: string; addresses: string[] }[]> = {
  ethereum: [
    { name: 'Uniswap V3', addresses: ['0x1f98431c8ad98523631ae4a59f267346ea31f984'] },
    { name: 'Aave V3', addresses: ['0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2'] },
    { name: 'Compound', addresses: ['0xc00e94cb662c3520282e6f5717214004a7f26888'] },
    { name: 'Lido', addresses: ['0xae7ab96520de3a18e5e111b5eaab095312d7fe84'] },
  ],
  bsc: [],
  polygon: [],
  arbitrum: [],
  optimism: [],
  avalanche: [],
  solana: [],
};

const TOKEN_ADDRESSES: Record<Chain, Record<string, string>> = {
  ethereum: {
    'WETH': '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    'USDT': '0xdac17f958d2ee523a2206206994597c13d831ec7',
    'USDC': '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    'WBTC': '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
    'DAI': '0x6b175474e89094c44da98b954eedeac495271d0f',
    'LINK': '0x514910771af9ca656af840dff83e8264ecf986ca',
    'UNI': '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
  },
  bsc: {},
  polygon: {},
  arbitrum: {},
  optimism: {},
  avalanche: {},
  solana: {},
};

// =============================================================================
// EXPORTS
// =============================================================================

export default OnChainClient;
