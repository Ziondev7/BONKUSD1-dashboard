-- BONK.fun USD1 Volume Tracker Database Schema
-- Run this in Supabase SQL Editor to set up your database

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- POOLS TABLE
-- Stores info about each BONK.fun/USD1 pool
-- ============================================
CREATE TABLE IF NOT EXISTS pools (
  id SERIAL PRIMARY KEY,
  pool_address TEXT NOT NULL UNIQUE,
  token_mint TEXT NOT NULL,
  token_symbol TEXT NOT NULL,
  token_name TEXT,
  total_volume_usd NUMERIC(20, 6) DEFAULT 0,
  total_trades INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ
);

-- Index for fast pool lookups
CREATE INDEX IF NOT EXISTS idx_pools_address ON pools(pool_address);
CREATE INDEX IF NOT EXISTS idx_pools_token_mint ON pools(token_mint);

-- ============================================
-- VOLUME SNAPSHOTS TABLE
-- Stores hourly volume data per pool
-- ============================================
CREATE TABLE IF NOT EXISTS volume_snapshots (
  id SERIAL PRIMARY KEY,
  pool_address TEXT NOT NULL,
  token_mint TEXT NOT NULL,
  token_symbol TEXT NOT NULL,
  timestamp BIGINT NOT NULL,              -- Unix timestamp (hour bucket)
  volume_usd NUMERIC(20, 6) NOT NULL,
  trades INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint for upsert
  CONSTRAINT volume_snapshots_unique UNIQUE (pool_address, timestamp)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_volume_timestamp ON volume_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_volume_pool_timestamp ON volume_snapshots(pool_address, timestamp);
CREATE INDEX IF NOT EXISTS idx_volume_token ON volume_snapshots(token_mint);

-- ============================================
-- SYNC STATUS TABLE
-- Tracks sync progress for each pool
-- ============================================
CREATE TABLE IF NOT EXISTS sync_status (
  id SERIAL PRIMARY KEY,
  pool_address TEXT NOT NULL UNIQUE,
  last_synced_timestamp BIGINT DEFAULT 0,
  last_signature TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'syncing', 'completed', 'error')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_status(status);
CREATE INDEX IF NOT EXISTS idx_sync_timestamp ON sync_status(last_synced_timestamp);

-- ============================================
-- AGGREGATED VIEWS
-- Pre-computed views for fast dashboard queries
-- ============================================

-- 24h aggregated volume view
CREATE OR REPLACE VIEW volume_24h AS
SELECT
  DATE_TRUNC('hour', TO_TIMESTAMP(timestamp / 1000)) AS hour,
  SUM(volume_usd) AS total_volume,
  SUM(trades) AS total_trades,
  COUNT(DISTINCT pool_address) AS active_pools
FROM volume_snapshots
WHERE timestamp > (EXTRACT(EPOCH FROM NOW()) * 1000 - 86400000)::BIGINT
GROUP BY DATE_TRUNC('hour', TO_TIMESTAMP(timestamp / 1000))
ORDER BY hour;

-- 7d aggregated volume view (4-hour buckets)
CREATE OR REPLACE VIEW volume_7d AS
SELECT
  DATE_TRUNC('hour', TO_TIMESTAMP(timestamp / 1000)) -
    (EXTRACT(HOUR FROM TO_TIMESTAMP(timestamp / 1000))::INT % 4) * INTERVAL '1 hour' AS bucket,
  SUM(volume_usd) AS total_volume,
  SUM(trades) AS total_trades,
  COUNT(DISTINCT pool_address) AS active_pools
FROM volume_snapshots
WHERE timestamp > (EXTRACT(EPOCH FROM NOW()) * 1000 - 604800000)::BIGINT
GROUP BY bucket
ORDER BY bucket;

-- 30d aggregated volume view (daily buckets)
CREATE OR REPLACE VIEW volume_30d AS
SELECT
  DATE_TRUNC('day', TO_TIMESTAMP(timestamp / 1000)) AS day,
  SUM(volume_usd) AS total_volume,
  SUM(trades) AS total_trades,
  COUNT(DISTINCT pool_address) AS active_pools
FROM volume_snapshots
WHERE timestamp > (EXTRACT(EPOCH FROM NOW()) * 1000 - 2592000000)::BIGINT
GROUP BY DATE_TRUNC('day', TO_TIMESTAMP(timestamp / 1000))
ORDER BY day;

-- All-time aggregated volume view (monthly buckets)
CREATE OR REPLACE VIEW volume_all AS
SELECT
  DATE_TRUNC('month', TO_TIMESTAMP(timestamp / 1000)) AS month,
  SUM(volume_usd) AS total_volume,
  SUM(trades) AS total_trades,
  COUNT(DISTINCT pool_address) AS active_pools
FROM volume_snapshots
GROUP BY DATE_TRUNC('month', TO_TIMESTAMP(timestamp / 1000))
ORDER BY month;

-- ============================================
-- FUNCTIONS
-- Helper functions for data operations
-- ============================================

-- Function to get total stats
CREATE OR REPLACE FUNCTION get_total_stats()
RETURNS TABLE (
  total_volume_24h NUMERIC,
  total_volume_7d NUMERIC,
  total_volume_all NUMERIC,
  total_trades BIGINT,
  pool_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE((
      SELECT SUM(volume_usd)
      FROM volume_snapshots
      WHERE timestamp > (EXTRACT(EPOCH FROM NOW()) * 1000 - 86400000)::BIGINT
    ), 0) AS total_volume_24h,
    COALESCE((
      SELECT SUM(volume_usd)
      FROM volume_snapshots
      WHERE timestamp > (EXTRACT(EPOCH FROM NOW()) * 1000 - 604800000)::BIGINT
    ), 0) AS total_volume_7d,
    COALESCE((
      SELECT SUM(volume_usd)
      FROM volume_snapshots
    ), 0) AS total_volume_all,
    COALESCE((
      SELECT SUM(trades)::BIGINT
      FROM volume_snapshots
    ), 0) AS total_trades,
    COALESCE((
      SELECT COUNT(DISTINCT pool_address)::BIGINT
      FROM volume_snapshots
      WHERE timestamp > (EXTRACT(EPOCH FROM NOW()) * 1000 - 86400000)::BIGINT
    ), 0) AS pool_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- ROW LEVEL SECURITY (Optional)
-- ============================================

-- Enable RLS
ALTER TABLE pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE volume_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_status ENABLE ROW LEVEL SECURITY;

-- Allow read access to all
CREATE POLICY "Allow read access" ON pools FOR SELECT USING (true);
CREATE POLICY "Allow read access" ON volume_snapshots FOR SELECT USING (true);
CREATE POLICY "Allow read access" ON sync_status FOR SELECT USING (true);

-- Allow service role full access
CREATE POLICY "Service role full access" ON pools FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON volume_snapshots FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON sync_status FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- SAMPLE DATA (Optional - for testing)
-- ============================================
-- INSERT INTO pools (pool_address, token_mint, token_symbol, token_name)
-- VALUES ('SAMPLE_POOL_ADDRESS', 'SAMPLE_TOKEN_MINT', 'TEST', 'Test Token');
