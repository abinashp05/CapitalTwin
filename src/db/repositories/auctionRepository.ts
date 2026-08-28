import type Database from "better-sqlite3";

export interface AuctionSession {
  id: string;
  asset_id: string;
  amount: number;
  status: string;
  best_lender?: string | null;
  best_rate?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface AuctionBid {
  id?: number;
  session_id: string;
  asset_id: string;
  lender: string;
  rate: number;
  created_at?: string;
}

export class AuctionRepository {
  constructor(private db: Database.Database) {}

  createSession(session: AuctionSession): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO auction_sessions (
        id, asset_id, amount, status, best_lender, best_rate, created_at, updated_at
      ) VALUES (
        @id, @asset_id, @amount, @status, @best_lender, @best_rate, @created_at, @updated_at
      )
    `);

    stmt.run({
      id: session.id,
      asset_id: session.asset_id,
      amount: session.amount,
      status: session.status,
      best_lender: session.best_lender ?? null,
      best_rate: session.best_rate ?? null,
      created_at: session.created_at || now,
      updated_at: session.updated_at || now,
    });
  }

  updateSession(
    id: string,
    status: string,
    bestLender?: string | null,
    bestRate?: number | null
  ): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE auction_sessions
      SET status = @status,
          best_lender = COALESCE(@best_lender, best_lender),
          best_rate = COALESCE(@best_rate, best_rate),
          updated_at = @updated_at
      WHERE id = @id
    `);

    stmt.run({
      id,
      status,
      best_lender: bestLender ?? null,
      best_rate: bestRate ?? null,
      updated_at: now,
    });
  }

  getSession(id: string): AuctionSession | null {
    const stmt = this.db.prepare(`SELECT * FROM auction_sessions WHERE id = ?`);
    const row = stmt.get(id) as AuctionSession | undefined;
    return row || null;
  }

  getLatestSession(assetId: string): AuctionSession | null {
    const stmt = this.db.prepare(`
      SELECT * FROM auction_sessions WHERE asset_id = ? ORDER BY created_at DESC, id DESC LIMIT 1
    `);
    const row = stmt.get(assetId) as AuctionSession | undefined;
    return row || null;
  }

  addBid(bid: AuctionBid): number {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO auction_bids (
        session_id, asset_id, lender, rate, created_at
      ) VALUES (
        @session_id, @asset_id, @lender, @rate, @created_at
      )
    `);

    const result = stmt.run({
      session_id: bid.session_id,
      asset_id: bid.asset_id,
      lender: bid.lender,
      rate: bid.rate,
      created_at: bid.created_at || now,
    });

    return Number(result.lastInsertRowid);
  }

  getBids(sessionId: string): AuctionBid[] {
    const stmt = this.db.prepare(`
      SELECT * FROM auction_bids WHERE session_id = ? ORDER BY id ASC
    `);
    return stmt.all(sessionId) as AuctionBid[];
  }

  clearByAsset(assetId: string): void {
    // Delete bids related to sessions of this asset
    const deleteBidsStmt = this.db.prepare(`
      DELETE FROM auction_bids WHERE asset_id = ? OR session_id IN (
        SELECT id FROM auction_sessions WHERE asset_id = ?
      )
    `);
    deleteBidsStmt.run(assetId, assetId);

    const deleteSessionsStmt = this.db.prepare(`DELETE FROM auction_sessions WHERE asset_id = ?`);
    deleteSessionsStmt.run(assetId);
  }
}
