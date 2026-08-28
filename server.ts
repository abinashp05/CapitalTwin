import express, { Request, Response } from "express";
import http from "http";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import {
  initDb,
  getDatabase,
  assetRepo,
  riskRepo,
  financingRepo,
  auctionRepo,
  ledgerRepo,
  eventRepo,
  metricsRepo,
  userRepo,
  sessionRepo,
  auditRepo,
} from "./src/db";
import {
  assetRegistry,
  createFreshAsset,
  computeRisk,
  effectiveLtv,
  recomputeFinance,
  INSTRUMENT,
} from "./src/state/assetRuntime";
import { AssetRecord } from "./src/db/repositories/assetRepository";
import {
  LedgerBlock,
  createLedgerBlock,
  verifyLedgerChain,
  checkLedgerCompliance,
} from "./src/engines/ledgerEngine";
import { runAuction } from "./src/engines/auctionEngine";
import { runAgentEvents } from "./src/engines/agentEventEngine";
import { wsManager } from "./src/websocket/wsManager";
import { simulateShadowScenario, validateScenario } from "./src/engines/shadowEngine";
import {
  hashPassword,
  verifyPassword,
  validateUsername,
  validatePassword,
  generateSessionToken,
  hashSessionToken,
} from "./src/auth/passwordUtils";
import {
  requireAuth,
  requireRole,
  requireAssetOwnership,
  extractToken,
} from "./src/auth/authMiddleware";

dotenv.config();

// Initialize SQLite database and repositories
initDb();

const app = express();
const server = http.createServer(app);
const PORT = 3000;

app.use(express.json());

let LEDGER: LedgerBlock[] = [];
let COUNTERS = { fraud_blocked: 0 };

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "127.0.0.1";
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  const isSecure = req.secure || req.headers["x-forwarded-proto"] === "https";
  const secureFlag = isSecure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `capitaltwin_session=${token}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax${secureFlag}`
  );
}

function clearSessionCookie(res: Response): void {
  res.setHeader(
    "Set-Cookie",
    "capitaltwin_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax"
  );
}

function recordRiskSnapshot(a: AssetRecord): void {
  const risk = computeRisk(a);
  const eff = effectiveLtv(a);
  const orderValue = a.order_value || 5000000;
  const capacity = Math.floor(orderValue * eff);
  const safeLimit = a.financial?.safe_limit || 0;

  riskRepo.addSnapshot({
    asset_id: a.id || "ORD-123",
    risk_index: risk,
    buyer_risk: a.contractual?.buyer_risk ?? 0.15,
    delay_days: a.physical?.delay_days ?? 0,
    condition: a.physical?.condition ?? "OK",
    stage: a.stage || "NEW",
    effective_ltv: eff,
    safe_limit: safeLimit,
    capacity: capacity,
  });
}

async function pushMsg(assetId: string, agent: string, reason: string) {
  const d = new Date();
  const ts = d.toTimeString().split(" ")[0];
  const entry = { agent, reason, ts };
  const asset = assetRegistry.getAsset(assetId);
  if (asset) {
    asset.history.push(entry);
    if (asset.history.length > 40) {
      asset.history = asset.history.slice(-40);
    }
  }
  eventRepo.addEvent(assetId, agent, reason, ts);
  wsManager.broadcast({
    kind: "agent_message",
    asset_id: assetId,
    agent,
    reason,
    ts,
  });
}

// Health Check
app.get("/api/health", (req: Request, res: Response) => {
  res.json({ status: "ok", service: "CapitalTwin" });
});

// --------------------------------------------------
// AUTHENTICATION & USER MANAGEMENT API
// --------------------------------------------------

// POST /auth/login (and /login alias)
const handleLoginRoute = (req: Request, res: Response) => {
  const { username = "", password = "" } = req.body || {};
  const ip = getClientIp(req);

  if (!username || typeof username !== "string" || !password || typeof password !== "string") {
    auditRepo.logAuthEvent(null, "LOGIN_FAILURE", ip, "MISSING_FIELDS");
    return res.status(400).json({ ok: false, error: "Username and password are required." });
  }

  const user = userRepo.getUserByUsername(username);
  if (!user) {
    auditRepo.logAuthEvent(null, "LOGIN_FAILURE", ip, `USER_NOT_FOUND: ${username.slice(0, 15)}`);
    return res.status(401).json({ ok: false, error: "Invalid username or password." });
  }

  if (!user.is_active) {
    auditRepo.logAuthEvent(user.id, "LOGIN_FAILURE", ip, "ACCOUNT_INACTIVE");
    return res.status(403).json({
      ok: false,
      error: "Account has been deactivated. Please contact an administrator.",
    });
  }

  const passwordValid = verifyPassword(password, user.password_hash, user.salt);
  if (!passwordValid) {
    auditRepo.logAuthEvent(user.id, "LOGIN_FAILURE", ip, "INVALID_CREDENTIALS");
    return res.status(401).json({ ok: false, error: "Invalid username or password." });
  }

  // Generate session token and store hash in SQLite
  const rawToken = generateSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  sessionRepo.createSession(user.id, tokenHash, expiresAt);
  setSessionCookie(req, res, rawToken);
  auditRepo.logAuthEvent(user.id, "LOGIN_SUCCESS", ip, "SUCCESS");

  const safeUser = userRepo.toSafeUser(user);
  res.json({
    ok: true,
    user: safeUser,
    token: rawToken, // Provided for headless / API testing compatibility
  });
};

