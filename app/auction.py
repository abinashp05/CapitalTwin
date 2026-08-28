import asyncio
import random
from . import state
from . import bus

BOTS = [
    {"name": "Cautious Bank", "start": 14.0, "floor": 11.0, "step": 0.35},
    {"name": "Aggressive NBFC", "start": 13.0, "floor": 8.5, "step": 0.9},
    {"name": "Balanced Fintech", "start": 13.5, "floor": 9.5, "step": 0.6},
]

async def run(amount: int) -> None:
    amount = int(amount)
    state.AUCTION["active"] = True
    state.AUCTION["amount"] = amount
    state.AUCTION["best"] = None
    state.AUCTION["bids"] = {bot["name"]: bot["start"] for bot in BOTS}
    
    risk_pts = state.ASSET.get("risk_index", 0.08) * 4
    await bus.broadcast({"kind": "auction_start", "amount": amount})
    
    for _ in range(6):
        await asyncio.sleep(1.2)
        for bot in BOTS:
            name = bot["name"]
            curr_rate = state.AUCTION["bids"][name]
            bot_floor = bot["floor"] + risk_pts
            if curr_rate > bot_floor and random.random() < 0.85:
                cut = random.uniform(0.2, bot["step"])
                new_rate = round(max(bot["floor"], curr_rate - cut), 2)
                state.AUCTION["bids"][name] = new_rate
                await bus.broadcast({"kind": "bid", "lender": name, "rate": new_rate})
                
    min_bot = min(state.AUCTION["bids"], key=state.AUCTION["bids"].get)
    min_rate = state.AUCTION["bids"][min_bot]
    best = {"lender": min_bot, "rate": round(min_rate, 2)}
    
    state.AUCTION["best"] = best
    state.AUCTION["active"] = False
    
    await bus.broadcast({"kind": "auction_end", "best": best, "amount": amount})
    
    formatted_amount = f"{amount:,}"
    rate_str = f"{best['rate']:.2f}%"
    best_lender = best["lender"]
    await bus.push_msg(
        "Loan",
        f"Bank battle over \u2014 best offer {rate_str} from {best_lender} for \u20b9{formatted_amount}.",
    )
