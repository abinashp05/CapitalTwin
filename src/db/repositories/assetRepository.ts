import type Database from "better-sqlite3";

export interface AssetRecord {
  id: string;
  name: string;
  order_value: number;
  stage: string;
  physical: {
    location: string;
    condition: string;
    delay_days: number;
  };
  financial: {
    drawn: number;
    instrument: string;
    safe_limit: number;
    lender: string;
    rate: number;
    frozen: boolean;
  };
  contractual: {
    buyer: string;
    terms: string;
    owner: string;
    buyer_risk: number;
    expected_cash_date: string;
  };
  risk_index: number;
  history: Array<{ agent: string; reason: string; ts: string }>;
}

export class AssetRepository {
  constructor(private db: Database.Database) {}

  getAsset(id: string): AssetRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM assets WHERE id = ?
    `);
    const row = stmt.get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      order_value: row.order_value,
      stage: row.stage,
      physical: {
        location: row.physical_location,
        condition: row.physical_condition,
        delay_days: row.physical_delay_days,
      },
      financial: {
        drawn: row.financial_drawn,
        instrument: row.financial_instrument,
        safe_limit: row.financial_safe_limit,
        lender: row.financial_lender,
        rate: row.financial_rate,
        frozen: Boolean(row.financial_frozen),
      },
      contractual: {
        buyer: row.contractual_buyer,
        terms: row.contractual_terms,
        owner: row.contractual_owner,
        buyer_risk: row.contractual_buyer_risk,
        expected_cash_date: row.contractual_expected_cash_date,
      },
      risk_index: row.risk_index,
      history: [],
    };
  }

  saveAsset(asset: AssetRecord): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO assets (
        id, name, order_value, stage,
        physical_location, physical_condition, physical_delay_days,
        financial_drawn, financial_instrument, financial_safe_limit, financial_lender, financial_rate, financial_frozen,
        contractual_buyer, contractual_terms, contractual_owner, contractual_buyer_risk, contractual_expected_cash_date,
        risk_index, updated_at, created_at
      ) VALUES (
        @id, @name, @order_value, @stage,
        @physical_location, @physical_condition, @physical_delay_days,
        @financial_drawn, @financial_instrument, @financial_safe_limit, @financial_lender, @financial_rate, @financial_frozen,
        @contractual_buyer, @contractual_terms, @contractual_owner, @contractual_buyer_risk, @contractual_expected_cash_date,
        @risk_index, @updated_at, @created_at
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        order_value = excluded.order_value,
        stage = excluded.stage,
        physical_location = excluded.physical_location,
        physical_condition = excluded.physical_condition,
        physical_delay_days = excluded.physical_delay_days,
        financial_drawn = excluded.financial_drawn,
        financial_instrument = excluded.financial_instrument,
        financial_safe_limit = excluded.financial_safe_limit,
        financial_lender = excluded.financial_lender,
        financial_rate = excluded.financial_rate,
        financial_frozen = excluded.financial_frozen,
        contractual_buyer = excluded.contractual_buyer,
        contractual_terms = excluded.contractual_terms,
        contractual_owner = excluded.contractual_owner,
        contractual_buyer_risk = excluded.contractual_buyer_risk,
        contractual_expected_cash_date = excluded.contractual_expected_cash_date,
        risk_index = excluded.risk_index,
        updated_at = excluded.updated_at
    `);

    stmt.run({
      id: asset.id,
      name: asset.name,
      order_value: asset.order_value,
      stage: asset.stage,
      physical_location: asset.physical.location,
      physical_condition: asset.physical.condition,
      physical_delay_days: asset.physical.delay_days,
      financial_drawn: asset.financial.drawn,
      financial_instrument: asset.financial.instrument,
      financial_safe_limit: asset.financial.safe_limit,
      financial_lender: asset.financial.lender,
      financial_rate: asset.financial.rate,
      financial_frozen: asset.financial.frozen ? 1 : 0,
      contractual_buyer: asset.contractual.buyer,
      contractual_terms: asset.contractual.terms,
      contractual_owner: asset.contractual.owner,
      contractual_buyer_risk: asset.contractual.buyer_risk,
      contractual_expected_cash_date: asset.contractual.expected_cash_date,
      risk_index: asset.risk_index,
      updated_at: now,
      created_at: now,
    });
  }

  countAssets(): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM assets`);
    const res = stmt.get() as { count: number };
    return res?.count || 0;
  }

  getAllAssets(): AssetRecord[] {
    const stmt = this.db.prepare(`SELECT * FROM assets ORDER BY created_at ASC`);
    const rows = stmt.all() as any[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      order_value: row.order_value,
      stage: row.stage,
      physical: {
        location: row.physical_location,
        condition: row.physical_condition,
        delay_days: row.physical_delay_days,
      },
      financial: {
        drawn: row.financial_drawn,
        instrument: row.financial_instrument,
        safe_limit: row.financial_safe_limit,
        lender: row.financial_lender,
        rate: row.financial_rate,
        frozen: Boolean(row.financial_frozen),
      },
      contractual: {
        buyer: row.contractual_buyer,
        terms: row.contractual_terms,
        owner: row.contractual_owner,
        buyer_risk: row.contractual_buyer_risk,
        expected_cash_date: row.contractual_expected_cash_date,
      },
      risk_index: row.risk_index,
      history: [],
    }));
  }
}