app.post("/auth/login", handleLoginRoute);
app.post("/login", handleLoginRoute);

// POST /auth/logout
app.post("/auth/logout", (req: Request, res: Response) => {
  const token = extractToken(req);
  const ip = getClientIp(req);

  if (token) {
    const tokenHash = hashSessionToken(token);
    const sessionData = sessionRepo.getSessionWithUser(tokenHash);
    if (sessionData) {
      sessionRepo.deleteSession(tokenHash);
      auditRepo.logAuthEvent(sessionData.user.id, "LOGOUT", ip, "SUCCESS");
    }
  }

  clearSessionCookie(res);
  res.json({ ok: true, message: "Logged out successfully." });
});

// GET /auth/me
app.get("/auth/me", requireAuth, (req: Request, res: Response) => {
  res.json({
    ok: true,
    user: req.user,
  });
});

// ADMIN USER MANAGEMENT
// GET /admin/users and /auth/admin/users
app.get(["/admin/users", "/auth/admin/users"], requireAuth, requireRole("admin"), (req: Request, res: Response) => {
  const users = userRepo.getAllUsers();
  res.json({ ok: true, users });
});

// POST /admin/users and /auth/admin/users
app.post(["/admin/users", "/auth/admin/users", "/auth/admin/create-user"], requireAuth, requireRole("admin"), (req: Request, res: Response) => {
  const { username, password, role, name, org } = req.body || {};
  const ip = getClientIp(req);

  const usernameCheck = validateUsername(username);
  if (!usernameCheck.valid) {
    return res.status(400).json({ ok: false, error: usernameCheck.error });
  }

  const existing = userRepo.getUserByUsername(username);
  if (existing) {
    return res.status(409).json({ ok: false, error: `Username '${username}' is already taken.` });
  }

  const passwordCheck = validatePassword(password);
  if (!passwordCheck.valid) {
    return res.status(400).json({ ok: false, error: passwordCheck.error });
  }

  const validRoles = ["supplier", "lender", "admin"];
  if (!role || !validRoles.includes(role)) {
    return res.status(400).json({
      ok: false,
      error: `Invalid role. Must be one of: [${validRoles.join(", ")}]`,
    });
  }

  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ ok: false, error: "Full name is required." });
  }

  if (!org || typeof org !== "string" || !org.trim()) {
    return res.status(400).json({ ok: false, error: "Organization name is required." });
  }

  const { hash, salt } = hashPassword(password);
  const newUser = userRepo.createUser({
    username,
    password_hash: hash,
    salt,
    role,
    name,
    org,
  });

  auditRepo.logAuthEvent(req.user!.id, "USER_CREATED", ip, `CREATED_${role.toUpperCase()}_${newUser.username}`);
  res.status(201).json({ ok: true, user: newUser });
});

// POST /admin/users/:id/deactivate
app.post(["/admin/users/:id/deactivate", "/auth/admin/users/:id/deactivate"], requireAuth, requireRole("admin"), (req: Request, res: Response) => {
  const userId = req.params.id;
  const ip = getClientIp(req);

  const target = userRepo.getUserById(userId);
  if (!target) {
    return res.status(404).json({ ok: false, error: `User '${userId}' not found.` });
  }

  // Prevent deactivating the last active administrator
  if (target.role === "admin") {
    const activeAdmins = userRepo.countActiveAdmins();
    if (activeAdmins <= 1 && target.is_active) {
      return res.status(400).json({
        ok: false,
        error: "Cannot deactivate the last remaining active administrator.",
      });
    }
  }

  const updated = userRepo.setUserActive(userId, false);
  if (updated) {
    auditRepo.logAuthEvent(req.user!.id, "USER_DEACTIVATED", ip, `DEACTIVATED_${target.username}`);
    return res.json({ ok: true, message: `User '${target.username}' has been deactivated.` });
  }

  res.status(500).json({ ok: false, error: "Failed to deactivate user." });
});

