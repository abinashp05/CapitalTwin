import os
import json
import asyncio
import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Response, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import state
from . import finance
from . import bus
from . import ledger
from . import auction
from . import agents

app = FastAPI(title="CapitalTwin")

# Read index.html if available
INDEX_HTML = ""
INDEX_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "index.html")
if os.path.exists(INDEX_PATH):
    with open(INDEX_PATH, "r", encoding="utf-8") as f:
        INDEX_HTML = f.read()

# Mount vendor static files
VENDOR_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "vendor")
if os.path.exists(VENDOR_PATH):
    app.mount("/vendor", StaticFiles(directory=VENDOR_PATH), name="vendor")

@app.get("/", response_class=HTMLResponse)
async def get_index():
    if os.path.exists(INDEX_PATH):
        with open(INDEX_PATH, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content=INDEX_HTML)

@app.post("/login")
async def post_login(req: Request):
    data = await req.json()
    username = data.get("username", "")
    password = data.get("password", "")
    
    user = state.USERS.get(username)
    if not user or user.get("pw") != password:
        return JSONResponse(status_code=401, content={"ok": False, "why": "Invalid username or password"})
    
    return {
        "ok": True,
        "username": username,
        "role": user["role"],
        "name": user["name"],
        "org": user["org"],
    }

@app.get("/asset/{asset_id}")
async def get_asset(asset_id: str):
    finance.recompute_finance(state.ASSET)
    return {
        "asset": state.ASSET,
        "meta": {
            "fraud_blocked": state.COUNTERS.get("fraud_blocked", 0),
            "ledger_count": len(state.LEDGER),
        },
    }

@app.get("/ledger/{asset_id}")
async def get_ledger(asset_id: str):
    return {
        "records": state.LEDGER,
        "chain_ok": ledger.verify(),
    }

