import type Database from "better-sqlite3";

export interface FinancingRecord {
  id?: number;
  asset_id: string;
  amount: number;
  requested_amount: number;
  status: string;
  lender?: string | null;
  rate?: number | null;
  instrument?: string | null;
  created_at?: string;
  updated_at?: string;
}

export class FinancingRepository {
  constructor(private db: Database.Database) {}

  createRecord(record: FinancingRecord): number {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO financing_records (
        asset_id, amount, requested_amount, status, lender, rate, instrument, created_at, updated_at
      ) VALUES (
        @asset_id, @amount, @requested_amount, @status, @lender, @rate, @instrument, @created_at, @updated_at
      )
    `);

    const result = stmt.run({
      asset_id: record.asset_id,
      amount: record.amount,
      requested_amount: record.requested_amount,
      status: record.status,
      lender: record.lender ?? null,
      rate: record.rate ?? null,
      instrument: record.instrument ?? null,
      created_at: record.created_at || now,
      updated_at: record.updated_at || now,
    });

    return Number(result.lastInsertRowid);
  }

  updateStatus(id: number, status: string, updates?: Partial<FinancingRecord>): void {
    const now = new Date().toISOString();
    const existing = this.getById(id);
    if (!existing) return;

    const lender = updates?.lender !== undefined ? updates.lender : existing.lender;
    const rate = updates?.rate !== undefined ? updates.rate : existing.rate;
    const instrument = updates?.instrument !== undefined ? updates.instrument : existing.instrument;
    const amount = updates?.amount !== undefined ? updates.amount : existing.amount;

    const stmt = this.db.prepare(`
      UPDATE financing_records
      SET status = @status, lender = @lender, rate = @rate, instrument = @instrument, amount = @amount, updated_at = @updated_at
      WHERE id = @id
    `);

    stmt.run({
      id,
      status,
      lender: lender ?? null,
      rate: rate ?? null,
      instrument: instrument ?? null,
      amount: amount ?? existing.amount,
      updated_at: now,
    });
  }

  getById(id: number): FinancingRecord | null {
    const stmt = this.db.prepare(`SELECT * FROM financing_records WHERE id = ?`);
    const row = stmt.get(id) as FinancingRecord | undefined;
    return row || null;
  }

  getLatestByAsset(assetId: string): FinancingRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM financing_records WHERE asset_id = ? ORDER BY id DESC LIMIT 1
    `);
    const row = stmt.get(assetId) as FinancingRecord | undefined;
    return row || null;
  }

  clearByAsset(assetId: string): void {
    const stmt = this.db.prepare(`DELETE FROM financing_records WHERE asset_id = ?`);
    stmt.run(assetId);
  }
}
