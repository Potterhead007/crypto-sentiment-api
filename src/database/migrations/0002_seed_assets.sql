-- =============================================================================
-- Migration: 0002_seed_assets.sql
-- Description: Seed initial cryptocurrency assets
-- =============================================================================

-- Seed major cryptocurrencies
INSERT INTO assets (symbol, name, asset_type, coingecko_id, metadata, is_active) VALUES
  -- Top 10 by market cap
  ('BTC', 'Bitcoin', 'cryptocurrency', 'bitcoin', '{"category": "layer1", "rank": 1}', true),
  ('ETH', 'Ethereum', 'cryptocurrency', 'ethereum', '{"category": "layer1", "rank": 2}', true),
  ('USDT', 'Tether', 'stablecoin', 'tether', '{"category": "stablecoin", "rank": 3}', true),
  ('BNB', 'BNB', 'cryptocurrency', 'binancecoin', '{"category": "layer1", "rank": 4}', true),
  ('SOL', 'Solana', 'cryptocurrency', 'solana', '{"category": "layer1", "rank": 5}', true),
  ('USDC', 'USD Coin', 'stablecoin', 'usd-coin', '{"category": "stablecoin", "rank": 6}', true),
  ('XRP', 'XRP', 'cryptocurrency', 'ripple', '{"category": "layer1", "rank": 7}', true),
  ('DOGE', 'Dogecoin', 'cryptocurrency', 'dogecoin', '{"category": "meme", "rank": 8}', true),
  ('ADA', 'Cardano', 'cryptocurrency', 'cardano', '{"category": "layer1", "rank": 9}', true),
  ('AVAX', 'Avalanche', 'cryptocurrency', 'avalanche-2', '{"category": "layer1", "rank": 10}', true),

  -- Top 11-25
  ('TRX', 'TRON', 'cryptocurrency', 'tron', '{"category": "layer1", "rank": 11}', true),
  ('DOT', 'Polkadot', 'cryptocurrency', 'polkadot', '{"category": "layer1", "rank": 12}', true),
  ('LINK', 'Chainlink', 'cryptocurrency', 'chainlink', '{"category": "oracle", "rank": 13}', true),
  ('MATIC', 'Polygon', 'cryptocurrency', 'matic-network', '{"category": "layer2", "rank": 14}', true),
  ('TON', 'Toncoin', 'cryptocurrency', 'the-open-network', '{"category": "layer1", "rank": 15}', true),
  ('SHIB', 'Shiba Inu', 'cryptocurrency', 'shiba-inu', '{"category": "meme", "rank": 16}', true),
  ('ICP', 'Internet Computer', 'cryptocurrency', 'internet-computer', '{"category": "layer1", "rank": 17}', true),
  ('DAI', 'Dai', 'stablecoin', 'dai', '{"category": "stablecoin", "rank": 18}', true),
  ('LTC', 'Litecoin', 'cryptocurrency', 'litecoin', '{"category": "layer1", "rank": 19}', true),
  ('BCH', 'Bitcoin Cash', 'cryptocurrency', 'bitcoin-cash', '{"category": "layer1", "rank": 20}', true),
  ('UNI', 'Uniswap', 'token', 'uniswap', '{"category": "defi", "rank": 21}', true),
  ('ATOM', 'Cosmos', 'cryptocurrency', 'cosmos', '{"category": "layer1", "rank": 22}', true),
  ('ETC', 'Ethereum Classic', 'cryptocurrency', 'ethereum-classic', '{"category": "layer1", "rank": 23}', true),
  ('XLM', 'Stellar', 'cryptocurrency', 'stellar', '{"category": "layer1", "rank": 24}', true),
  ('XMR', 'Monero', 'cryptocurrency', 'monero', '{"category": "privacy", "rank": 25}', true),

  -- DeFi tokens
  ('AAVE', 'Aave', 'token', 'aave', '{"category": "defi", "rank": 30}', true),
  ('MKR', 'Maker', 'token', 'maker', '{"category": "defi", "rank": 35}', true),
  ('CRV', 'Curve DAO Token', 'token', 'curve-dao-token', '{"category": "defi", "rank": 40}', true),
  ('SNX', 'Synthetix', 'token', 'havven', '{"category": "defi", "rank": 50}', true),
  ('COMP', 'Compound', 'token', 'compound-governance-token', '{"category": "defi", "rank": 55}', true),
  ('SUSHI', 'SushiSwap', 'token', 'sushi', '{"category": "defi", "rank": 60}', true),
  ('YFI', 'yearn.finance', 'token', 'yearn-finance', '{"category": "defi", "rank": 65}', true),
  ('1INCH', '1inch', 'token', '1inch', '{"category": "defi", "rank": 70}', true),
  ('BAL', 'Balancer', 'token', 'balancer', '{"category": "defi", "rank": 75}', true),
  ('LDO', 'Lido DAO', 'token', 'lido-dao', '{"category": "defi", "rank": 28}', true),

  -- Layer 2 tokens
  ('ARB', 'Arbitrum', 'token', 'arbitrum', '{"category": "layer2", "rank": 32}', true),
  ('OP', 'Optimism', 'token', 'optimism', '{"category": "layer2", "rank": 38}', true),
  ('IMX', 'Immutable', 'token', 'immutable-x', '{"category": "layer2", "rank": 45}', true),
  ('STRK', 'Starknet', 'token', 'starknet', '{"category": "layer2", "rank": 48}', true),

  -- AI & Gaming tokens
  ('FET', 'Fetch.ai', 'token', 'fetch-ai', '{"category": "ai", "rank": 42}', true),
  ('RNDR', 'Render', 'token', 'render-token', '{"category": "ai", "rank": 44}', true),
  ('AGIX', 'SingularityNET', 'token', 'singularitynet', '{"category": "ai", "rank": 80}', true),
  ('AXS', 'Axie Infinity', 'token', 'axie-infinity', '{"category": "gaming", "rank": 85}', true),
  ('SAND', 'The Sandbox', 'token', 'the-sandbox', '{"category": "gaming", "rank": 90}', true),
  ('MANA', 'Decentraland', 'token', 'decentraland', '{"category": "gaming", "rank": 95}', true),
  ('GALA', 'Gala', 'token', 'gala', '{"category": "gaming", "rank": 100}', true),

  -- Infrastructure tokens
  ('FIL', 'Filecoin', 'cryptocurrency', 'filecoin', '{"category": "storage", "rank": 33}', true),
  ('AR', 'Arweave', 'cryptocurrency', 'arweave', '{"category": "storage", "rank": 52}', true),
  ('GRT', 'The Graph', 'token', 'the-graph', '{"category": "indexing", "rank": 47}', true),
  ('THETA', 'Theta Network', 'cryptocurrency', 'theta-token', '{"category": "video", "rank": 58}', true),

  -- Exchange tokens
  ('CRO', 'Cronos', 'token', 'crypto-com-chain', '{"category": "exchange", "rank": 26}', true),
  ('OKB', 'OKB', 'token', 'okb', '{"category": "exchange", "rank": 27}', true),
  ('LEO', 'UNUS SED LEO', 'token', 'leo-token', '{"category": "exchange", "rank": 29}', true),
  ('KCS', 'KuCoin Token', 'token', 'kucoin-shares', '{"category": "exchange", "rank": 62}', true),

  -- Wrapped tokens
  ('WBTC', 'Wrapped Bitcoin', 'token', 'wrapped-bitcoin', '{"category": "wrapped", "rank": 15}', true),
  ('WETH', 'Wrapped Ether', 'token', 'weth', '{"category": "wrapped", "rank": 20}', true),
  ('STETH', 'Lido Staked Ether', 'token', 'staked-ether', '{"category": "liquid_staking", "rank": 10}', true),

  -- Meme coins
  ('PEPE', 'Pepe', 'token', 'pepe', '{"category": "meme", "rank": 36}', true),
  ('WIF', 'dogwifhat', 'token', 'dogwifcoin', '{"category": "meme", "rank": 41}', true),
  ('FLOKI', 'FLOKI', 'token', 'floki', '{"category": "meme", "rank": 68}', true),
  ('BONK', 'Bonk', 'token', 'bonk', '{"category": "meme", "rank": 72}', true)

ON CONFLICT (symbol) DO UPDATE SET
  name = EXCLUDED.name,
  asset_type = EXCLUDED.asset_type,
  coingecko_id = EXCLUDED.coingecko_id,
  metadata = EXCLUDED.metadata,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();
