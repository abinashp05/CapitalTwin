import json
from . import state

CLIENTS = set()

async def broadcast(obj: dict):
    if not CLIENTS:
        return
    msg = json.dumps(obj)
    dead = set()
    for ws in list(CLIENTS):
        try:
            await ws.send_text(msg)
        except Exception:
            dead.add(ws)
    for ws in dead:
        CLIENTS.discard(ws)

async def push_twin():
    payload = {
        "kind": "twin_update",
        "asset": state.ASSET,
        "meta": {
            "fraud_blocked": state.COUNTERS.get("fraud_blocked", 0),
            "ledger_count": len(state.LEDGER),
        },
    }
    await broadcast(payload)

async def push_msg(agent: str, reason: str):
    ts = state.now_ts()
    entry = {"agent": agent, "reason": reason, "ts": ts}
    if "history" not in state.ASSET:
        state.ASSET["history"] = []
    state.ASSET["history"].append(entry)
    if len(state.ASSET["history"]) > 40:
        state.ASSET["history"] = state.ASSET["history"][-40:]
    
    payload = {
        "kind": "agent_message",
        "agent": agent,
        "reason": reason,
        "ts": ts,
    }
    await broadcast(payload)

async def push_ledger():
    payload = {
        "kind": "ledger_update",
        "records": state.LEDGER,
    }
    await broadcast(payload)
