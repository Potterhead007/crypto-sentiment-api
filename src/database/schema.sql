-- =============================================================================
-- TimescaleDB Schema for Crypto Sentiment API
-- Institutional-Grade Cryptocurrency Market Sentiment Analysis
-- =============================================================================

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- For text search
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- ENUM TYPES
-- =============================================================================

CREATE TYPE sentiment_label AS ENUM (
  'very_bearish', 'bearish', 'neutral', 'bullish', 'very_bullish'
);

CREATE TYPE data_source AS ENUM (
  'twitter', 'reddit', 'discord', 'telegram', 'news', 'blog', 'forum', 'onchain'
);

CREATE TYPE subscription_tier AS ENUM (
  'professional', 'institutional', 'enterprise', 'strategic'
);

CREATE TYPE incident_status AS ENUM (
  'investigating', 'identified', 'monitoring', 'resolved'
);

CREATE TYPE flow_type AS ENUM (
  'exchange_deposit', 'exchange_withdrawal', 'whale_accumulation',
  'whale_distribution', 'smart_money_buy', 'smart_money_sell',
  'defi_deposit', 'defi_withdrawal', 'bridge_transfer', 'internal_transfer', 'unknown'
);

-- =============================================================================
-- CORE TABLES
-- =============================================================================

-- Assets master table
CREATE TABLE assets (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50),  -- e.g., 'layer1', 'defi', 'meme', 'stablecoin'
  market_cap_rank INTEGER,
  coingecko_id VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_assets_symbol ON assets(symbol);
CREATE INDEX idx_assets_category ON assets(category);

-- =============================================================================
-- SENTIMENT TIME-SERIES TABLES
-- =============================================================================

-- Raw sentiment scores (high-frequency, per-source)
CREATE TABLE sentiment_raw (
  time TIMESTAMPTZ NOT NULL,
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  source data_source NOT NULL,
  score DECIMAL(5,4) NOT NULL,  -- -1.0000 to 1.0000
  confidence DECIMAL(4,3) NOT NULL,  -- 0.000 to 1.000
  volume INTEGER DEFAULT 1,
  metadata JSONB DEFAULT '{}'::jsonb,
  PRIMARY KEY (time, asset_id, source)
);

-- Convert to hypertable (TimescaleDB)
SELECT create_hypertable('sentiment_raw', 'time', chunk_time_interval => INTERVAL '1 day');

-- Compression policy (compress after 7 days)
ALTER TABLE sentiment_raw SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'asset_id, source'
);
SELECT add_compression_policy('sentiment_raw', INTERVAL '7 days');

-- Retention policy (keep 2 years of raw data)
SELECT add_retention_policy('sentiment_raw', INTERVAL '730 days');

-- Aggregated sentiment (per-asset, per-interval)
CREATE TABLE sentiment_aggregated (
  time TIMESTAMPTZ NOT NULL,
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  interval VARCHAR(10) NOT NULL,  -- '1m', '5m', '15m', '1h', '4h', '1d'

  -- Core sentiment metrics
  score DECIMAL(5,4) NOT NULL,
  score_normalized DECIMAL(4,3) NOT NULL,  -- 0-1 scale
  label sentiment_label NOT NULL,
  confidence DECIMAL(4,3) NOT NULL,
  confidence_lower DECIMAL(5,4),
  confidence_upper DECIMAL(5,4),

  -- Volume metrics
  total_mentions INTEGER NOT NULL,
  unique_sources INTEGER NOT NULL,

  -- Source breakdown
  twitter_score DECIMAL(5,4),
  twitter_volume INTEGER,
  reddit_score DECIMAL(5,4),
  reddit_volume INTEGER,
  news_score DECIMAL(5,4),
  news_volume INTEGER,
  onchain_score DECIMAL(5,4),
  onchain_volume INTEGER,

  -- Momentum indicators
  momentum_1h DECIMAL(5,4),
  momentum_4h DECIMAL(5,4),
  momentum_24h DECIMAL(5,4),

  -- Emotion breakdown
  fear DECIMAL(4,3),
  greed DECIMAL(4,3),
  uncertainty DECIMAL(4,3),

  -- Model info
  model_version VARCHAR(20),

  PRIMARY KEY (time, asset_id, interval)
);

SELECT create_hypertable('sentiment_aggregated', 'time', chunk_time_interval => INTERVAL '1 day');

ALTER TABLE sentiment_aggregated SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'asset_id, interval'
);
SELECT add_compression_policy('sentiment_aggregated', INTERVAL '30 days');
SELECT add_retention_policy('sentiment_aggregated', INTERVAL '1825 days');  -- 5 years

-- Indexes for common queries
CREATE INDEX idx_sentiment_agg_asset_time ON sentiment_aggregated(asset_id, time DESC);
CREATE INDEX idx_sentiment_agg_interval ON sentiment_aggregated(interval, time DESC);