@app.post("/event")
async def post_event(req: Request):
    data = await req.json()
    asset_id = data.get("asset_id", "ORD-123")
    etype = data.get("type", "")
    
    asset = state.ASSET
    order_val = asset.get("order_value", 5000000)
    
    if etype == "DOUBLE_FINANCE_ATTEMPT":
        ok, reason = ledger.check(asset_id, int(order_val * 0.6), "ShadyLend Corp")
        state.COUNTERS["fraud_blocked"] += 1
        verify_str = " Ledger chain verified: intact \u2713" if ledger.verify() else " TAMPERED"
        full_msg = reason + verify_str
        await bus.push_msg("Fraud", full_msg)
        await bus.push_twin()
        return {"blocked": True, "reason": full_msg}
        
    elif etype == "BUYER_PAID":
        asset["stage"] = "SETTLED"
        drawn = asset.get("financial", {}).get("drawn", 0)
        lender_name = asset.get("financial", {}).get("lender", "\u2014")
        if drawn > 0:
            ledger.add(asset_id, "settlement", lender_name, -drawn, "loan repaid from buyer payment")
            await bus.push_ledger()
        
        asset["financial"]["drawn"] = 0
        asset["financial"]["rate"] = 0.0
        asset["financial"]["instrument"] = "settled"
        asset["financial"]["lender"] = "\u2014"
        finance.recompute_finance(asset)
        
        order_str = f"{order_val:,}"
        drawn_str = f"{drawn:,}"
        await bus.push_msg(
            "Transition",
            f"Buyer paid \u20b9{order_str} \u2014 loan of \u20b9{drawn_str} settled itself; lifecycle complete.",
        )
        await bus.push_twin()
        return {"ok": True, "stage": "SETTLED"}

    elif etype == "ORDER_CONFIRMED":
        asset["stage"] = "PO_ISSUED"
        asset["physical"]["location"] = "Ravi's factory"
        exp_date = datetime.date.today() + datetime.timedelta(days=135)
        asset["contractual"]["expected_cash_date"] = exp_date.strftime("%d %b")
        finance.recompute_finance(asset)
        await agents.run(asset, etype)
        await bus.push_twin()
        return {"ok": True, "stage": asset["stage"]}
        
    elif etype == "RAW_PROCURED":
        asset["stage"] = "RAW_PROCURED"
        asset["physical"]["location"] = "Ravi's factory"
        finance.recompute_finance(asset)
        await agents.run(asset, etype)
        await bus.push_twin()
        return {"ok": True, "stage": asset["stage"]}
        
    elif etype == "PRODUCED":
        asset["stage"] = "FINISHED_GOODS"
        asset["physical"]["location"] = "Factory store"
        finance.recompute_finance(asset)
        await agents.run(asset, etype)
        await bus.push_twin()
        return {"ok": True, "stage": asset["stage"]}
        
    elif etype == "SHIPPED":
        asset["stage"] = "IN_TRANSIT"
        asset["physical"]["location"] = "NH-48, in transit"
        finance.recompute_finance(asset)
        await agents.run(asset, etype)
        await bus.push_twin()
        return {"ok": True, "stage": asset["stage"]}
        
    elif etype == "DELAYED":
        asset["physical"]["delay_days"] = asset.get("physical", {}).get("delay_days", 0) + 3
        finance.recompute_finance(asset)
        await agents.run(asset, etype)
        await bus.push_twin()
        return {"ok": True, "delay_days": asset["physical"]["delay_days"]}
        
    elif etype == "TEMP_SPIKE":
        asset["physical"]["condition"] = "DEGRADED (heat)"
        finance.recompute_finance(asset)
        await agents.run(asset, etype)
        await bus.push_twin()
        return {"ok": True, "condition": asset["physical"]["condition"]}
        
    elif etype == "WAREHOUSED":
        asset["stage"] = "WAREHOUSED"
        asset["physical"]["location"] = "Chennai WH-7"
        finance.recompute_finance(asset)
        await agents.run(asset, etype)
        await bus.push_twin()
        return {"ok": True, "stage": asset["stage"]}
        
    elif etype == "DELIVERED":
        asset["stage"] = "DELIVERED"
        asset["physical"]["location"] = "BigRetail DC"
        asset["physical"]["delay_days"] = 0
        finance.recompute_finance(asset)
        await agents.run(asset, etype)
        await bus.push_twin()
        return {"ok": True, "stage": asset["stage"]}
        
    elif etype == "INVOICED":
        asset["stage"] = "INVOICED"
        finance.recompute_finance(asset)
        await agents.run(asset, etype)
        await bus.push_twin()
        return {"ok": True, "stage": asset["stage"]}
        
    elif etype == "RECEIVABLE_DELAYED":
        b_risk = asset.get("contractual", {}).get("buyer_risk", 0.15)
        asset["contractual"]["buyer_risk"] = round(min(1.0, b_risk + 0.35), 2)
        finance.recompute_finance(asset)
        await agents.run(asset, etype)
        await bus.push_twin()
        return {"ok": True, "buyer_risk": asset["contractual"]["buyer_risk"]}
        
    else:
        raise HTTPException(status_code=400, detail=f"Unknown event type: {etype}")

@app.post("/financing/request")
async def post_financing_request(req: Request):
    data = await req.json()
    asset_id = data.get("asset_id", "ORD-123")
    amount = data.get("amount")
    
    capacity, headroom = finance.recompute_finance(state.ASSET)
    
    if headroom <= 0:
        ok, reason = ledger.check(asset_id, int(amount or 1), state.ASSET.get("contractual", {}).get("owner", state.OWNER))
        state.COUNTERS["fraud_blocked"] += 1
        await bus.push_msg("Fraud", reason)
        await bus.push_twin()
        return JSONResponse(status_code=409, content={"blocked": True, "reason": reason})
        
    requested_amount = int(amount) if amount is not None and int(amount) > 0 else headroom
    final_amount = min(requested_amount, headroom)
    
    if final_amount < requested_amount:
        eff_ltv = finance.effective_ltv(state.ASSET)
        ltv_pct = int(eff_ltv * 100)
        req_str = f"{requested_amount:,}"
        final_str = f"{final_amount:,}"
        await bus.push_msg(
            "Loan",
            f"Requested \u20b9{req_str} exceeds the safe limit \u2014 capped to \u20b9{final_str} (LTV {ltv_pct}%).",
        )
        
    await bus.push_msg("Fraud", "Ledger check clear \u2014 no duplicate claims; ownership verified. Opening the bank battle.")
    asyncio.create_task(auction.run(final_amount))
    return {"auction": "started", "amount": final_amount}