// POST /admin/users/:id/change-password
app.post(["/admin/users/:id/change-password", "/auth/admin/users/:id/change-password"], requireAuth, requireRole("admin"), (req: Request, res: Response) => {
  const userId = req.params.id;
  const { password } = req.body || {};
  const ip = getClientIp(req);

  const target = userRepo.getUserById(userId);
  if (!target) {
    return res.status(404).json({ ok: false, error: `User '${userId}' not found.` });
  }

  const passwordCheck = validatePassword(password);
  if (!passwordCheck.valid) {
    return res.status(400).json({ ok: false, error: passwordCheck.error });
  }

  const { hash, salt } = hashPassword(password);
  const updated = userRepo.updatePassword(userId, hash, salt);
  if (updated) {
    auditRepo.logAuthEvent(req.user!.id, "PASSWORD_CHANGED", ip, `PW_RESET_${target.username}`);
    return res.json({ ok: true, message: `Password updated for '${target.username}'.` });
  }

  res.status(500).json({ ok: false, error: "Failed to update password." });
});

// GET /admin/audit-logs and /auth/admin/audit-logs
app.get(["/admin/audit-logs", "/auth/admin/audit-logs"], requireAuth, requireRole("admin"), (req: Request, res: Response) => {
  const logs = auditRepo.getRecentLogs(100);
  res.json({ ok: true, logs });
});

// --------------------------------------------------
// DIGITAL TWIN & FINANCING REST API (PROTECTED)
// --------------------------------------------------

// GET /assets - Authenticated
app.get("/assets", requireAuth, (req: Request, res: Response) => {
  const user = req.user!;
  const all = assetRegistry
    .getAllAssets()
    .filter((a) => {
      if (user.role === "supplier") {
        const userOrg = (user.org || "").trim().toLowerCase();
        const assetOwner = (a.contractual?.owner || "").trim().toLowerCase();
        return !userOrg || !assetOwner || userOrg === assetOwner;
      }
      return true;
    })
    .map((a) => {
      recomputeFinance(a);
      return {
        id: a.id,
        name: a.name,
        order_value: a.order_value,
        stage: a.stage,
        risk_index: a.risk_index,
        safe_limit: a.financial.safe_limit,
        owner: a.contractual?.owner,
      };
    });
  res.json(all);
});

// POST /asset/create - Supplier or Admin
app.post("/asset/create", requireAuth, requireRole("supplier", "admin"), (req: Request, res: Response) => {
  const { id, name, order_value, buyer, terms, owner } = req.body || {};
  const user = req.user!;

  if (!id || typeof id !== "string" || !id.trim()) {
    return res.status(400).json({ error: "Valid asset ID is required" });
  }
  const cleanId = id.trim();

  if (assetRegistry.hasAsset(cleanId) || assetRepo.getAsset(cleanId)) {
    return res.status(409).json({ error: `Asset with ID '${cleanId}' already exists` });
  }

  const numericOrderValue = Number(order_value);
  if (isNaN(numericOrderValue) || numericOrderValue <= 0) {
    return res.status(400).json({ error: "Order value must be a positive number" });
  }

  // Suppliers can only create assets for their own organization
  const assetOwner = user.role === "supplier" ? user.org : (owner || user.org || "Ravi Textiles");

  const fresh = createFreshAsset({
    id: cleanId,
    name: name || cleanId,
    order_value: numericOrderValue,
    contractual: {
      buyer: buyer || "BigRetail",
      terms: terms || "net-60",
      owner: assetOwner,
      buyer_risk: 0.15,
      expected_cash_date: "—",
    },
  });

  recomputeFinance(fresh);

  try {
    const dbConn = getDatabase();
    const createTx = dbConn.transaction(() => {
      assetRepo.saveAsset(fresh);
      recordRiskSnapshot(fresh);
    });
    createTx();
    assetRegistry.setAsset(cleanId, fresh);
    wsManager.broadcastPortfolio();
    return res.status(201).json(fresh);
  } catch (err: any) {
    console.error("Asset creation error:", err);
    return res.status(500).json({ error: "Failed to create asset: " + (err.message || String(err)) });
  }
});

