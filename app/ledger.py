import hashlib
from . import state
from . import finance

def add(asset_id: str, rtype: str, lender: str, amount: int, note: str = "") -> dict:
    prev_hash = state.LEDGER[-1]["hash"] if state.LEDGER else "GENESIS"
    ts = state.now_ts()
    amount_int = int(amount)
    raw = f"{prev_hash}{asset_id}{rtype}{lender}{amount_int}{ts}"
    h = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    record = {
        "asset_id": asset_id,
        "type": rtype,
        "lender": lender,
        "amount": amount_int,
        "note": note,
        "ts": ts,
        "prev_hash": prev_hash,
        "hash": h,
    }
    state.LEDGER.append(record)
    return record

def verify() -> bool:
    if not state.LEDGER:
        return True
    for i, rec in enumerate(state.LEDGER):
        expected_prev = state.LEDGER[i - 1]["hash"] if i > 0 else "GENESIS"
        if rec.get("prev_hash") != expected_prev:
            return False
        raw = f"{rec.get('prev_hash')}{rec.get('asset_id')}{rec.get('type')}{rec.get('lender')}{rec.get('amount')}{rec.get('ts')}"
        computed_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        if rec.get("hash") != computed_hash:
            return False
    return True

def total_claims(asset_id: str) -> int:
    return sum(
        rec.get("amount", 0)
        for rec in state.LEDGER
        if rec.get("asset_id") == asset_id and rec.get("type") == "financing"
    )

def check(asset_id: str, amount: int, requester: str) -> tuple[bool, str]:
    owner = state.ASSET.get("contractual", {}).get("owner", state.OWNER)
    if requester != owner:
        return (
            False,
            f"BLOCKED \u2014 requester '{requester}' does not own {asset_id}; title is with {owner}.",
        )
    existing = total_claims(asset_id)
    eff_ltv = finance.effective_ltv(state.ASSET)
    order_val = state.ASSET.get("order_value", 5000000)
    safe_cap = int(order_val * eff_ltv)
    if existing + amount > safe_cap:
        return (
            False,
            f"BLOCKED \u2014 claims would exceed safe capacity (existing \u20b9{existing:,} + requested \u20b9{amount:,} > \u20b9{safe_cap:,}).",
        )
    return (True, "clear")
