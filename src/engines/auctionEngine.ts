import { assetRegistry } from "../state/assetRuntime";
import { auctionRepo, financingRepo } from "../db";
import { wsManager } from "../websocket/wsManager";

export const BOTS = [
  { name: "Cautious Bank", start: 14.0, floor: 11.0, step: 0.35 },
  { name: "Aggressive NBFC", start: 13.0, floor: 8.5, step: 0.9 },
  { name: "Balanced Fintech", start: 13.5, floor: 9.5, step: 0.6 },
];

export async function runAuction(
  assetId: string,
  amount: number,
  pushMsg: (assetId: string, agent: string, reason: string) => Promise<void>
) {
  const auction = assetRegistry.getAuction(assetId);
  const asset = assetRegistry.getAsset(assetId) || assetRegistry.getDefaultAsset();

  auction.active = true;
  auction.amount = amount;
  auction.best = null;
  auction.bids = {
    "Cautious Bank": 14.0,
    "Aggressive NBFC": 13.0,
    "Balanced Fintech": 13.5,
  };

  const risk_pts = (asset.risk_index || 0.08) * 4;
  wsManager.broadcast({ kind: "auction_start", asset_id: assetId, amount });

  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 1200));
    for (const bot of BOTS) {
      const curr = auction.bids[bot.name];
      const botFloor = bot.floor + risk_pts;
      if (curr > botFloor && Math.random() < 0.85) {
        const cut = Math.random() * (bot.step - 0.2) + 0.2;
        const newRate = Math.round(Math.max(bot.floor, curr - cut) * 100) / 100;
        auction.bids[bot.name] = newRate;

        if (auction.currentSessionId) {
          auctionRepo.addBid({
            session_id: auction.currentSessionId,
            asset_id: assetId,
            lender: bot.name,
            rate: newRate,
          });
        }

        wsManager.broadcast({ kind: "bid", asset_id: assetId, lender: bot.name, rate: newRate });
      }
    }
  }

  let minBot = "Aggressive NBFC";
  let minRate = Infinity;
  for (const name of Object.keys(auction.bids)) {
    const rate = auction.bids[name];
    if (typeof rate === "number" && rate < minRate) {
      minRate = rate;
      minBot = name;
    }
  }

  const best = { lender: minBot, rate: minRate };
  auction.best = best;
  auction.active = false;

  if (auction.currentSessionId) {
    auctionRepo.updateSession(auction.currentSessionId, "CONCLUDED", best.lender, best.rate);
  }
  if (auction.currentFinancingRecordId) {
    financingRepo.updateStatus(auction.currentFinancingRecordId, "OFFER_AVAILABLE", {
      lender: best.lender,
      rate: best.rate,
      amount,
    });
  }

  wsManager.broadcast({ kind: "auction_end", asset_id: assetId, best, amount });
  await pushMsg(
    assetId,
    "Loan",
    `Bank battle over — best offer ${best.rate.toFixed(2)}% from ${best.lender} for ₹${amount.toLocaleString("en-IN")}.`
  );
}