// GET /asset/:id - Authenticated + Ownership check
app.get("/asset/:id", requireAuth, requireAssetOwnership, (req: Request, res: Response) => {
  const assetId = req.params.id;
  let asset = assetRegistry.getAsset(assetId);

  if (!asset) {
    const dbAsset = assetRepo.getAsset(assetId);
    if (!dbAsset) {
      return res.status(404).json({ error: `Asset '${assetId}' not found` });
    }
    dbAsset.history = eventRepo.getRecentEvents(assetId, 40);
    assetRegistry.setAsset(assetId, dbAsset);
    asset = dbAsset;
  }

  recomputeFinance(asset);
  const assetLedgerCount = LEDGER.filter((r) => r.asset_id === asset.id).length;

  res.json({
    asset,
    meta: {
      fraud_blocked: COUNTERS.fraud_blocked,
      ledger_count: assetLedgerCount,
    },
  });
});

// POST /shadow/simulate - Supplier (own asset), Lender, or Admin
app.post(
  "/shadow/simulate",
  requireAuth,
  requireRole("supplier", "lender", "admin"),
  requireAssetOwnership,
  (req: Request, res: Response) => {
    const { asset_id = "ORD-123", scenario } = req.body || {};

  if (!asset_id || typeof asset_id !== "string" || !asset_id.trim()) {
    return res.status(400).json({ error: "Valid asset_id is required" });
  }

  const cleanAssetId = asset_id.trim();
  let asset = assetRegistry.getAsset(cleanAssetId);

  if (!asset) {
    const dbAsset = assetRepo.getAsset(cleanAssetId);
    if (!dbAsset) {
      return res.status(404).json({ error: `Asset '${cleanAssetId}' not found` });
    }
    dbAsset.history = eventRepo.getRecentEvents(cleanAssetId, 40);
    assetRegistry.setAsset(cleanAssetId, dbAsset);
    asset = dbAsset;
  }

  const validation = validateScenario(scenario);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error || "Invalid scenario parameters" });
  }

  try {
    const simulationResult = simulateShadowScenario(asset, scenario);
    return res.json({
      ok: true,
      simulation: simulationResult,
    });
  } catch (err: any) {
    console.error("Shadow simulation error:", err);
    return res.status(500).json({ error: "Failed to simulate shadow scenario: " + (err.message || String(err)) });
  }
});

// GET /ledger/:id - Lender or Admin
app.get("/ledger/:id", requireAuth, requireRole("lender", "admin"), (req: Request, res: Response) => {
  const assetId = req.params.id;
  if (assetId === "all") {
    return res.json({
      records: LEDGER,
      chain_ok: verifyLedgerChain(LEDGER),
    });
  }

  const filtered = LEDGER.filter((r) => r.asset_id === assetId);
  res.json({
    records: filtered,
    chain_ok: verifyLedgerChain(LEDGER),
  });
});

