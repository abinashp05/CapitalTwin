import datetime

STAGES = [
    "PO_ISSUED",
    "RAW_PROCURED",
    "IN_PRODUCTION",
    "FINISHED_GOODS",
    "IN_TRANSIT",
    "WAREHOUSED",
    "DELIVERED",
    "INVOICED",
    "SETTLED",
]

BASE_LTV = {
    "PO_ISSUED": 0.50,
    "RAW_PROCURED": 0.55,
    "IN_PRODUCTION": 0.60,
    "FINISHED_GOODS": 0.65,
    "IN_TRANSIT": 0.75,
    "WAREHOUSED": 0.80,
    "DELIVERED": 0.85,
    "INVOICED": 0.90,
    "SETTLED": 0.0,
}

INSTRUMENT = {
    "PO_ISSUED": "PO financing",
    "RAW_PROCURED": "procurement financing",
    "IN_PRODUCTION": "procurement financing",
    "FINISHED_GOODS": "inventory financing",
    "IN_TRANSIT": "in-transit financing",
    "WAREHOUSED": "warehouse financing",
    "DELIVERED": "trade financing",
    "INVOICED": "invoice financing",
    "SETTLED": "settled",
}

CASH_NEED = {
    "PO_ISSUED": 1000000,
    "RAW_PROCURED": 1800000,
    "IN_PRODUCTION": 1200000,
    "FINISHED_GOODS": 800000,
    "IN_TRANSIT": 600000,
    "WAREHOUSED": 500000,
    "DELIVERED": 400000,
    "INVOICED": 400000,
    "SETTLED": 0,
}

OWNER = "Ravi Textiles"

USERS = {
    "ravi": {"pw": "demo123", "role": "supplier", "name": "Ravi Kumar", "org": "Ravi Textiles"},
    "lender": {"pw": "demo123", "role": "lender", "name": "Alex Mercer", "org": "NBFC Capital"},
    "admin": {"pw": "demo123", "role": "admin", "name": "Demo Director", "org": "CapitalTwin"},
}

def now_ts() -> str:
    return datetime.datetime.now().strftime("%H:%M:%S")

def fresh_asset() -> dict:
    return {
        "id": "ORD-123",
        "name": "10,000 t-shirts",
        "order_value": 5000000,
        "stage": "NEW",
        "physical": {
            "location": "Ravi's factory",
            "condition": "OK",
            "delay_days": 0,
        },
        "financial": {
            "drawn": 0,
            "instrument": "\u2014",
            "safe_limit": 0,
            "lender": "\u2014",
            "rate": 0.0,
            "frozen": False,
        },
        "contractual": {
            "buyer": "BigRetail",
            "terms": "net-60",
            "owner": "Ravi Textiles",
            "buyer_risk": 0.15,
            "expected_cash_date": "\u2014",
        },
        "risk_index": 0.08,
        "history": [],
    }

ASSET = fresh_asset()
LEDGER: list = []
COUNTERS = {"fraud_blocked": 0}
AUCTION = {"active": False, "amount": 0, "best": None, "bids": {}}

def reset():
    global ASSET, LEDGER, COUNTERS, AUCTION
    ASSET.clear()
    ASSET.update(fresh_asset())
    LEDGER.clear()
    COUNTERS["fraud_blocked"] = 0
    AUCTION.clear()
    AUCTION.update({"active": False, "amount": 0, "best": None, "bids": {}})
