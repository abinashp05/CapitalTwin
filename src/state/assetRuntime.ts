import { AssetRecord } from "../db/repositories/assetRepository";

export const STAGES = [
  "PO_ISSUED",
  "RAW_PROCURED",
  "IN_PRODUCTION",
  "FINISHED_GOODS",
  "IN_TRANSIT",
  "WAREHOUSED",
  "DELIVERED",
  "INVOICED",
  "SETTLED",
];

export const BASE_LTV: Record<string, number> = {
  PO_ISSUED: 0.5,
  RAW_PROCURED: 0.55,
  IN_PRODUCTION: 0.6,
  FINISHED_GOODS: 0.65,
  IN_TRANSIT: 0.75,
  WAREHOUSED: 0.8,
  DELIVERED: 0.85,
  INVOICED: 0.9,
  SETTLED: 0.0,
};

export const INSTRUMENT: Record<string, string> = {
  PO_ISSUED: "PO financing",
  RAW_PROCURED: "procurement financing",
  IN_PRODUCTION: "procurement financing",
  FINISHED_GOODS: "inventory financing",
  IN_TRANSIT: "in-transit financing",
  WAREHOUSED: "warehouse financing",
  DELIVERED: "trade financing",
  INVOICED: "invoice financing",
  SETTLED: "settled",
};

export function createFreshAsset(overrides?: Partial<AssetRecord>): AssetRecord {
  const id = overrides?.id || "ORD-123";
  const name = overrides?.name || "10,000 t-shirts";
  const order_value = overrides?.order_value !== undefined ? overrides.order_value : 5000000;

  return {
    id,
    name,
    order_value,
    stage: overrides?.stage || "NEW",
    physical: {
      location: overrides?.physical?.location || "Ravi's factory",
      condition: overrides?.physical?.condition || "OK",
      delay_days: overrides?.physical?.delay_days || 0,
    },
    financial: {
      drawn: overrides?.financial?.drawn || 0,
      instrument: overrides?.financial?.instrument || "—",
      safe_limit: overrides?.financial?.safe_limit || 0,
      lender: overrides?.financial?.lender || "—",
      rate: overrides?.financial?.rate || 0.0,
      frozen: overrides?.financial?.frozen || false,
    },
    contractual: {
      buyer: overrides?.contractual?.buyer || "BigRetail",
      terms: overrides?.contractual?.terms || "net-60",
      owner: overrides?.contractual?.owner || "Ravi Textiles",
      buyer_risk: overrides?.contractual?.buyer_risk !== undefined ? overrides.contractual.buyer_risk : 0.15,
      expected_cash_date: overrides?.contractual?.expected_cash_date || "—",
    },
    risk_index: overrides?.risk_index !== undefined ? overrides.risk_index : 0.08,
    history: overrides?.history || [],
  };
}

export function computeRisk(a: AssetRecord): number {
  const buyer_risk = a.contractual?.buyer_risk ?? 0.15;
  const delay_days = a.physical?.delay_days ?? 0;
  const condition = a.physical?.condition ?? "OK";
  const cond_factor = condition !== "OK" ? 0.7 : 0.0;
  const delay_factor = Math.min(delay_days / 10.0, 1.0);
  const raw = 0.4 * buyer_risk + 0.25 * delay_factor + 0.2 * cond_factor + 0.15 * 0.1;
  const clamped = Math.max(0.0, Math.min(1.0, raw));
  return Math.round(clamped * 100) / 100;
}

export function effectiveLtv(a: AssetRecord): number {
  const stage = a.stage || "NEW";
  const base = BASE_LTV[stage] ?? 0.0;
  const risk = computeRisk(a);
  const eff = base * (1.0 - 0.4 * risk);
  return Math.round(eff * 1000) / 1000;
}

export function recomputeFinance(a: AssetRecord): { capacity: number; headroom: number } {
  const risk = computeRisk(a);
  a.risk_index = risk;
  const eff = effectiveLtv(a);
  const orderValue = a.order_value || 5000000;
  const drawn = a.financial?.drawn || 0;
  const capacity = Math.floor(orderValue * eff);
  const headroom = Math.max(capacity - drawn, 0);

  a.financial.safe_limit = headroom;
  a.financial.frozen = capacity < drawn;

  const stage = a.stage;
  if (stage && INSTRUMENT[stage] && (a.financial.instrument === "—" || !a.financial.instrument) && stage !== "NEW") {
    a.financial.instrument = INSTRUMENT[stage];
  }

  return { capacity, headroom };
}

export interface AuctionState {
  active: boolean;
  amount: number;
  best: { lender: string; rate: number } | null;
  bids: Record<string, number>;
  currentSessionId?: string | null;
  currentFinancingRecordId?: number | null;
}

export class AssetRuntimeRegistry {
  private assets: Map<string, AssetRecord> = new Map();
  private auctions: Map<string, AuctionState> = new Map();

  getAsset(id: string): AssetRecord | undefined {
    return this.assets.get(id);
  }

  getAllAssets(): AssetRecord[] {
    return Array.from(this.assets.values());
  }

  setAsset(id: string, asset: AssetRecord): void {
    this.assets.set(id, asset);
  }

  hasAsset(id: string): boolean {
    return this.assets.has(id);
  }

  removeAsset(id: string): boolean {
    this.auctions.delete(id);
    return this.assets.delete(id);
  }

  getOrCreateAsset(id: string, overrides?: Partial<AssetRecord>): AssetRecord {
    const existing = this.assets.get(id);
    if (existing) return existing;
    const created = createFreshAsset({ id, ...overrides });
    this.assets.set(id, created);
    return created;
  }

  getDefaultAsset(): AssetRecord {
    return this.getOrCreateAsset("ORD-123");
  }

  getAuction(assetId: string): AuctionState {
    let auction = this.auctions.get(assetId);
    if (!auction) {
      auction = { active: false, amount: 0, best: null, bids: {}, currentSessionId: null, currentFinancingRecordId: null };
      this.auctions.set(assetId, auction);
    }
    return auction;
  }

  setAuction(assetId: string, state: AuctionState): void {
    this.auctions.set(assetId, state);
  }

  clearAuction(assetId: string): void {
    this.auctions.delete(assetId);
  }
}

export const assetRegistry = new AssetRuntimeRegistry();