// POST /event - Admin ONLY
app.post("/event", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
  const { asset_id = "ORD-123", type: etype } = req.body || {};
  let asset = assetRegistry.getAsset(asset_id);

  if (!asset) {
    const dbAsset = assetRepo.getAsset(asset_id);
    if (!dbAsset) {
      return res.status(404).json({ error: `Asset '${asset_id}' not found` });
    }
    dbAsset.history = eventRepo.getRecentEvents(asset_id, 40);
    assetRegistry.setAsset(asset_id, dbAsset);
    asset = dbAsset;
  }

  const order_val = asset.order_value || 5000000;

  if (etype === "DOUBLE_FINANCE_ATTEMPT") {
    const chk = checkLedgerCompliance(asset, order_val * 0.6, "ShadyLend Corp", LEDGER);
    COUNTERS.fraud_blocked = metricsRepo.incrementMetric("fraud_blocked", 1);
    const verifyStr = verifyLedgerChain(LEDGER) ? " Ledger chain verified: intact ✓" : " TAMPERED";
    const fullMsg = chk.reason + verifyStr;
    await pushMsg(asset.id, "Fraud", fullMsg);
    wsManager.broadcastTwin(asset, LEDGER, COUNTERS.fraud_blocked);
    return res.json({ blocked: true, reason: fullMsg });
  }

  if (etype === "BUYER_PAID") {
    asset.stage = "SETTLED";
    const drawn = asset.financial?.drawn || 0;
    const lenderName = asset.financial?.lender || "—";
    if (drawn > 0) {
      const rec = createLedgerBlock(LEDGER, asset.id, "settlement", lenderName, -drawn, "loan repaid from buyer payment");
      LEDGER.push(rec);
      ledgerRepo.addRecord(rec);
      wsManager.broadcastLedger(LEDGER, asset.id);
    }
    asset.financial.drawn = 0;
    asset.financial.rate = 0.0;
    asset.financial.instrument = "settled";
    asset.financial.lender = "—";
    recomputeFinance(asset);

    assetRepo.saveAsset(asset);
    recordRiskSnapshot(asset);

    await pushMsg(
      asset.id,
      "Transition",
      `Buyer paid ₹${order_val.toLocaleString("en-IN")} — loan of ₹${drawn.toLocaleString("en-IN")} settled itself; lifecycle complete.`
    );
    wsManager.broadcastTwin(asset, LEDGER, COUNTERS.fraud_blocked);
    wsManager.broadcastPortfolio();
    return res.json({ ok: true, stage: "SETTLED" });
  }

  if (etype === "ORDER_CONFIRMED") {
    asset.stage = "PO_ISSUED";
    asset.physical.location = "Ravi's factory";
    const expDate = new Date();
    expDate.setDate(expDate.getDate() + 135);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    asset.contractual.expected_cash_date = `${expDate.getDate()} ${months[expDate.getMonth()]}`;
    recomputeFinance(asset);
    assetRepo.saveAsset(asset);
    recordRiskSnapshot(asset);
    await runAgentEvents(asset, etype, pushMsg);
    wsManager.broadcastTwin(asset, LEDGER, COUNTERS.fraud_blocked);
    wsManager.broadcastPortfolio();
    return res.json({ ok: true, stage: asset.stage });
  }

  if (etype === "RAW_PROCURED") {
    asset.stage = "RAW_PROCURED";
    asset.physical.location = "Ravi's factory";
    recomputeFinance(asset);
    assetRepo.saveAsset(asset);
    recordRiskSnapshot(asset);
    await runAgentEvents(asset, etype, pushMsg);
    wsManager.broadcastTwin(asset, LEDGER, COUNTERS.fraud_blocked);
    wsManager.broadcastPortfolio();
    return res.json({ ok: true, stage: asset.stage });
  }

  if (etype === "PRODUCED") {
    asset.stage = "FINISHED_GOODS";
    asset.physical.location = "Factory store";
    recomputeFinance(asset);
    assetRepo.saveAsset(asset);
    recordRiskSnapshot(asset);
    await runAgentEvents(asset, etype, pushMsg);
    wsManager.broadcastTwin(asset, LEDGER, COUNTERS.fraud_blocked);
    wsManager.broadcastPortfolio();
    return res.json({ ok: true, stage: asset.stage });
  }

  if (etype === "SHIPPED") {
    asset.stage = "IN_TRANSIT";
    asset.physical.location = "NH-48, in transit";
    recomputeFinance(asset);
    assetRepo.saveAsset(asset);
    recordRiskSnapshot(asset);
    await runAgentEvents(asset, etype, pushMsg);
    wsManager.broadcastTwin(asset, LEDGER, COUNTERS.fraud_blocked);
    wsManager.broadcastPortfolio();
    return res.json({ ok: true, stage: asset.stage });
  }

  if (etype === "DELAYED") {
    asset.physical.delay_days = (asset.physical?.delay_days || 0) + 3;
    recomputeFinance(asset);
    assetRepo.saveAsset(asset);
    recordRiskSnapshot(asset);
    await runAgentEvents(asset, etype, pushMsg);
    wsManager.broadcastTwin(asset, LEDGER, COUNTERS.fraud_blocked);
    wsManager.broadcastPortfolio();
    return res.json({ ok: true, delay_days: asset.physical.delay_days });
  }

  if (etype === "TEMP_SPIKE") {
    asset.physical.condition = "DEGRADED (heat)";
    recomputeFinance(asset);
    assetRepo.saveAsset(asset);
    recordRiskSnapshot(asset);
    await runAgentEvents(asset, etype, pushMsg);
    wsManager.broadcastTwin(asset, LEDGER, COUNTERS.fraud_blocked);
    wsManager.broadcastPortfolio();
    return res.json({ ok: true, condition: asset.physical.condition });
  }

  if (etype === "WAREHOUSED") {
    asset.stage = "WAREHOUSED";
    asset.physical.location = "Chennai WH-7";
    recomputeFinance(asset);
    assetRepo.saveAsset(asset);
    recordRiskSnapshot(asset);
    await runAgentEvents(asset, etype, pushMsg);
    wsManager.broadcastTwin(asset, LEDGER, COUNTERS.fraud_blocked);
    wsManager.broadcastPortfolio();
    return res.json({ ok: true, stage: asset.stage });
  }

  if (etype === "DELIVERED") {
    asset.stage = "DELIVERED";
    asset.physical.location = `${asset.contractual.buyer} DC`;
    asset.physical.delay_days = 0;
    recomputeFinance(asset);
    assetRepo.saveAsset(asset);
    recordRiskSnapshot(asset);
    await runAgentEvents(asset, etype, pushMsg);
    wsManager.broadcastTwin(asset, LEDGER, COUNTERS.fraud_blocked);
    wsManager.broadcastPortfolio();
    return res.json({ ok: true, stage: asset.stage });
  }

  if (etype === "INVOICED") {
    asset.stage = "INVOICED";
    recomputeFinance(asset);
    assetRepo.saveAsset(asset);
    recordRiskSnapshot(asset);
    await runAgentEvents(asset, etype, pushMsg);
    wsManager.broadcastTwin(asset, LEDGER, COUNTERS.fraud_blocked);
    wsManager.broadcastPortfolio();
    return res.json({ ok: true, stage: asset.stage });
  }

  if (etype === "RECEIVABLE_DELAYED") {
    const bRisk = asset.contractual?.buyer_risk || 0.15;
    asset.contractual.buyer_risk = Math.round(Math.min(1.0, bRisk + 0.35) * 100) / 100;
    recomputeFinance(asset);
    assetRepo.saveAsset(asset);
    recordRiskSnapshot(asset);
    await runAgentEvents(asset, etype, pushMsg);
    wsManager.broadcastTwin(asset, LEDGER, COUNTERS.fraud_blocked);
    wsManager.broadcastPortfolio();
    return res.json({ ok: true, buyer_risk: asset.contractual.buyer_risk });
  }

  return res.status(400).json({ error: `Unknown event type: ${etype}` });
});