-- =============================================================================
-- CONTINUOUS AGGREGATES (Materialized Views)
-- =============================================================================

-- 1-minute aggregates from raw data
CREATE MATERIALIZED VIEW sentiment_1m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 minute', time) AS bucket,
  asset_id,
  AVG(score) AS avg_score,
  AVG(confidence) AS avg_confidence,
  SUM(volume) AS total_volume,
  COUNT(DISTINCT source) AS source_count
FROM sentiment_raw
GROUP BY bucket, asset_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('sentiment_1m',
  start_offset => INTERVAL '1 hour',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute'
);

-- 1-hour aggregates
CREATE MATERIALIZED VIEW sentiment_1h
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', time) AS bucket,
  asset_id,
  AVG(score) AS avg_score,
  AVG(confidence) AS avg_confidence,
  SUM(volume) AS total_volume,
  COUNT(DISTINCT source) AS source_count,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY score) AS median_score
FROM sentiment_raw
GROUP BY bucket, asset_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('sentiment_1h',
  start_offset => INTERVAL '24 hours',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour'
);

-- Daily aggregates
CREATE MATERIALIZED VIEW sentiment_1d
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', time) AS bucket,
  asset_id,
  AVG(score) AS avg_score,
  MIN(score) AS min_score,
  MAX(score) AS max_score,
  AVG(confidence) AS avg_confidence,
  SUM(volume) AS total_volume,
  STDDEV(score) AS score_stddev
FROM sentiment_raw
GROUP BY bucket, asset_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('sentiment_1d',
  start_offset => INTERVAL '7 days',
  end_offset => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 day'
);

-- =============================================================================
-- ON-CHAIN DATA TABLES
-- =============================================================================

