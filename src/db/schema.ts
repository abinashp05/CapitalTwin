import type Database from "better-sqlite3";

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      order_value REAL NOT NULL,
      stage TEXT NOT NULL,
      physical_location TEXT NOT NULL DEFAULT 'Ravi''s factory',
      physical_condition TEXT NOT NULL DEFAULT 'OK',
      physical_delay_days INTEGER NOT NULL DEFAULT 0,
      financial_drawn REAL NOT NULL DEFAULT 0,
      financial_instrument TEXT NOT NULL DEFAULT '—',
      financial_safe_limit REAL NOT NULL DEFAULT 0,
      financial_lender TEXT NOT NULL DEFAULT '—',
      financial_rate REAL NOT NULL DEFAULT 0.0,
      financial_frozen INTEGER NOT NULL DEFAULT 0,
      contractual_buyer TEXT NOT NULL DEFAULT 'BigRetail',
      contractual_terms TEXT NOT NULL DEFAULT 'net-60',
      contractual_owner TEXT NOT NULL DEFAULT 'Ravi Textiles',
      contractual_buyer_risk REAL NOT NULL DEFAULT 0.15,
      contractual_expected_cash_date TEXT NOT NULL DEFAULT '—',
      risk_index REAL NOT NULL DEFAULT 0.08,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS risk_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id TEXT NOT NULL,
      risk_index REAL NOT NULL,
      buyer_risk REAL NOT NULL,
      delay_days INTEGER NOT NULL,
      condition TEXT NOT NULL,
      stage TEXT NOT NULL,
      effective_ltv REAL NOT NULL,
      safe_limit REAL NOT NULL,
      capacity REAL NOT NULL,
      recorded_at TEXT NOT NULL,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS financing_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id TEXT NOT NULL,
      amount REAL NOT NULL,
      requested_amount REAL NOT NULL,
      status TEXT NOT NULL,
      lender TEXT,
      rate REAL,
      instrument TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auction_sessions (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL,
      best_lender TEXT,
      best_rate REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auction_bids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      lender TEXT NOT NULL,
      rate REAL NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES auction_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ledger_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id TEXT NOT NULL,
      type TEXT NOT NULL,
      lender TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      ts TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS event_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id TEXT NOT NULL,
      agent TEXT NOT NULL,
      reason TEXT NOT NULL,
      ts TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS system_metrics (
      metric_key TEXT PRIMARY KEY,
      metric_value REAL NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('supplier', 'lender', 'admin')),
      name TEXT NOT NULL,
      org TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auth_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      action TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_risk_history_asset_time ON risk_history(asset_id, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_financing_records_asset ON financing_records(asset_id);
    CREATE INDEX IF NOT EXISTS idx_event_history_asset ON event_history(asset_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_records_asset ON ledger_records(asset_id);
    CREATE INDEX IF NOT EXISTS idx_auction_bids_session ON auction_bids(session_id);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_auth_audit_user ON auth_audit_logs(user_id);
  `);
}