@app.post("/financing/accept")
async def post_financing_accept(req: Request):
    best = state.AUCTION.get("best")
    if not best:
        raise HTTPException(status_code=400, detail="No active or concluded auction to accept.")
        
    asset = state.ASSET
    capacity, headroom = finance.recompute_finance(asset)
    amt = min(state.AUCTION.get("amount", headroom), headroom)
    if amt <= 0:
        amt = state.AUCTION.get("amount", 0)
        
    stage = asset.get("stage", "PO_ISSUED")
    instrument = state.INSTRUMENT.get(stage, "trade financing")
    
    ledger.add(asset.get("id", "ORD-123"), "financing", best["lender"], amt, instrument)
    
    asset["financial"]["drawn"] = asset.get("financial", {}).get("drawn", 0) + amt
    asset["financial"]["lender"] = best["lender"]
    asset["financial"]["rate"] = best["rate"]
    asset["financial"]["instrument"] = instrument
    finance.recompute_finance(asset)
    
    amt_str = f"{amt:,}"
    lender_name = best["lender"]
    rate_val = best["rate"]
    await bus.push_msg(
        "Loan",
        f"\u20b9{amt_str} disbursed by {lender_name} at {rate_val:.2f}% \u2014 recorded on the exposure ledger.",
    )
    await bus.push_ledger()
    await bus.push_twin()
    
    state.AUCTION["best"] = None
    return {"ok": True, "amount": amt, "lender": lender_name, "rate": rate_val}

@app.post("/ask")
async def post_ask(req: Request):
    data = await req.json()
    q = data.get("q", "")
    
    asset = state.ASSET
    finance.recompute_finance(asset)
    
    stage = asset.get("stage", "NEW")
    loc = asset.get("physical", {}).get("location", "Ravi's factory")
    risk = asset.get("risk_index", 0.08)
    safe = asset.get("financial", {}).get("safe_limit", 0)
    drawn = asset.get("financial", {}).get("drawn", 0)
    inst = asset.get("financial", {}).get("instrument", "\u2014")
    exp_cash = asset.get("contractual", {}).get("expected_cash_date", "\u2014")
    
    safe_str = f"{safe:,}"
    drawn_str = f"{drawn:,}"
    
    fallback = (
        f"Asset ORD-123 is at {stage} stage located at {loc} with risk index {risk:.2f}. "
        f"Safe financing limit is \u20b9{safe_str} with \u20b9{drawn_str} drawn under {inst}. "
        f"Expected cash date is {exp_cash}."
    )
    
    context = json.dumps(asset) + f" | User Question: {q}"
    answer = await agents.ai_reason("Assistant", context, fallback)
    await bus.push_msg("Assistant", answer)
    return {"answer": answer}

@app.get("/speak")
async def get_speak(text: str = ""):
    eleven_key = os.environ.get("ELEVENLABS_API_KEY")
    if not eleven_key or not text:
        return Response(status_code=503, content=b"ElevenLabs TTS unavailable")
    
    try:
        import httpx
        voice_id = os.environ.get("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        headers = {
            "xi-api-key": eleven_key,
            "Content-Type": "application/json",
        }
        body = {
            "text": text[:400],
            "model_id": "eleven_multilingual_v2",
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
        }
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.post(url, headers=headers, json=body)
            if resp.status_code == 200:
                return Response(content=resp.content, media_type="audio/mpeg")
            return Response(status_code=503, content=b"TTS Error")
    except Exception:
        return Response(status_code=503, content=b"TTS Connection Failed")

@app.post("/reset")
async def post_reset():
    state.reset()
    await bus.push_ledger()
    await bus.push_twin()
    await bus.push_msg("Tracker", "Demo reset \u2014 fresh asset ready.")
    return {"ok": True}

@app.websocket("/ws/live")
async def ws_live(websocket: WebSocket):
    await websocket.accept()
    bus.CLIENTS.add(websocket)
    try:
        # Initial pushes
        twin_payload = {
            "kind": "twin_update",
            "asset": state.ASSET,
            "meta": {
                "fraud_blocked": state.COUNTERS.get("fraud_blocked", 0),
                "ledger_count": len(state.LEDGER),
            },
        }
        await websocket.send_text(json.dumps(twin_payload))
        
        ledger_payload = {
            "kind": "ledger_update",
            "records": state.LEDGER,
        }
        await websocket.send_text(json.dumps(ledger_payload))
        
        while True:
            data = await websocket.receive_text()
            # client messages handled via REST or keepalive
    except WebSocketDisconnect:
        bus.CLIENTS.discard(websocket)
    except Exception:
        bus.CLIENTS.discard(websocket)