-- Entities (exchanges, whales, protocols)
CREATE TABLE entities (
  id SERIAL PRIMARY KEY,
  entity_id VARCHAR(100) NOT NULL UNIQUE,
  type VARCHAR(50) NOT NULL,
  name VARCHAR(200),
  labels TEXT[],
  confidence VARCHAR(20),
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_active TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_entities_type ON entities(type);
CREATE INDEX idx_entities_name ON entities USING gin(name gin_trgm_ops);

-- Wallet addresses
CREATE TABLE wallet_addresses (
  id SERIAL PRIMARY KEY,
  address VARCHAR(100) NOT NULL,
  chain VARCHAR(20) NOT NULL,
  entity_id INTEGER REFERENCES entities(id),
  is_contract BOOLEAN DEFAULT FALSE,
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_active TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(address, chain)
);

CREATE INDEX idx_wallets_address ON wallet_addresses(address);
CREATE INDEX idx_wallets_entity ON wallet_addresses(entity_id);

-- On-chain flows
CREATE TABLE onchain_flows (
  time TIMESTAMPTZ NOT NULL,
  flow_id VARCHAR(100) NOT NULL,
  chain VARCHAR(20) NOT NULL,
  tx_hash VARCHAR(100) NOT NULL,
  source_address VARCHAR(100) NOT NULL,
  dest_address VARCHAR(100) NOT NULL,
  source_entity_id INTEGER REFERENCES entities(id),
  dest_entity_id INTEGER REFERENCES entities(id),
  token VARCHAR(20) NOT NULL,
  amount DECIMAL(30,10) NOT NULL,
  amount_usd DECIMAL(20,2) NOT NULL,
  flow_type flow_type NOT NULL,
  sentiment_signal VARCHAR(20),
  sentiment_strength DECIMAL(4,3),
  sentiment_confidence DECIMAL(4,3),
  PRIMARY KEY (time, flow_id)
);

SELECT create_hypertable('onchain_flows', 'time', chunk_time_interval => INTERVAL '1 day');

CREATE INDEX idx_flows_token ON onchain_flows(token, time DESC);
CREATE INDEX idx_flows_type ON onchain_flows(flow_type, time DESC);
CREATE INDEX idx_flows_amount ON onchain_flows(amount_usd DESC) WHERE amount_usd > 1000000;

-- Exchange flow aggregates
CREATE TABLE exchange_flows_agg (
  time TIMESTAMPTZ NOT NULL,
  exchange VARCHAR(50) NOT NULL,
  token VARCHAR(20) NOT NULL,
  chain VARCHAR(20) NOT NULL,
  period VARCHAR(10) NOT NULL,
  inflow_amount DECIMAL(30,10),
  outflow_amount DECIMAL(30,10),
  net_flow_amount DECIMAL(30,10),
  inflow_usd DECIMAL(20,2),
  outflow_usd DECIMAL(20,2),
  net_flow_usd DECIMAL(20,2),
  transaction_count INTEGER,
  PRIMARY KEY (time, exchange, token, chain, period)
);

SELECT create_hypertable('exchange_flows_agg', 'time', chunk_time_interval => INTERVAL '1 day');

-- =============================================================================
-- CLIENT & API TABLES
-- =============================================================================

-- API clients
CREATE TABLE clients (
  id SERIAL PRIMARY KEY,
  client_id UUID DEFAULT uuid_generate_v4() UNIQUE,
  organization VARCHAR(200) NOT NULL,
  tier subscription_tier NOT NULL DEFAULT 'professional',
  email VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  settings JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- API keys
CREATE TABLE api_keys (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  key_hash VARCHAR(100) NOT NULL UNIQUE,  -- Store hashed keys only
  key_prefix VARCHAR(20) NOT NULL,  -- First few chars for identification
  name VARCHAR(100),
  scopes TEXT[] DEFAULT ARRAY['read'],
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  usage_count BIGINT DEFAULT 0
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash) WHERE is_active = TRUE;
CREATE INDEX idx_api_keys_client ON api_keys(client_id);

-- API usage tracking
CREATE TABLE api_usage (
  time TIMESTAMPTZ NOT NULL,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  endpoint VARCHAR(200) NOT NULL,
  method VARCHAR(10) NOT NULL,
  status_code INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  request_size INTEGER,
  response_size INTEGER,
  PRIMARY KEY (time, client_id, endpoint)
);

SELECT create_hypertable('api_usage', 'time', chunk_time_interval => INTERVAL '1 day');
SELECT add_retention_policy('api_usage', INTERVAL '90 days');

-- =============================================================================
-- AUDIT & COMPLIANCE TABLES
-- =============================================================================

-- Audit log
CREATE TABLE audit_log (
  time TIMESTAMPTZ NOT NULL,
  event_id UUID DEFAULT uuid_generate_v4(),
  event_type VARCHAR(50) NOT NULL,
  actor_type VARCHAR(20) NOT NULL,
  actor_id VARCHAR(100),
  client_id INTEGER REFERENCES clients(id),
  ip_address INET,
  user_agent TEXT,
  resource_type VARCHAR(50),
  resource_id VARCHAR(100),
  action VARCHAR(50) NOT NULL,
  outcome VARCHAR(20) NOT NULL,
  details JSONB,
  chain_hash VARCHAR(64),  -- For tamper detection
  PRIMARY KEY (time, event_id)
);

SELECT create_hypertable('audit_log', 'time', chunk_time_interval => INTERVAL '1 day');
SELECT add_retention_policy('audit_log', INTERVAL '2555 days');  -- 7 years for compliance

CREATE INDEX idx_audit_client ON audit_log(client_id, time DESC);
CREATE INDEX idx_audit_type ON audit_log(event_type, time DESC);

-- =============================================================================
-- ALERT TABLES
-- =============================================================================

-- Alert configurations
CREATE TABLE alert_configs (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  name VARCHAR(100) NOT NULL,
  asset_id INTEGER REFERENCES assets(id),
  condition_type VARCHAR(50) NOT NULL,  -- 'threshold', 'change', 'anomaly'
  condition_params JSONB NOT NULL,
  notification_channels TEXT[] NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  cooldown_minutes INTEGER DEFAULT 60,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Alert history
CREATE TABLE alert_history (
  time TIMESTAMPTZ NOT NULL,
  alert_config_id INTEGER NOT NULL REFERENCES alert_configs(id),
  triggered_value DECIMAL(10,4),
  threshold_value DECIMAL(10,4),
  message TEXT,
  notification_sent BOOLEAN DEFAULT FALSE,
  acknowledged_at TIMESTAMPTZ,
  PRIMARY KEY (time, alert_config_id)
);

SELECT create_hypertable('alert_history', 'time', chunk_time_interval => INTERVAL '1 day');

-- =============================================================================
-- STATUS & MONITORING TABLES
-- =============================================================================

-- Service status
CREATE TABLE service_status (
  time TIMESTAMPTZ NOT NULL,
  component VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  latency_ms INTEGER,
  error_rate DECIMAL(5,4),
  details JSONB,
  PRIMARY KEY (time, component)
);

SELECT create_hypertable('service_status', 'time', chunk_time_interval => INTERVAL '1 hour');
SELECT add_retention_policy('service_status', INTERVAL '30 days');

-- Incidents
CREATE TABLE incidents (
  id SERIAL PRIMARY KEY,
  incident_id UUID DEFAULT uuid_generate_v4() UNIQUE,
  title VARCHAR(200) NOT NULL,
  status incident_status NOT NULL DEFAULT 'investigating',
  severity VARCHAR(20) NOT NULL,
  affected_components TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Incident updates
CREATE TABLE incident_updates (
  id SERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES incidents(id),
  status incident_status NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by VARCHAR(100)
);

-- =============================================================================
-- FUNCTIONS & TRIGGERS
-- =============================================================================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_assets_timestamp
  BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_clients_timestamp
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_alert_configs_timestamp
  BEFORE UPDATE ON alert_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Function to get latest sentiment for an asset
CREATE OR REPLACE FUNCTION get_latest_sentiment(p_symbol VARCHAR)
RETURNS TABLE (
  asset_symbol VARCHAR,
  score DECIMAL,
  label sentiment_label,
  confidence DECIMAL,
  volume INTEGER,
  timestamp TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.symbol,
    sa.score,
    sa.label,
    sa.confidence,
    sa.total_mentions,
    sa.time
  FROM sentiment_aggregated sa
  JOIN assets a ON a.id = sa.asset_id
  WHERE a.symbol = p_symbol
    AND sa.interval = '1h'
  ORDER BY sa.time DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function to get sentiment history
CREATE OR REPLACE FUNCTION get_sentiment_history(
  p_symbol VARCHAR,
  p_interval VARCHAR,
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ
)
RETURNS TABLE (
  time TIMESTAMPTZ,
  score DECIMAL,
  label sentiment_label,
  confidence DECIMAL,
  volume INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    sa.time,
    sa.score,
    sa.label,
    sa.confidence,
    sa.total_mentions
  FROM sentiment_aggregated sa
  JOIN assets a ON a.id = sa.asset_id
  WHERE a.symbol = p_symbol
    AND sa.interval = p_interval
    AND sa.time >= p_start
    AND sa.time <= p_end
  ORDER BY sa.time ASC;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- INITIAL DATA
-- =============================================================================

-- Insert major crypto assets
INSERT INTO assets (symbol, name, category, market_cap_rank) VALUES
  ('BTC', 'Bitcoin', 'layer1', 1),
  ('ETH', 'Ethereum', 'layer1', 2),
  ('BNB', 'BNB', 'layer1', 3),
  ('SOL', 'Solana', 'layer1', 4),
  ('XRP', 'XRP', 'layer1', 5),
  ('ADA', 'Cardano', 'layer1', 6),
  ('DOGE', 'Dogecoin', 'meme', 7),
  ('AVAX', 'Avalanche', 'layer1', 8),
  ('DOT', 'Polkadot', 'layer1', 9),
  ('LINK', 'Chainlink', 'oracle', 10),
  ('MATIC', 'Polygon', 'layer2', 11),
  ('UNI', 'Uniswap', 'defi', 12),
  ('ATOM', 'Cosmos', 'layer1', 13),
  ('LTC', 'Litecoin', 'layer1', 14),
  ('ARB', 'Arbitrum', 'layer2', 15),
  ('OP', 'Optimism', 'layer2', 16),
  ('APT', 'Aptos', 'layer1', 17),
  ('SUI', 'Sui', 'layer1', 18),
  ('NEAR', 'NEAR Protocol', 'layer1', 19),
  ('FTM', 'Fantom', 'layer1', 20),
  ('AAVE', 'Aave', 'defi', 21),
  ('MKR', 'Maker', 'defi', 22),
  ('INJ', 'Injective', 'defi', 23),
  ('USDT', 'Tether', 'stablecoin', NULL),
  ('USDC', 'USD Coin', 'stablecoin', NULL),
  ('DAI', 'Dai', 'stablecoin', NULL)
ON CONFLICT (symbol) DO NOTHING;

-- Insert known entities
INSERT INTO entities (entity_id, type, name, labels, confidence) VALUES
  ('binance', 'exchange', 'Binance', ARRAY['CEX', 'Major Exchange'], 'high'),
  ('coinbase', 'exchange', 'Coinbase', ARRAY['CEX', 'US Exchange', 'Public'], 'high'),
  ('kraken', 'exchange', 'Kraken', ARRAY['CEX', 'US Exchange'], 'high'),
  ('uniswap_v3', 'defi_protocol', 'Uniswap V3', ARRAY['DEX', 'AMM'], 'high'),
  ('aave_v3', 'defi_protocol', 'Aave V3', ARRAY['Lending', 'DeFi'], 'high'),
  ('jump_trading', 'smart_money', 'Jump Trading', ARRAY['Market Maker', 'Institutional'], 'high'),
  ('wintermute', 'market_maker', 'Wintermute', ARRAY['Market Maker', 'Smart Money'], 'high')
ON CONFLICT (entity_id) DO NOTHING;

-- =============================================================================
-- GRANTS (adjust roles as needed)
-- =============================================================================

-- Read-only role for API
-- CREATE ROLE api_read;
-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO api_read;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO api_read;

-- Write role for ingestion
-- CREATE ROLE api_write;
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO api_write;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO api_write;
