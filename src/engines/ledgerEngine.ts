import crypto from "crypto";
// @ts-ignore
import { AssetRecord } from "../db/repositories/assetRepository";
// @ts-ignore
import { effectiveLtv } from "../state/assetRuntime";

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
