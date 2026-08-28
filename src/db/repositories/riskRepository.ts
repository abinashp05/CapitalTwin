import type Database from "better-sqlite3";

export interface RiskSnapshot {
  id?: number;
  asset_id: string;
  risk_index: number;
  buyer_risk: number;
  delay_days: number;
  condition: string;
  stage: string;
  effective_ltv: number;
  safe_limit: number;
  capacity: number;
  recorded_at?: string;
}

export class RiskRepository {
  constructor(private db: Database.Database) {}

  addSnapshot(snapshot: RiskSnapshot): number {
    const recordedAt = snapshot.recorded_at || new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO risk_history (
        asset_id, risk_index, buyer_risk, delay_days, condition, stage,
        effective_ltv, safe_limit, capacity, recorded_at
      ) VALUES (
        @asset_id, @risk_index, @buyer_risk, @delay_days, @condition, @stage,
        @effective_ltv, @safe_limit, @capacity, @recorded_at
      )
    `);

    const result = stmt.run({
      asset_id: snapshot.asset_id,
      risk_index: snapshot.risk_index,
      buyer_risk: snapshot.buyer_risk,
      delay_days: snapshot.delay_days,
      condition: snapshot.condition,
      stage: snapshot.stage,
      effective_ltv: snapshot.effective_ltv,
      safe_limit: snapshot.safe_limit,
      capacity: snapshot.capacity,
      recorded_at: recordedAt,
    });

    return Number(result.lastInsertRowid);
  }

  getHistory(assetId: string, limit = 100): RiskSnapshot[] {
    const stmt = this.db.prepare(`
      SELECT * FROM risk_history WHERE asset_id = ? ORDER BY recorded_at DESC, id DESC LIMIT ?
    `);
    return stmt.all(assetId, limit) as RiskSnapshot[];
  }

  clearHistory(assetId: string): void {
    const stmt = this.db.prepare(`DELETE FROM risk_history WHERE asset_id = ?`);
    stmt.run(assetId);
  }
}