// POST /financing/request - Supplier or Admin with Asset Ownership
app.post(
  "/financing/request",
  requireAuth,
  requireRole("supplier", "admin"),
  requireAssetOwnership,
  async (req: Request, res: Response) => {
    const { asset_id = "ORD-123", amount } = req.body || {};
    let asset = assetRegistry.getAsset(asset_id);
    if (!asset) {
      const dbAsset = assetRepo.getAsset(asset_id);
      if (!dbAsset) {
        return res.status(404).json({ error: `Asset '${asset_id}' not found` });
      }
      dbAsset.history = eventRepo.getRecentEvents(asset_id, 40);
      assetRegistry.setAsset(asset_id, dbAsset);
      asset = dbAsset;
    }

    const { headroom } = recomputeFinance(asset);

    if (headroom <= 0) {
      const chk = checkLedgerCompliance(asset, amount || 1, asset.contractual?.owner || "Ravi Textiles", LEDGER);
      COUNTERS.fraud_blocked = metricsRepo.incrementMetric("fraud_blocked", 1);
      await pushMsg(asset.id, "Fraud", chk.reason);
      wsManager.broadcastTwin(asset, LEDGER, COUNTERS.fraud_blocked);
      return res.status(409).json({ blocked: true, reason: chk.reason });
    }

    const requestedAmount = amount !== undefined && Number(amount) > 0 ? Number(amount) : headroom;
    const finalAmount = Math.min(requestedAmount, headroom);

    if (finalAmount < requestedAmount) {
      const eff = effectiveLtv(asset);
      const ltvPct = Math.round(eff * 100);
      await pushMsg(
        asset.id,
        "Loan",
        `Requested ₹${requestedAmount.toLocaleString("en-IN")} exceeds the safe limit — capped to ₹${finalAmount.toLocaleString("en-IN")} (LTV ${ltvPct}%).`
      );
    }

    const sessionId = `auc_${asset.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const auction = assetRegistry.getAuction(asset.id);
    auction.currentSessionId = sessionId;

    const finRecordId = financingRepo.createRecord({
      asset_id: asset.id,
      amount: finalAmount,
      requested_amount: requestedAmount,
      status: "AUCTION_RUNNING",
    });
    auction.currentFinancingRecordId = finRecordId;

    auctionRepo.createSession({
      id: sessionId,
      asset_id: asset.id,
      amount: finalAmount,
      status: "RUNNING",
    });

    await pushMsg(asset.id, "Fraud", "Ledger check clear — no duplicate claims; ownership verified. Opening the bank battle.");
    runAuction(asset.id, finalAmount, pushMsg);
    res.json({ auction: "started", asset_id: asset.id, amount: finalAmount });
  }
);

// POST /financing/accept - Supplier or Admin with Asset Ownership
app.post(
  "/financing/accept",
  requireAuth,
  requireRole("supplier", "admin"),
  requireAssetOwnership,
  async (req: Request, res: Response) => {
    const { asset_id = "ORD-123" } = req.body || {};
    let asset = assetRegistry.getAsset(asset_id);
    if (!asset) {
      const dbAsset = assetRepo.getAsset(asset_id);
      if (!dbAsset) {
        return res.status(404).json({ error: `Asset '${asset_id}' not found` });
      }
      dbAsset.history = eventRepo.getRecentEvents(asset_id, 40);
      assetRegistry.setAsset(asset_id, dbAsset);
      asset = dbAsset;
    }

    const auction = assetRegistry.getAuction(asset.id);
    const best = auction.best;
    if (!best) {
      return res.status(400).json({ error: `No active or concluded auction to accept for asset '${asset.id}'.` });
    }

    const { headroom } = recomputeFinance(asset);
    const amt = Math.min(auction.amount || headroom, headroom) || auction.amount;
    const stage = asset.stage || "PO_ISSUED";
    const instrument = INSTRUMENT[stage] || "trade financing";

    const ledgerRecord = createLedgerBlock(LEDGER, asset.id, "financing", best.lender, amt, instrument);

    const assetBackup = JSON.parse(JSON.stringify(asset));
    const ledgerBackup = [...LEDGER];
    const auctionBackup = JSON.parse(JSON.stringify(auction));

    try {
      const dbConn = getDatabase();
      const acceptTransaction = dbConn.transaction(() => {
        // 1. Update asset
        asset.financial.drawn = (asset.financial.drawn || 0) + amt;
        asset.financial.lender = best.lender;
        asset.financial.rate = best.rate;
        asset.financial.instrument = instrument;
        recomputeFinance(asset);

        assetRepo.saveAsset(asset);

        // 2. Update financing record to ACCEPTED
        if (auction.currentFinancingRecordId) {
          financingRepo.updateStatus(auction.currentFinancingRecordId, "ACCEPTED", {
            lender: best.lender,
            rate: best.rate,
            instrument,
            amount: amt,
          });
        } else {
          const latest = financingRepo.getLatestByAsset(asset.id);
          if (latest && latest.id) {
            financingRepo.updateStatus(latest.id, "ACCEPTED", {
              lender: best.lender,
              rate: best.rate,
              instrument,
              amount: amt,
            });
          }
        }

        // 3. Update auction session to ACCEPTED
        if (auction.currentSessionId) {
          auctionRepo.updateSession(auction.currentSessionId, "ACCEPTED", best.lender, best.rate);
        } else {
          const latestSession = auctionRepo.getLatestSession(asset.id);
          if (latestSession) {
            auctionRepo.updateSession(latestSession.id, "ACCEPTED", best.lender, best.rate);
          }
        }

        // 4. Append & persist ledger record
        LEDGER.push(ledgerRecord);
        ledgerRepo.addRecord(ledgerRecord);

        // 5. Record risk snapshot
        recordRiskSnapshot(asset);
      });

      acceptTransaction();
    } catch (err: any) {
      Object.assign(asset, assetBackup);
      LEDGER = ledgerBackup;
      Object.assign(auction, auctionBackup);
      console.error("Financing accept transaction failed:", err);
      return res.status(500).json({ error: "Failed to accept financing: " + (err.message || String(err)) });
    }

    await pushMsg(
      asset.id,
      "Loan",
      `₹${amt.toLocaleString("en-IN")} disbursed by ${best.lender} at ${best.rate.toFixed(2)}% — recorded on the exposure ledger.`
    );
    wsManager.broadcastLedger(LEDGER, asset.id);
    wsManager.broadcastTwin(asset, LEDGER, COUNTERS.fraud_blocked);
    wsManager.broadcastPortfolio();

    auction.best = null;
    res.json({ ok: true, asset_id: asset.id, amount: amt, lender: best.lender, rate: best.rate });
  }
);

// POST /ask - Authenticated
app.post("/ask", requireAuth, async (req: Request, res: Response) => {
  const { q = "", question = "", asset_id = "ORD-123" } = req.body || {};
  const queryText = q || question;

  let asset = assetRegistry.getAsset(asset_id);
  if (!asset) {
    const dbAsset = assetRepo.getAsset(asset_id);
    if (dbAsset) {
      dbAsset.history = eventRepo.getRecentEvents(asset_id, 40);
      assetRegistry.setAsset(asset_id, dbAsset);
      asset = dbAsset;
    } else {
      asset = assetRegistry.getDefaultAsset();
    }
  }

  recomputeFinance(asset);

  const stage = asset.stage || "NEW";
  const loc = asset.physical?.location || "Ravi's factory";
  const risk = (asset.risk_index || 0.08).toFixed(2);
  const safe = (asset.financial?.safe_limit || 0).toLocaleString("en-IN");
  const drawn = (asset.financial?.drawn || 0).toLocaleString("en-IN");
  const inst = asset.financial?.instrument || "—";
  const expCash = asset.contractual?.expected_cash_date || "—";

  const fallback = `Asset ${asset.id} (${asset.name}) is at ${stage} stage located at ${loc} with risk index ${risk}. Safe financing limit is ₹${safe} with ₹${drawn} drawn under ${inst}. Expected cash date is ${expCash}.`;

  let answer = fallback;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({
        apiKey: geminiKey,
        httpOptions: { headers: { "User-Agent": "aistudio-build" } },
      });
      const response = await ai.models.generateContent({
        model: "gemini-3.7-flash",
        contents: `You are CapitalTwin's AI Assistant for supply chain financing. Digital twin state for asset ${asset.id}: ${JSON.stringify(asset)}. Question: ${queryText}. Give a concise, professional, clear 1-2 sentence response. Direct facts only.`,
      });
      if (response && response.text) {
        answer = response.text.trim();
      }
    } catch {
      answer = fallback;
    }
  }

  await pushMsg(asset.id, "Assistant", answer);
  res.json({ answer, asset_id: asset.id });
});

