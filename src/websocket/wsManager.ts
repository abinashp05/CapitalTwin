import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import { AssetRecord } from "../db/repositories/assetRepository";
import { LedgerBlock } from "../engines/ledgerEngine";
import { assetRegistry } from "../state/assetRuntime";
import { parseCookies } from "../auth/authMiddleware";
import { hashSessionToken } from "../auth/passwordUtils";
import { sessionRepo } from "../db";

export class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  init(server: http.Server, getLedger: () => LedgerBlock[], getCounters: () => { fraud_blocked: number }) {
    this.wss = new WebSocketServer({ server, path: "/ws/live" });

    this.wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
      // 1. Authenticate connection via Cookie or Query Token
      let token: string | null = null;
      const cookies = parseCookies(req.headers.cookie);
      if (cookies.capitaltwin_session) {
        token = cookies.capitaltwin_session;
      }

      if (!token && req.url) {
        try {
          const url = new URL(req.url, "http://localhost:3000");
          token = url.searchParams.get("token");
        } catch {
          // ignore URL parsing error
        }
      }

      if (!token) {
        ws.close(4401, "Unauthorized: No session token provided");
        return;
      }

      const tokenHash = hashSessionToken(token);
      const sessionData = sessionRepo.getSessionWithUser(tokenHash);
      if (!sessionData || !sessionData.user.is_active) {
        ws.close(4401, "Unauthorized: Invalid or expired session");
        return;
      }

      this.clients.add(ws);

      const defaultAsset = assetRegistry.getDefaultAsset();
      const ledger = getLedger();
      const counters = getCounters();
      const defaultLedgerCount = ledger.filter((r) => r.asset_id === defaultAsset.id).length;

      // Send initial welcome states
      ws.send(
        JSON.stringify({
          kind: "twin_update",
          asset_id: defaultAsset.id,
          asset: defaultAsset,
          meta: {
            fraud_blocked: counters.fraud_blocked,
            ledger_count: defaultLedgerCount,
          },
        })
      );

      ws.send(
        JSON.stringify({
          kind: "ledger_update",
          asset_id: defaultAsset.id,
          records: ledger,
        })
      );

      ws.on("close", () => {
        this.clients.delete(ws);
      });
      ws.on("error", () => {
        this.clients.delete(ws);
      });
    });
  }

  broadcast(obj: any) {
    const msg = JSON.stringify(obj);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  broadcastTwin(asset: AssetRecord, ledger: LedgerBlock[], fraudBlocked: number) {
    const count = ledger.filter((r) => r.asset_id === asset.id).length;
    this.broadcast({
      kind: "twin_update",
      asset_id: asset.id,
      asset,
      meta: {
        fraud_blocked: fraudBlocked,
        ledger_count: count,
      },
    });
  }

  broadcastLedger(ledger: LedgerBlock[], assetId?: string) {
    this.broadcast({
      kind: "ledger_update",
      asset_id: assetId,
      records: assetId ? ledger.filter((r) => r.asset_id === assetId) : ledger,
    });
  }

  broadcastPortfolio() {
    const assets = assetRegistry.getAllAssets().map((a) => ({
      id: a.id,
      name: a.name,
      order_value: a.order_value,
      stage: a.stage,
      risk_index: a.risk_index,
      safe_limit: a.financial.safe_limit,
    }));
    this.broadcast({
      kind: "portfolio_update",
      assets,
    });
  }
}

export const wsManager = new WebSocketManager();
