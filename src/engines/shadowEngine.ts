import { AssetRecord } from "../db/repositories/assetRepository";
import { computeRisk, effectiveLtv, recomputeFinance, STAGES } from "../state/assetRuntime";

export interface ShadowScenario {
  delay_days_delta?: number;
  delay_days_override?: number;
  buyer_risk_delta?: number;
  buyer_risk_override?: number;
  temperature_delta?: number;
  condition_override?: string;
  stage_override?: string;
  scenario_name?: string;
}

export interface ShadowMetricSnapshot {
  stage: string;
  risk_index: number;
  effective_ltv: number;
  capacity: number;
  drawn: number;
  safe_limit: number;
  headroom: number;
  frozen: boolean;
  condition: string;
  delay_days: number;
  buyer_risk: number;
}

export interface ShadowSimulationResult {
  asset_id: string;
  asset_name: string;
  order_value: number;
  scenario_name: string;
  timestamp: string;
  baseline: ShadowMetricSnapshot;
  predicted: ShadowMetricSnapshot;
  delta: {
    risk_index_delta: number;
    effective_ltv_delta: number;
    capacity_delta: number;
    safe_limit_delta: number;
    headroom_delta: number;
    frozen_changed: boolean;
    now_frozen: boolean;
  };
  warnings: string[];
}

export const VALID_CONDITIONS = [
  "OK",
  "DEGRADED (heat)",
  "DEGRADED",
  "DAMAGED",
  "DAMAGED (transit)",
  "TAMPERED",
  "DELAYED",
];

export function validateScenario(scenario: any): { valid: boolean; error?: string } {
  if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) {
    return { valid: false, error: "Scenario must be a valid JSON object" };
  }

  // Check for unknown keys
  const allowedKeys = new Set([
    "delay_days_delta",
    "delay_days_override",
    "buyer_risk_delta",
    "buyer_risk_override",
    "temperature_delta",
    "condition_override",
    "stage_override",
    "scenario_name",
  ]);

  for (const key of Object.keys(scenario)) {
    if (!allowedKeys.has(key)) {
      return { valid: false, error: `Unknown scenario field: '${key}'` };
    }
  }

  // Type & domain validation: do not silently cast strings to numbers
  if (scenario.delay_days_delta !== undefined) {
    if (typeof scenario.delay_days_delta !== "number" || isNaN(scenario.delay_days_delta)) {
      return { valid: false, error: "delay_days_delta must be a valid number" };
    }
    if (scenario.delay_days_delta < -30 || scenario.delay_days_delta > 60) {
      return { valid: false, error: "delay_days_delta out of acceptable range (-30 to +60)" };
    }
  }

  if (scenario.delay_days_override !== undefined) {
    if (typeof scenario.delay_days_override !== "number" || isNaN(scenario.delay_days_override)) {
      return { valid: false, error: "delay_days_override must be a valid number" };
    }
    if (scenario.delay_days_override < 0 || scenario.delay_days_override > 60) {
      return { valid: false, error: "delay_days_override out of acceptable range (0 to 60)" };
    }
  }

  if (scenario.buyer_risk_delta !== undefined) {
    if (typeof scenario.buyer_risk_delta !== "number" || isNaN(scenario.buyer_risk_delta)) {
      return { valid: false, error: "buyer_risk_delta must be a valid number" };
    }
    if (scenario.buyer_risk_delta < -1.0 || scenario.buyer_risk_delta > 1.0) {
      return { valid: false, error: "buyer_risk_delta out of acceptable range (-1.0 to +1.0)" };
    }
  }

  if (scenario.buyer_risk_override !== undefined) {
    if (typeof scenario.buyer_risk_override !== "number" || isNaN(scenario.buyer_risk_override)) {
      return { valid: false, error: "buyer_risk_override must be a valid number" };
    }
    if (scenario.buyer_risk_override < 0.0 || scenario.buyer_risk_override > 1.0) {
      return { valid: false, error: "buyer_risk_override must be between 0.0 and 1.0" };
    }
  }

  if (scenario.temperature_delta !== undefined) {
    if (typeof scenario.temperature_delta !== "number" || isNaN(scenario.temperature_delta)) {
      return { valid: false, error: "temperature_delta must be a valid number" };
    }
    if (scenario.temperature_delta < -30 || scenario.temperature_delta > 30) {
      return { valid: false, error: "temperature_delta out of acceptable range (-30°C to +30°C)" };
    }
  }

  if (scenario.condition_override !== undefined) {
    if (typeof scenario.condition_override !== "string") {
      return { valid: false, error: "condition_override must be a string" };
    }
    if (!VALID_CONDITIONS.includes(scenario.condition_override)) {
      return {
        valid: false,
        error: `Invalid condition_override '${scenario.condition_override}'. Supported: ${VALID_CONDITIONS.join(", ")}`,
      };
    }
  }

  if (scenario.stage_override !== undefined) {
    if (typeof scenario.stage_override !== "string") {
      return { valid: false, error: "stage_override must be a string" };
    }
    const allValidStages = ["NEW", ...STAGES];
    if (!allValidStages.includes(scenario.stage_override)) {
      return {
        valid: false,
        error: `Invalid stage_override '${scenario.stage_override}'. Supported: ${allValidStages.join(", ")}`,
      };
    }
  }

  if (scenario.scenario_name !== undefined && typeof scenario.scenario_name !== "string") {
    return { valid: false, error: "scenario_name must be a string" };
  }

  return { valid: true };
}

