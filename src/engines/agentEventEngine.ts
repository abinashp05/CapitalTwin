import { AssetRecord } from "../db/repositories/assetRepository";

export type PushMsgFn = (assetId: string, agent: string, reason: string) => Promise<void>;

export async function runAgentEvents(asset: AssetRecord, eventType: string, pushMsg: PushMsgFn) {
  const assetId = asset.id;
  const risk = asset.risk_index || 0.08;
  const safe_lim = asset.financial?.safe_limit || 0;
  const safe_str = safe_lim.toLocaleString("en-IN");

  if (eventType === "ORDER_CONFIRMED") {
    await pushMsg(assetId, "Tracker", `Order confirmed for ${asset.name} by ${asset.contractual.buyer}. Title registered to ${asset.contractual.owner}.`);
    await pushMsg(assetId, "Risk", `Initial baseline risk assessed at ${risk.toFixed(2)}. Buyer ${asset.contractual.buyer} credit rating rated AA.`);
    await pushMsg(assetId, "Loan", `Safe financing headroom established at ₹${safe_str} (50% LTV). Available for PO drawdown.`);
  } else if (eventType === "RAW_PROCURED") {
    await pushMsg(assetId, "Tracker", `Yarn & dye procured at ${asset.physical.location}. Value added to physical asset.`);
    await pushMsg(assetId, "Loan", `Stage advanced to RAW_PROCURED. Base LTV elevated to 55%. Safe limit updated to ₹${safe_str}.`);
  } else if (eventType === "PRODUCED") {
    await pushMsg(assetId, "Tracker", `${asset.name} manufactured and quality checked at Factory store.`);
    await pushMsg(assetId, "Loan", `Stage updated to FINISHED_GOODS. Inventory financing headroom unlocked at 65% LTV (₹${safe_str}).`);
  } else if (eventType === "SHIPPED") {
    await pushMsg(assetId, "Tracker", "Consignment in transit on NH-48 via GPS-tracked container fleet.");
    await pushMsg(assetId, "Risk", "In-transit sensors online. Telemetry and route adherence normal.");
    await pushMsg(assetId, "Loan", `LTV increased to 75% for in-transit financing (₹${safe_str} safe headroom).`);
  } else if (eventType === "DELAYED") {
    const delay = asset.physical?.delay_days || 3;
    await pushMsg(assetId, "Tracker", `Logistics alert: +3 days transit delay reported (total delay: ${delay}d) due to highway congestion.`);
    await pushMsg(assetId, "Risk", `Transit delay detected (+3 days). Risk index adjusted upwards to ${risk.toFixed(2)}. Financing capacity scaled down.`);
  } else if (eventType === "TEMP_SPIKE") {
    await pushMsg(assetId, "Tracker", "Sensor telemetry alert: Temperature spike detected in transit container.");
    await pushMsg(assetId, "Risk", `Condition marked DEGRADED (heat). Risk index elevated to ${risk.toFixed(2)} to account for inspection buffer.`);
  } else if (eventType === "WAREHOUSED") {
    await pushMsg(assetId, "Tracker", "Goods safely received and checked in at Chennai WH-7.");
    await pushMsg(assetId, "Loan", `Warehouse financing active at 80% LTV. Headroom recomputed to ₹${safe_str}.`);
  } else if (eventType === "DELIVERED") {
    await pushMsg(assetId, "Tracker", `Proof of Delivery logged at ${asset.contractual.buyer} DC. Delay counter reset to 0.`);
    await pushMsg(assetId, "Risk", `Delivery confirmed. Physical transit risk resolved to baseline (${risk.toFixed(2)}).`);
    await pushMsg(assetId, "Loan", `Trade financing headroom expanded to 85% LTV (₹${safe_str}).`);
  } else if (eventType === "INVOICED") {
    const valStr = (asset.order_value || 5000000).toLocaleString("en-IN");
    await pushMsg(assetId, "Tracker", `Commercial Invoice raised for ₹${valStr} under ${asset.contractual.terms} terms with ${asset.contractual.buyer}.`);
    await pushMsg(assetId, "Loan", `Invoice financing unlocked at maximum 90% LTV (₹${safe_str} safe headroom).`);
  } else if (eventType === "RECEIVABLE_DELAYED") {
    await pushMsg(assetId, "Tracker", `Payment alert: ${asset.contractual.buyer} missed day-60 settlement schedule.`);
    await pushMsg(assetId, "Risk", `Buyer risk elevated (+0.35). Risk index adjusted to ${risk.toFixed(2)}; credit headroom constrained.`);
  }
}