app.get("/speak", (req: Request, res: Response) => {
  res.status(503).send("Fallback to client speechSynthesis");
});

// POST /reset - Admin ONLY
app.post("/reset", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
  const { asset_id = "ORD-123" } = req.body || {};
  let targetAsset = assetRegistry.getAsset(asset_id);
  if (!targetAsset) {
    targetAsset = assetRepo.getAsset(asset_id) || createFreshAsset({ id: asset_id });
  }

  const assetId = targetAsset.id;
  try {
    const dbConn = getDatabase();
    const resetTransaction = dbConn.transaction(() => {
      eventRepo.clearByAsset(assetId);
      riskRepo.clearHistory(assetId);
      financingRepo.clearByAsset(assetId);
      auctionRepo.clearByAsset(assetId);
      ledgerRepo.clearByAsset(assetId);

      const fresh = createFreshAsset({ id: assetId, name: targetAsset?.name, order_value: targetAsset?.order_value });
      assetRepo.saveAsset(fresh);
      recordRiskSnapshot(fresh);

      if (assetId === "ORD-123") {
        metricsRepo.resetMetric("fraud_blocked");
      }
    });
    resetTransaction();
  } catch (err) {
    console.error("Reset transaction error:", err);
  }

  const fresh = createFreshAsset({ id: assetId, name: targetAsset?.name, order_value: targetAsset?.order_value });
  assetRegistry.setAsset(assetId, fresh);
  assetRegistry.clearAuction(assetId);

  LEDGER = LEDGER.filter((r) => r.asset_id !== assetId);
  if (assetId === "ORD-123") {
    COUNTERS.fraud_blocked = 0;
  }

  wsManager.broadcastLedger(LEDGER, assetId);
  wsManager.broadcastTwin(fresh, LEDGER, COUNTERS.fraud_blocked);
  wsManager.broadcastPortfolio();
  await pushMsg(assetId, "Tracker", `Demo reset for ${assetId} — fresh asset ready.`);
  res.json({ ok: true, asset_id: assetId });
});

