import type Database from "better-sqlite3";

export interface EventRecord {
  id?: number;
  asset_id: string;
  agent: string;
  reason: string;
  ts: string;
  created_at?: string;
}

export class EventRepository {
  constructor(private db: Database.Database) {}

  addEvent(assetId: string, agent: string, reason: string, ts: string): number {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO event_history (
        asset_id, agent, reason, ts, created_at
      ) VALUES (
        @asset_id, @agent, @reason, @ts, @created_at
      )
    `);

    const result = stmt.run({
      asset_id: assetId,
      agent,
      reason,
      ts,
      created_at: now,
    });

    return Number(result.lastInsertRowid);
  }

  getRecentEvents(assetId: string, limit = 40): Array<{ agent: string; reason: string; ts: string }> {
    // Get latest `limit` events, returned in chronological order
    const stmt = this.db.prepare(`
      SELECT agent, reason, ts FROM (
        SELECT id, agent, reason, ts FROM event_history
        WHERE asset_id = ?
        ORDER BY id DESC
        LIMIT ?
      ) sub ORDER BY id ASC
    `);
    return stmt.all(assetId, limit) as Array<{ agent: string; reason: string; ts: string }>;
  }

  clearByAsset(assetId: string): void {
    const stmt = this.db.prepare(`DELETE FROM event_history WHERE asset_id = ?`);
    stmt.run(assetId);
  }
}