/**
 * Deep clone an AssetRecord cleanly to avoid mutating real digital twins.
 */
export function deepCloneAsset(asset: AssetRecord): AssetRecord {
  if (typeof structuredClone === "function") {
    return structuredClone(asset);
  }
  return JSON.parse(JSON.stringify(asset));
}

/**
 * Simulates a hypothetical what-if scenario on a clone of the digital twin.
 * Pure function: Does NOT modify real asset, SQLite, ledger, or runtime registry.
 */
export function simulateShadowScenario(
  asset: AssetRecord,
  scenario: ShadowScenario
): ShadowSimulationResult {
  // 1. Calculate Authoritative Baseline Metrics
  const baseRisk = computeRisk(asset);
  const baseEffLtv = effectiveLtv(asset);
  const orderValue = asset.order_value || 5000000;
  const baseCapacity = Math.floor(orderValue * baseEffLtv);
  const baseDrawn = asset.financial?.drawn || 0;
  const baseSafeLimit = Math.max(baseCapacity - baseDrawn, 0);
  const baseHeadroom = baseSafeLimit;
  const baseFrozen = baseCapacity < baseDrawn;

  const baselineSnapshot: ShadowMetricSnapshot = {
    stage: asset.stage || "NEW",
    risk_index: baseRisk,
    effective_ltv: baseEffLtv,
    capacity: baseCapacity,
    drawn: baseDrawn,
    safe_limit: baseSafeLimit,
    headroom: baseHeadroom,
    frozen: baseFrozen,
    condition: asset.physical?.condition || "OK",
    delay_days: asset.physical?.delay_days || 0,
    buyer_risk: asset.contractual?.buyer_risk !== undefined ? asset.contractual.buyer_risk : 0.15,
  };

  // 2. Create isolated deep clone
  const shadow = deepCloneAsset(asset);

  // 3. Apply Scenario Modifications ONLY to the shadow clone
  if (scenario.stage_override) {
    shadow.stage = scenario.stage_override;
  }

  // Delay modifications (clamped to 0..30 days)
  if (typeof scenario.delay_days_override === "number") {
    shadow.physical.delay_days = Math.max(0, Math.min(30, Math.round(scenario.delay_days_override)));
  } else if (typeof scenario.delay_days_delta === "number") {
    const currentDelay = shadow.physical.delay_days || 0;
    shadow.physical.delay_days = Math.max(0, Math.min(30, Math.round(currentDelay + scenario.delay_days_delta)));
  }

  // Condition & Temperature modifications
  if (scenario.condition_override) {
    shadow.physical.condition = scenario.condition_override;
  } else if (typeof scenario.temperature_delta === "number") {
    // Domain rule: temperature_delta >= +4°C triggers "DEGRADED (heat)"
    if (scenario.temperature_delta >= 4) {
      shadow.physical.condition = "DEGRADED (heat)";
    }
    // temperature_delta < +4°C does not alter condition automatically
  }

  // Buyer risk modifications (clamped to 0.0..1.0)
  if (typeof scenario.buyer_risk_override === "number") {
    shadow.contractual.buyer_risk = Math.max(0.0, Math.min(1.0, Math.round(scenario.buyer_risk_override * 100) / 100));
  } else if (typeof scenario.buyer_risk_delta === "number") {
    const currentBuyerRisk = shadow.contractual.buyer_risk !== undefined ? shadow.contractual.buyer_risk : 0.15;
    shadow.contractual.buyer_risk = Math.max(0.0, Math.min(1.0, Math.round((currentBuyerRisk + scenario.buyer_risk_delta) * 100) / 100));
  }

  // 4. Run Authoritative Engines on Shadow Clone
  // Step A: Calculate risk for shadow
  const predRisk = computeRisk(shadow);
  shadow.risk_index = predRisk;

  // Step B: Recompute finance using authoritative engine
  const { capacity: predCapacity, headroom: predHeadroom } = recomputeFinance(shadow);

  // Step C: Calculate effective LTV
  const predEffLtv = effectiveLtv(shadow);
  const predDrawn = shadow.financial?.drawn || 0;
  const predSafeLimit = shadow.financial?.safe_limit || 0;
  const predFrozen = shadow.financial?.frozen || false;

  const predictedSnapshot: ShadowMetricSnapshot = {
    stage: shadow.stage,
    risk_index: predRisk,
    effective_ltv: predEffLtv,
    capacity: predCapacity,
    drawn: predDrawn,
    safe_limit: predSafeLimit,
    headroom: predHeadroom,
    frozen: predFrozen,
    condition: shadow.physical.condition,
    delay_days: shadow.physical.delay_days,
    buyer_risk: shadow.contractual.buyer_risk,
  };

  // 5. Differential Deltas
  const riskIndexDelta = Math.round((predRisk - baseRisk) * 100) / 100;
  const effLtvDelta = Math.round((predEffLtv - baseEffLtv) * 1000) / 1000;
  const capacityDelta = predCapacity - baseCapacity;
  const safeLimitDelta = predSafeLimit - baseSafeLimit;
  const headroomDelta = predHeadroom - baseHeadroom;
  const frozenChanged = baseFrozen !== predFrozen;

  // 6. Impact Warnings
  const warnings: string[] = [];

  if (predFrozen && !baseFrozen) {
    warnings.push("Projected drawdown freeze: simulated credit capacity drops below active drawn financing.");
  }
  if (headroomDelta < 0) {
    warnings.push(`Safe financing capacity decreases by ₹${Math.abs(headroomDelta).toLocaleString("en-IN")}.`);
  }
  if (riskIndexDelta >= 0.15) {
    warnings.push(`Risk increased materially (+${riskIndexDelta.toFixed(2)}).`);
  }
  if (shadow.physical.delay_days >= 7) {
    warnings.push(`Scenario pushes delay to ${shadow.physical.delay_days} days, exceeding normal transit tolerance.`);
  }
  if (shadow.physical.condition !== "OK" && asset.physical?.condition === "OK") {
    warnings.push(`Cargo condition degradation flagged: '${shadow.physical.condition}'.`);
  }

  return {
    asset_id: asset.id,
    asset_name: asset.name,
    order_value: orderValue,
    scenario_name: scenario.scenario_name || "Custom Hypothetical Simulation",
    timestamp: new Date().toISOString(),
    baseline: baselineSnapshot,
    predicted: predictedSnapshot,
    delta: {
      risk_index_delta: riskIndexDelta,
      effective_ltv_delta: effLtvDelta,
      capacity_delta: capacityDelta,
      safe_limit_delta: safeLimitDelta,
      headroom_delta: headroomDelta,
      frozen_changed: frozenChanged,
      now_frozen: predFrozen,
    },
    warnings,
  };
}