// Setup WebSocket Manager
wsManager.init(server, () => LEDGER, () => COUNTERS);

// Startup and Hydration
async function start() {
  try {
    const allPersistedAssets = assetRepo.getAllAssets();
    if (allPersistedAssets.length === 0) {
      const defaultAsset = createFreshAsset({ id: "ORD-123" });
      recomputeFinance(defaultAsset);
      assetRepo.saveAsset(defaultAsset);
      recordRiskSnapshot(defaultAsset);
      metricsRepo.setMetric("fraud_blocked", 0);
      assetRegistry.setAsset("ORD-123", defaultAsset);
    } else {
      for (const persAsset of allPersistedAssets) {
        persAsset.history = eventRepo.getRecentEvents(persAsset.id, 40);
        recomputeFinance(persAsset);
        assetRegistry.setAsset(persAsset.id, persAsset);
      }
    }

    LEDGER = ledgerRepo.getAll();
    const chainOk = verifyLedgerChain(LEDGER);
    if (!chainOk) {
      console.warn("⚠️ Warning: Hydrated ledger failed hash integrity check!");
    }
    COUNTERS.fraud_blocked = metricsRepo.getMetric("fraud_blocked", 0);
  } catch (hydrationErr) {
    console.error("Database hydration error:", hydrationErr);
  }

  app.use("/vendor", express.static(path.join(process.cwd(), "static", "vendor")));
  app.use("/vendor", express.static(path.join(process.cwd(), "public", "vendor")));
  app.use("/static", express.static(path.join(process.cwd(), "static")));

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`CapitalTwin Multi-Asset Server running on http://0.0.0.0:${PORT}`);
  });
}

start();

