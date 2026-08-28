import crypto from "crypto";
export interface AssetRecord {
  id: string;
  order_value?: number;
  stage?: string;
  contractual?: {
    owner?: string;
    buyer_risk?: number;
    [key: string]: any;
  };
  physical?: {
    condition?: string;
    delay_days?: number;
    [key: string]: any;
  };
  risk_index?: number;
  [key: string]: any;
}

const BASE_LTV: Record<string, number> = {
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

export interface LedgerBlock {
  asset_id: string;
  type: string;
  lender: string;
  amount: number;
  note: string;
  ts: string;
  prev_hash: string;
  hash: string;
}

export function getNowTimestamp(): string {
  const d = new Date();
  return d.toTimeString().split(" ")[0];
}

export function createLedgerBlock(
  ledger: LedgerBlock[],
  asset_id: string,
  type: string,
  lender: string,
  amount: number,
  note = ""
): LedgerBlock {
  // Chain per-asset: each block links to the previous block OF THE SAME ASSET.
  // This keeps every asset's chain independently verifiable, so clearing or
  // resetting one asset can never invalidate another asset's chain.
  let prev_hash = "GENESIS";
  for (let i = ledger.length - 1; i >= 0; i--) {
    if (ledger[i].asset_id === asset_id) {
      prev_hash = ledger[i].hash;
      break;
    }
  }
  const ts = getNowTimestamp();
  const amt = Math.floor(amount);
  const raw = `${prev_hash}${asset_id}${type}${lender}${amt}${ts}`;
  const hash = crypto.createHash("sha256").update(raw, "utf8").digest("hex");

  return {
    asset_id,
    type,
    lender,
    amount: amt,
    note,
    ts,
    prev_hash,
    hash,
  };
}

export function verifyLedgerChain(records: LedgerBlock[]): boolean {
  if (records.length === 0) return true;
  // Verify each asset's chain independently (blocks are chained per-asset).
  const lastHashByAsset = new Map<string, string>();
  for (const rec of records) {
    const expected_prev = lastHashByAsset.get(rec.asset_id) || "GENESIS";
    if (rec.prev_hash !== expected_prev) return false;
    const raw = `${rec.prev_hash}${rec.asset_id}${rec.type}${rec.lender}${rec.amount}${rec.ts}`;
    const computed = crypto.createHash("sha256").update(raw, "utf8").digest("hex");
    if (rec.hash !== computed) return false;
    lastHashByAsset.set(rec.asset_id, rec.hash);
  }
  return true;
}

export function getTotalAssetClaims(ledger: LedgerBlock[], asset_id: string): number {
  return ledger
    .filter((r) => r.asset_id === asset_id && r.type === "financing")
    .reduce((sum, r) => sum + r.amount, 0);
}

export function checkLedgerCompliance(
  asset: AssetRecord,
  amount: number,
  requester: string,
  ledger: LedgerBlock[]
): { ok: boolean; reason: string } {
  const owner = asset.contractual?.owner || "Ravi Textiles";
  if (requester !== owner) {
    return {
      ok: false,
      reason: `BLOCKED — requester '${requester}' does not own ${asset.id}; title is with ${owner}.`,
    };
  }
  const existing = getTotalAssetClaims(ledger, asset.id);
  const eff = effectiveLtv(asset);
  const orderVal = asset.order_value || 5000000;
  const safeCap = Math.floor(orderVal * eff);
  if (existing + amount > safeCap) {
    return {
      ok: false,
      reason: `BLOCKED — claims would exceed safe capacity (existing ₹${existing.toLocaleString("en-IN")} + requested ₹${amount.toLocaleString("en-IN")} > ₹${safeCap.toLocaleString("en-IN")}).`,
    };
  }
  return { ok: true, reason: "clear" };
}
