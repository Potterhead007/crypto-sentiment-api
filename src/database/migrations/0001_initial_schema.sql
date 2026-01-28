-- Migration: Initial Schema
-- Created: 2024-01-15
-- Description: Initial schema for Crypto Sentiment API
-- Note: TimescaleDB-specific features are optional and gracefully skipped if unavailable

-- =============================================================================
-- Extensions
-- =============================================================================

-- Try to enable TimescaleDB if available, but don't fail if not
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
  RAISE NOTICE 'TimescaleDB extension enabled';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'TimescaleDB not available, using standard PostgreSQL tables';
END $$;

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
-- Sentiment Data Tables
-- =============================================================================

-- Raw sentiment data
CREATE TABLE IF NOT EXISTS sentiment_raw (
  id BIGSERIAL,
  time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
  source_id VARCHAR(200),
  PRIMARY KEY (id)
);

-- Try to convert to hypertable if TimescaleDB available
DO $$
BEGIN
  PERFORM create_hypertable('sentiment_raw', 'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE,
    migrate_data => TRUE
  );
  RAISE NOTICE 'sentiment_raw converted to hypertable';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Using standard table for sentiment_raw (TimescaleDB not available)';
END $$;

CREATE INDEX IF NOT EXISTS idx_sentiment_raw_asset_time ON sentiment_raw(asset_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_sentiment_raw_source ON sentiment_raw(source, time DESC);
CREATE INDEX IF NOT EXISTS idx_sentiment_raw_time ON sentiment_raw(time DESC);

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

-- Try to convert to hypertable if TimescaleDB available
DO $$
BEGIN
  PERFORM create_hypertable('sentiment_aggregated_1m', 'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
  );
  RAISE NOTICE 'sentiment_aggregated_1m converted to hypertable';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Using standard table for sentiment_aggregated_1m';
END $$;

CREATE INDEX IF NOT EXISTS idx_sentiment_1m_asset ON sentiment_aggregated_1m(asset_id, time DESC);

-- Aggregated sentiment (1 hour) - standard table instead of continuous aggregate
CREATE TABLE IF NOT EXISTS sentiment_aggregated_1h (
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

CREATE INDEX IF NOT EXISTS idx_sentiment_1h_asset ON sentiment_aggregated_1h(asset_id, time DESC);

-- Aggregated sentiment (1 day) - standard table instead of continuous aggregate
CREATE TABLE IF NOT EXISTS sentiment_aggregated_1d (
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
  PRIMARY KEY (time, asset_id, source)
);

CREATE INDEX IF NOT EXISTS idx_sentiment_1d_asset ON sentiment_aggregated_1d(asset_id, time DESC);

-- =============================================================================
-- On-chain Data
-- =============================================================================

CREATE TABLE IF NOT EXISTS onchain_flows (
  id BIGSERIAL,
  time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  chain VARCHAR(50) NOT NULL,
  transaction_type VARCHAR(50) NOT NULL,
  from_address VARCHAR(100),
  to_address VARCHAR(100),
  value_usd NUMERIC(20, 2),
  sentiment_impact FLOAT,
  metadata JSONB DEFAULT '{}',
  PRIMARY KEY (id)
);

-- Try to convert to hypertable if TimescaleDB available
DO $$
BEGIN
  PERFORM create_hypertable('onchain_flows', 'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE,
    migrate_data => TRUE
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Using standard table for onchain_flows';
END $$;

CREATE INDEX IF NOT EXISTS idx_onchain_flows_asset ON onchain_flows(asset_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_onchain_flows_type ON onchain_flows(transaction_type, time DESC);
CREATE INDEX IF NOT EXISTS idx_onchain_flows_time ON onchain_flows(time DESC);

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
  PRIMARY KEY (id)
);

-- Try to convert to hypertable if TimescaleDB available
DO $$
BEGIN
  PERFORM create_hypertable('audit_log', 'time',
    chunk_time_interval => INTERVAL '1 week',
    if_not_exists => TRUE,
    migrate_data => TRUE
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Using standard table for audit_log';
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_log_client ON audit_log(client_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action, time DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_time ON audit_log(time DESC);

-- =============================================================================
-- TimescaleDB-specific features (only if available)
-- =============================================================================

-- Compression policies (TimescaleDB only)
DO $$
BEGIN
  ALTER TABLE sentiment_raw SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'asset_id, source'
  );
  PERFORM add_compression_policy('sentiment_raw', INTERVAL '7 days', if_not_exists => TRUE);
  
  ALTER TABLE sentiment_aggregated_1m SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'asset_id, source'
  );
  PERFORM add_compression_policy('sentiment_aggregated_1m', INTERVAL '30 days', if_not_exists => TRUE);
  
  ALTER TABLE onchain_flows SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'asset_id, chain'
  );
  PERFORM add_compression_policy('onchain_flows', INTERVAL '7 days', if_not_exists => TRUE);
  
  ALTER TABLE audit_log SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'client_id'
  );
  PERFORM add_compression_policy('audit_log', INTERVAL '30 days', if_not_exists => TRUE);
  
  RAISE NOTICE 'Compression policies applied';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Compression policies skipped (TimescaleDB not available)';
END $$;

-- Retention policies (TimescaleDB only)
DO $$
BEGIN
  PERFORM add_retention_policy('sentiment_raw', INTERVAL '90 days', if_not_exists => TRUE);
  PERFORM add_retention_policy('sentiment_aggregated_1m', INTERVAL '365 days', if_not_exists => TRUE);
  PERFORM add_retention_policy('audit_log', INTERVAL '2555 days', if_not_exists => TRUE);
  PERFORM add_retention_policy('onchain_flows', INTERVAL '2555 days', if_not_exists => TRUE);
  RAISE NOTICE 'Retention policies applied';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Retention policies skipped (TimescaleDB not available)';
END $$;

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
