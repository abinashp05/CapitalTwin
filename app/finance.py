from . import state

def compute_risk(a: dict) -> float:
    buyer_risk = a.get("contractual", {}).get("buyer_risk", 0.15)
    delay_days = a.get("physical", {}).get("delay_days", 0)
    condition = a.get("physical", {}).get("condition", "OK")
    cond_factor = 0.7 if condition != "OK" else 0.0
    delay_factor = min(delay_days / 10.0, 1.0)
    raw = 0.40 * buyer_risk + 0.25 * delay_factor + 0.20 * cond_factor + 0.15 * 0.10
    clamped = max(0.0, min(1.0, raw))
    return round(clamped, 2)

def effective_ltv(a: dict) -> float:
    stage = a.get("stage", "NEW")
    base = state.BASE_LTV.get(stage, 0.0)
    risk = compute_risk(a)
    eff = base * (1.0 - 0.4 * risk)
    return round(eff, 3)

def recompute_finance(a: dict) -> tuple[int, int]:
    risk = compute_risk(a)
    a["risk_index"] = risk
    eff = effective_ltv(a)
    order_value = a.get("order_value", 5000000)
    drawn = a.get("financial", {}).get("drawn", 0)
    capacity = int(order_value * eff)
    headroom = max(capacity - drawn, 0)
    
    if "financial" not in a:
        a["financial"] = {}
    a["financial"]["safe_limit"] = headroom
    a["financial"]["frozen"] = (capacity < drawn)
    
    stage = a.get("stage", "NEW")
    if stage in state.INSTRUMENT:
        curr_inst = a["financial"].get("instrument", "")
        if curr_inst in ("", "\u2014", "—") and stage != "NEW":
            a["financial"]["instrument"] = state.INSTRUMENT[stage]

    return (capacity, headroom)
