import type Database from "better-sqlite3";

export interface LedgerRecord {
  id?: number;
  asset_id: string;
  type: string;
  lender: string;
  amount: number;
  note: string;
  ts: string;
  prev_hash: string;
  hash: string;
  created_at?: string;
}

export class LedgerRepository {
  constructor(private db: Database.Database) {}

  addRecord(record: LedgerRecord): number {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO ledger_records (
        asset_id, type, lender, amount, note, ts, prev_hash, hash, created_at
      ) VALUES (
        @asset_id, @type, @lender, @amount, @note, @ts, @prev_hash, @hash, @created_at
      )
    `);

    const result = stmt.run({
      asset_id: record.asset_id,
      type: record.type,
      lender: record.lender,
      amount: record.amount,
      note: record.note ?? "",
      ts: record.ts,
      prev_hash: record.prev_hash,
      hash: record.hash,
      created_at: record.created_at || now,
    });

    return Number(result.lastInsertRowid);
  }

  getByAsset(assetId: string): LedgerRecord[] {
    const stmt = this.db.prepare(`
      SELECT asset_id, type, lender, amount, note, ts, prev_hash, hash FROM ledger_records
      WHERE asset_id = ?
      ORDER BY id ASC
    `);
    return stmt.all(assetId) as LedgerRecord[];
  }

  getAll(): LedgerRecord[] {
    const stmt = this.db.prepare(`
      SELECT asset_id, type, lender, amount, note, ts, prev_hash, hash FROM ledger_records
      ORDER BY id ASC
    `);
    return stmt.all() as LedgerRecord[];
  }

  getLastRecord(): LedgerRecord | null {
    const stmt = this.db.prepare(`
      SELECT asset_id, type, lender, amount, note, ts, prev_hash, hash FROM ledger_records
      ORDER BY id DESC
      LIMIT 1
    `);
    const row = stmt.get() as LedgerRecord | undefined;
    return row || null;
  }

  clearByAsset(assetId: string): void {
    const stmt = this.db.prepare(`DELETE FROM ledger_records WHERE asset_id = ?`);
    stmt.run(assetId);
  }
}
