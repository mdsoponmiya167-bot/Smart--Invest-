CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(190) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS deposits (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  tran_id VARCHAR(40) UNIQUE NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 10 AND amount <= 500000),
  currency CHAR(3) NOT NULL DEFAULT 'BDT',
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  gateway VARCHAR(30) NOT NULL DEFAULT 'sslcommerz',
  session_key TEXT,
  val_id TEXT,
  risk_level SMALLINT,
  gateway_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS deposits_user_created_idx ON deposits(user_id, created_at DESC);
