-- Migration: Initial Schema
-- Created: 2024-01-15
-- Description: Initial TimescaleDB schema for Crypto Sentiment API

-- =============================================================================
-- Extensions
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- Core Tables
-- =============================================================================

-- Assets (cryptocurrencies, tokens, etc.)
CREATE TABLE IF NOT EXISTS assets (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100),
  asset_type VARCHAR(50) DEFAULT 'cryptocurrency',
  coingecko_id VARCHAR(100),
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assets_symbol ON assets(symbol);
CREATE INDEX IF NOT EXISTS idx_assets_coingecko_id ON assets(coingecko_id) WHERE coingecko_id IS NOT NULL;

-- Entities (exchanges, protocols, influencers, etc.)
CREATE TABLE IF NOT EXISTS entities (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  aliases TEXT[],
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entities_name_trgm ON entities USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);

-- =============================================================================
-- Sentiment Data (Hypertables)
-- =============================================================================

-- Raw sentiment data
CREATE TABLE IF NOT EXISTS sentiment_raw (
  time TIMESTAMPTZ NOT NULL,
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  source VARCHAR(50) NOT NULL,
  sentiment_score FLOAT NOT NULL,
  magnitude FLOAT NOT NULL DEFAULT 0,
  confidence_score FLOAT NOT NULL,
  confidence_lower FLOAT,
  confidence_upper FLOAT,
  emotion_fear FLOAT DEFAULT 0,
  emotion_greed FLOAT DEFAULT 0,
  emotion_uncertainty FLOAT DEFAULT 0,
  emotion_optimism FLOAT DEFAULT 0,
  emotion_anger FLOAT DEFAULT 0,
  emotion_excitement FLOAT DEFAULT 0,
  entities TEXT[],
  raw_text TEXT,
  metadata JSONB DEFAULT '{}',
  source_id VARCHAR(200)
);

SELECT create_hypertable('sentiment_raw', 'time',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_sentiment_raw_asset_time ON sentiment_raw(asset_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_sentiment_raw_source ON sentiment_raw(source, time DESC);

-- Aggregated sentiment (1 minute)
CREATE TABLE IF NOT EXISTS sentiment_aggregated_1m (
  time TIMESTAMPTZ NOT NULL,
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  source VARCHAR(50) NOT NULL,
  sentiment_score FLOAT NOT NULL,
  magnitude FLOAT NOT NULL DEFAULT 0,
  confidence_score FLOAT NOT NULL,
  mention_count INTEGER NOT NULL DEFAULT 0,
  positive_count INTEGER NOT NULL DEFAULT 0,
  negative_count INTEGER NOT NULL DEFAULT 0,
  neutral_count INTEGER NOT NULL DEFAULT 0,
  avg_emotion_fear FLOAT DEFAULT 0,
  avg_emotion_greed FLOAT DEFAULT 0,
  avg_emotion_uncertainty FLOAT DEFAULT 0,
  avg_emotion_optimism FLOAT DEFAULT 0,
  PRIMARY KEY (time, asset_id, source)
);

SELECT create_hypertable('sentiment_aggregated_1m', 'time',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE
);

-- =============================================================================
-- Continuous Aggregates
-- =============================================================================

-- Hourly aggregate
CREATE MATERIALIZED VIEW IF NOT EXISTS sentiment_aggregated_1h
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', time) AS time,
  asset_id,
  source,
  AVG(sentiment_score) AS sentiment_score,
  AVG(magnitude) AS magnitude,
  AVG(confidence_score) AS confidence_score,
  SUM(mention_count) AS mention_count,
  SUM(positive_count) AS positive_count,
  SUM(negative_count) AS negative_count,
  SUM(neutral_count) AS neutral_count,
  AVG(avg_emotion_fear) AS avg_emotion_fear,
  AVG(avg_emotion_greed) AS avg_emotion_greed,
  AVG(avg_emotion_uncertainty) AS avg_emotion_uncertainty,
  AVG(avg_emotion_optimism) AS avg_emotion_optimism
FROM sentiment_aggregated_1m
GROUP BY time_bucket('1 hour', time), asset_id, source
WITH NO DATA;

SELECT add_continuous_aggregate_policy('sentiment_aggregated_1h',
  start_offset => INTERVAL '3 hours',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE
);

-- Daily aggregate
CREATE MATERIALIZED VIEW IF NOT EXISTS sentiment_aggregated_1d
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', time) AS time,
  asset_id,
  source,
  AVG(sentiment_score) AS sentiment_score,
  AVG(magnitude) AS magnitude,
  AVG(confidence_score) AS confidence_score,
  SUM(mention_count) AS mention_count,
  SUM(positive_count) AS positive_count,
  SUM(negative_count) AS negative_count,
  SUM(neutral_count) AS neutral_count
FROM sentiment_aggregated_1m
GROUP BY time_bucket('1 day', time), asset_id, source
WITH NO DATA;

SELECT add_continuous_aggregate_policy('sentiment_aggregated_1d',
  start_offset => INTERVAL '3 days',
  end_offset => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 day',
  if_not_exists => TRUE
);

-- =============================================================================
-- On-chain Data
-- =============================================================================

CREATE TABLE IF NOT EXISTS onchain_flows (
  time TIMESTAMPTZ NOT NULL,
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  chain VARCHAR(50) NOT NULL,
  transaction_type VARCHAR(50) NOT NULL,
  from_address VARCHAR(100),
  to_address VARCHAR(100),
  value_usd NUMERIC(20, 2),
  sentiment_impact FLOAT,
  metadata JSONB DEFAULT '{}'
);

SELECT create_hypertable('onchain_flows', 'time',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_onchain_flows_asset ON onchain_flows(asset_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_onchain_flows_type ON onchain_flows(transaction_type, time DESC);

-- =============================================================================
-- Client & Authentication
-- =============================================================================

CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  tier VARCHAR(50) NOT NULL DEFAULT 'free',
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
CREATE INDEX IF NOT EXISTS idx_clients_tier ON clients(tier);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  key_hash VARCHAR(128) NOT NULL,
  key_prefix VARCHAR(12) NOT NULL,
  name VARCHAR(100),
  scopes TEXT[] DEFAULT '{}',
  rate_limit_override INTEGER,
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_client ON api_keys(client_id);

-- =============================================================================
-- Audit & Logging
-- =============================================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL,
  time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  client_id UUID REFERENCES clients(id),
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(100),
  resource_id VARCHAR(200),
  ip_address INET,
  user_agent TEXT,
  request_id UUID,
  metadata JSONB DEFAULT '{}',
  PRIMARY KEY (time, id)
);

SELECT create_hypertable('audit_log', 'time',
  chunk_time_interval => INTERVAL '1 week',
  if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_audit_log_client ON audit_log(client_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action, time DESC);

-- =============================================================================
-- Compression Policies
-- =============================================================================

ALTER TABLE sentiment_raw SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'asset_id, source'
);

SELECT add_compression_policy('sentiment_raw', INTERVAL '7 days', if_not_exists => TRUE);

ALTER TABLE sentiment_aggregated_1m SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'asset_id, source'
);

SELECT add_compression_policy('sentiment_aggregated_1m', INTERVAL '30 days', if_not_exists => TRUE);

ALTER TABLE onchain_flows SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'asset_id, chain'
);

SELECT add_compression_policy('onchain_flows', INTERVAL '7 days', if_not_exists => TRUE);

ALTER TABLE audit_log SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'client_id'
);

