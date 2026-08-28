import asyncio
from app import state, finance, bus, ledger, auction

def run_tests():
    print("=== RUNNING TRUST & AUCTION TESTS ===")
    state.reset()
    
    # Collector monkeypatches
    broadcasts = []
    messages = []
    
    async def mock_broadcast(obj):
        broadcasts.append(obj)
        
    async def mock_push_msg(agent, reason):
        messages.append({"agent": agent, "reason": reason})
        
    bus.broadcast = mock_broadcast
    bus.push_msg = mock_push_msg
    
    # Test 1: Add records and verify chain
    print("\n--- Test 1: Add two financing + one settlement ---")
    rec1 = ledger.add("ORD-123", "financing", "Cautious Bank", 1000000, "PO financing")
    rec2 = ledger.add("ORD-123", "financing", "Aggressive NBFC", 500000, "Procurement financing")
    rec3 = ledger.add("ORD-123", "settlement", "Cautious Bank", -1000000, "Repayment")
    
    chain_ok = ledger.verify()
    claims = ledger.total_claims("ORD-123")
    
    assert chain_ok is True, "Chain should be valid"
    assert claims == 1500000, f"Expected 1,500,000 claims, got {claims}"
    print("PASS: Ledger verify and total_claims correct.")
    
    # Test 2: Tamper with middle record
    print("\n--- Test 2: Tamper detection ---")
    original_amount = state.LEDGER[1]["amount"]
    state.LEDGER[1]["amount"] = 9999999
    tamper_verified = ledger.verify()
    assert tamper_verified is False, "Tampered chain should fail verify()"
    print("tamper detected \u2713")
    print("PASS: Tamper detection verified.")
    
    # Test 3: Restore and check() assertions
    print("\n--- Test 3: Ownership and capacity checks ---")
    state.LEDGER[1]["amount"] = original_amount
    assert ledger.verify() is True, "Restored chain must be valid"
    
    state.ASSET["stage"] = "PO_ISSUED"
    state.ASSET["contractual"]["owner"] = "Ravi Textiles"
    state.ASSET["order_value"] = 5000000
    state.ASSET["risk_index"] = 0.08
    
    # 3a: Wrong owner check
    ok_owner, reason_owner = ledger.check("ORD-123", 500000, "ShadyLend Corp")
    assert ok_owner is False, "Should block wrong owner"
    assert reason_owner.startswith("BLOCKED \u2014"), f"Reason should start with 'BLOCKED —', got: {reason_owner}"
    print(f"PASS: Wrong owner blocked: {reason_owner}")
    
    # 3b: Over-capacity ask
    # Existing claims = 1,500,000. Base LTV for PO_ISSUED is 0.50. Eff LTV = 0.50 * (1 - 0.4*0.08) = 0.484. Safe cap = 2,420,000.
    # Asking 2,000,000 -> 1,500,000 + 2,000,000 = 3,500,000 > 2,420,000 -> BLOCKED
    ok_cap, reason_cap = ledger.check("ORD-123", 2000000, "Ravi Textiles")
    assert ok_cap is False, "Should block over-capacity ask"
    assert reason_cap.startswith("BLOCKED \u2014"), f"Reason should start with 'BLOCKED —', got: {reason_cap}"
    print(f"PASS: Over-capacity blocked: {reason_cap}")
    
    # 3c: Legitimate ask
    # Asking 500,000 -> 1,500,000 + 500,000 = 2,000,000 <= 2,420,000 -> CLEAR
    ok_legit, reason_legit = ledger.check("ORD-123", 500000, "Ravi Textiles")
    assert ok_legit is True, "Legitimate request within capacity should pass"
    assert reason_legit == "clear", f"Expected 'clear', got: {reason_legit}"
    print(f"PASS: Legitimate check cleared.")
    
    # Test 4: Auction runner
    print("\n--- Test 4: Reverse Auction Engine ---")
    broadcasts.clear()
    messages.clear()
    state.ASSET["stage"] = "PO_ISSUED"
    state.ASSET["risk_index"] = 0.15
    risk_pts = 0.15 * 4 # 0.60
    
    asyncio.run(auction.run(1000000))
    
    bids = [b for b in broadcasts if b.get("kind") == "bid"]
    starts = [b for b in broadcasts if b.get("kind") == "auction_start"]
    ends = [b for b in broadcasts if b.get("kind") == "auction_end"]
    
    assert len(starts) == 1, "Expected 1 auction_start"
    assert len(bids) >= 6, f"Expected at least 6 bids, got {len(bids)}"
    assert len(ends) == 1, "Expected 1 auction_end"
    
    bot_floors = {bot["name"]: bot["floor"] for bot in auction.BOTS}
    for b in bids:
        lender = b["lender"]
        rate = b["rate"]
        expected_floor = bot_floors[lender]
        assert rate >= expected_floor, f"Rate {rate} below floor {expected_floor} for {lender}"
        
    best_rate = state.AUCTION["best"]["rate"]
    min_recorded_rate = min(state.AUCTION["bids"].values())
    assert best_rate == min_recorded_rate, f"Best rate {best_rate} should equal minimum recorded {min_recorded_rate}"
    
    print(f"PASS: Auction completed successfully with {len(bids)} bids. Winner: {state.AUCTION['best']['lender']} @ {best_rate}%.")
    print("\nALL TRUST & AUCTION TESTS PASSED \u2713")

if __name__ == "__main__":
    run_tests()
