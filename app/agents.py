import os
from . import bus
from . import state

async def ai_reason(role: str, context: str, fallback: str) -> str:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return fallback
    try:
        import urllib.request
        import json
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
        headers = {"Content-Type": "application/json"}
        prompt = f"You are CapitalTwin's AI {role} Agent for supply chain financing. Context: {context}. Give a concise, professional, clear 1-2 sentence response. Direct facts only."
        data = json.dumps({"contents": [{"parts": [{"text": prompt}]}]}).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=4) as response:
            res_body = json.loads(response.read().decode("utf-8"))
            text = res_body["candidates"][0]["content"]["parts"][0]["text"].strip()
            return text if text else fallback
    except Exception:
        return fallback

async def run(asset: dict, event_type: str) -> None:
    stage = asset.get("stage", "")
    risk = asset.get("risk_index", 0.08)
    safe_lim = asset.get("financial", {}).get("safe_limit", 0)
    safe_str = f"{safe_lim:,}"
    
    if event_type == "ORDER_CONFIRMED":
        await bus.push_msg(
            "Tracker",
            "Order confirmed for 10,000 t-shirts by BigRetail. Title registered to Ravi Textiles.",
        )
        await bus.push_msg(
            "Risk",
            f"Initial baseline risk assessed at {risk:.2f}. Buyer BigRetail credit rating rated AA.",
        )
        await bus.push_msg(
            "Loan",
            f"Safe financing headroom established at \u20b9{safe_str} (50% LTV). Available for PO drawdown.",
        )
    elif event_type == "RAW_PROCURED":
        await bus.push_msg(
            "Tracker",
            "Yarn & dye procured at Ravi's factory. Value added to physical asset.",
        )
        await bus.push_msg(
            "Loan",
            f"Stage advanced to RAW_PROCURED. Base LTV elevated to 55%. Safe limit updated to \u20b9{safe_str}.",
        )
    elif event_type == "PRODUCED":
        await bus.push_msg(
            "Tracker",
            "10,000 t-shirts manufactured and quality checked at Factory store.",
        )
        await bus.push_msg(
            "Loan",
            f"Stage updated to FINISHED_GOODS. Inventory financing headroom unlocked at 65% LTV (\u20b9{safe_str}).",
        )
    elif event_type == "SHIPPED":
        await bus.push_msg(
            "Tracker",
            "Consignment in transit on NH-48 via GPS-tracked container fleet.",
        )
        await bus.push_msg(
            "Risk",
            "In-transit sensors online. Telemetry and route adherence normal.",
        )
        await bus.push_msg(
            "Loan",
            f"LTV increased to 75% for in-transit financing (\u20b9{safe_str} safe headroom).",
        )
    elif event_type == "DELAYED":
        delay = asset.get("physical", {}).get("delay_days", 3)
        await bus.push_msg(
            "Tracker",
            f"Logistics alert: +3 days transit delay reported (total delay: {delay}d) due to highway congestion.",
        )
        await bus.push_msg(
            "Risk",
            f"Transit delay detected (+3 days). Risk index adjusted upwards to {risk:.2f}. Financing capacity scaled down.",
        )
    elif event_type == "TEMP_SPIKE":
        await bus.push_msg(
            "Tracker",
            "Sensor telemetry alert: Cold-chain/ambient temperature spike detected in transit container.",
        )
        await bus.push_msg(
            "Risk",
            f"Condition marked DEGRADED (heat). Risk index elevated to {risk:.2f} to account for inspection buffer.",
        )
    elif event_type == "WAREHOUSED":
        await bus.push_msg(
            "Tracker",
            "Goods safely received and checked in at Chennai WH-7.",
        )
        await bus.push_msg(
            "Loan",
            f"Warehouse financing active at 80% LTV. Headroom recomputed to \u20b9{safe_str}.",
        )
    elif event_type == "DELIVERED":
        await bus.push_msg(
            "Tracker",
            "Proof of Delivery logged at BigRetail DC. Delay counter reset to 0.",
        )
        await bus.push_msg(
            "Risk",
            f"Delivery confirmed. Physical transit risk resolved to baseline ({risk:.2f}).",
        )
        await bus.push_msg(
            "Loan",
            f"Trade financing headroom expanded to 85% LTV (\u20b9{safe_str}).",
        )
    elif event_type == "INVOICED":
        await bus.push_msg(
            "Tracker",
            "Commercial Invoice raised for \u20b950,00,000 under net-60 terms with BigRetail.",
        )
        await bus.push_msg(
            "Loan",
            f"Invoice financing unlocked at maximum 90% LTV (\u20b9{safe_str} safe headroom).",
        )
    elif event_type == "RECEIVABLE_DELAYED":
        await bus.push_msg(
            "Tracker",
            "Payment alert: BigRetail missed day-60 settlement schedule.",
        )
        await bus.push_msg(
            "Risk",
            f"Buyer risk elevated (+0.35). Risk index adjusted to {risk:.2f}; credit headroom constrained.",
        )