SELECT add_compression_policy('audit_log', INTERVAL '30 days', if_not_exists => TRUE);

-- =============================================================================
-- Retention Policies
-- =============================================================================

SELECT add_retention_policy('sentiment_raw', INTERVAL '90 days', if_not_exists => TRUE);
SELECT add_retention_policy('sentiment_aggregated_1m', INTERVAL '365 days', if_not_exists => TRUE);
SELECT add_retention_policy('audit_log', INTERVAL '730 days', if_not_exists => TRUE);

-- =============================================================================
-- Seed Data
-- =============================================================================

INSERT INTO assets (symbol, name, asset_type, coingecko_id) VALUES
  ('BTC', 'Bitcoin', 'cryptocurrency', 'bitcoin'),
  ('ETH', 'Ethereum', 'cryptocurrency', 'ethereum'),
  ('BNB', 'BNB', 'cryptocurrency', 'binancecoin'),
  ('XRP', 'XRP', 'cryptocurrency', 'ripple'),
  ('ADA', 'Cardano', 'cryptocurrency', 'cardano'),
  ('SOL', 'Solana', 'cryptocurrency', 'solana'),
  ('DOGE', 'Dogecoin', 'cryptocurrency', 'dogecoin'),
  ('DOT', 'Polkadot', 'cryptocurrency', 'polkadot'),
  ('MATIC', 'Polygon', 'cryptocurrency', 'matic-network'),
  ('AVAX', 'Avalanche', 'cryptocurrency', 'avalanche-2'),
  ('LINK', 'Chainlink', 'cryptocurrency', 'chainlink'),
  ('UNI', 'Uniswap', 'cryptocurrency', 'uniswap'),
  ('ATOM', 'Cosmos', 'cryptocurrency', 'cosmos'),
  ('LTC', 'Litecoin', 'cryptocurrency', 'litecoin'),
  ('SHIB', 'Shiba Inu', 'cryptocurrency', 'shiba-inu')
ON CONFLICT (symbol) DO NOTHING;

INSERT INTO entities (name, entity_type, aliases) VALUES
  ('Binance', 'exchange', ARRAY['Binance.com', 'BNB Exchange']),
  ('Coinbase', 'exchange', ARRAY['Coinbase Pro', 'GDAX']),
  ('Kraken', 'exchange', ARRAY['Kraken Exchange']),
  ('FTX', 'exchange', ARRAY['FTX.com', 'FTX US']),
  ('Uniswap', 'protocol', ARRAY['Uniswap V2', 'Uniswap V3']),
  ('Aave', 'protocol', ARRAY['Aave V2', 'Aave V3']),
  ('MakerDAO', 'protocol', ARRAY['Maker', 'DAI']),
  ('Compound', 'protocol', ARRAY['Compound Finance']),
  ('SEC', 'regulator', ARRAY['Securities and Exchange Commission']),
  ('CFTC', 'regulator', ARRAY['Commodity Futures Trading Commission'])
ON CONFLICT DO NOTHING;

-- =============================================================================
-- Grants for Read-Only User (Grafana)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'grafana_reader') THEN
    CREATE ROLE grafana_reader WITH LOGIN PASSWORD 'changeme';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE sentiment TO grafana_reader;
GRANT USAGE ON SCHEMA public TO grafana_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO grafana_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO grafana_reader;
