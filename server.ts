import express, { Request, Response } from "express";
import http from "http";
import path from "path";
import crypto from "crypto";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// Contract constants
const STAGES = [
  "PO_ISSUED",
  "RAW_PROCURED",
  "IN_PRODUCTION",
  "FINISHED_GOODS",
  "IN_TRANSIT",
  "WAREHOUSED",
  "DELIVERED",
  "INVOICED",
  "SETTLED",
];

const BASE_LTV: Record<string, number> = {
  PO_ISSUED: 0.5,
  RAW_PROCURED: 0.55,
  IN_PRODUCTION: 0.6,
  FINISHED_GOODS: 0.65,
  IN_TRANSIT: 0.75,
  WAREHOUSED: 0.8,
  DELIVERED: 0.85,
  INVOICED: 0.9,
  SETTLED: 0.0,
};

const INSTRUMENT: Record<string, string> = {
  PO_ISSUED: "PO financing",
  RAW_PROCURED: "procurement financing",
  IN_PRODUCTION: "procurement financing",
  FINISHED_GOODS: "inventory financing",
  IN_TRANSIT: "in-transit financing",
  WAREHOUSED: "warehouse financing",
  DELIVERED: "trade financing",
  INVOICED: "invoice financing",
  SETTLED: "settled",
};

const USERS: Record<string, { pw: string; role: string; name: string; org: string }> = {
  ravi: { pw: "demo123", role: "supplier", name: "Ravi Kumar", org: "Ravi Textiles" },
  ravi123: { pw: "RaviSecure!2026", role: "supplier", name: "Ravi Kumar", org: "Ravi Textiles" },
  lender: { pw: "demo123", role: "lender", name: "Alex Mercer", org: "NBFC Capital" },
  lender01: { pw: "LenderAlpha#2026", role: "lender", name: "Alex Mercer", org: "NBFC Capital" },
  admin: { pw: "demo123", role: "admin", name: "Demo Director", org: "CapitalTwin" },
  admin2026: { pw: "AdminMaster$2026", role: "admin", name: "Demo Director", org: "CapitalTwin" },
};

function nowTs(): string {
  const d = new Date();
  return d.toTimeString().split(" ")[0];
}

function freshAsset() {
  return {
    id: "ORD-123",
    name: "10,000 t-shirts",
    order_value: 5000000,
    stage: "NEW",
    physical: {
      location: "Ravi's factory",
      condition: "OK",
      delay_days: 0,
    },
    financial: {
      drawn: 0,
      instrument: "—",
      safe_limit: 0,
      lender: "—",
      rate: 0.0,
      frozen: false,
    },
    contractual: {
      buyer: "BigRetail",
      terms: "net-60",
      owner: "Ravi Textiles",
      buyer_risk: 0.15,
      expected_cash_date: "—",
    },
    risk_index: 0.08,
    history: [] as Array<{ agent: string; reason: string; ts: string }>,
  };
}

let ASSET = freshAsset();
let LEDGER: Array<{
  asset_id: string;
  type: string;
  lender: string;
  amount: number;
  note: string;
  ts: string;
  prev_hash: string;
  hash: string;
}> = [];
let COUNTERS = { fraud_blocked: 0 };
let AUCTION: {
  active: boolean;
  amount: number;
  best: { lender: string; rate: number } | null;
  bids: Record<string, number>;
} = { active: false, amount: 0, best: null, bids: {} };

function computeRisk(a: typeof ASSET): number {
  const buyer_risk = a.contractual?.buyer_risk ?? 0.15;
  const delay_days = a.physical?.delay_days ?? 0;
  const condition = a.physical?.condition ?? "OK";
  const cond_factor = condition !== "OK" ? 0.7 : 0.0;
  const delay_factor = Math.min(delay_days / 10.0, 1.0);
  const raw = 0.4 * buyer_risk + 0.25 * delay_factor + 0.2 * cond_factor + 0.15 * 0.1;
  const clamped = Math.max(0.0, Math.min(1.0, raw));
  return Math.round(clamped * 100) / 100;
}

function effectiveLtv(a: typeof ASSET): number {
  const stage = a.stage || "NEW";
  const base = BASE_LTV[stage] ?? 0.0;
  const risk = computeRisk(a);
  const eff = base * (1.0 - 0.4 * risk);
  return Math.round(eff * 1000) / 1000;
}

function recomputeFinance(a: typeof ASSET): { capacity: number; headroom: number } {
  const risk = computeRisk(a);
  a.risk_index = risk;
  const eff = effectiveLtv(a);
  const orderValue = a.order_value || 5000000;
  const drawn = a.financial?.drawn || 0;
  const capacity = Math.floor(orderValue * eff);
  const headroom = Math.max(capacity - drawn, 0);

  a.financial.safe_limit = headroom;
  a.financial.frozen = capacity < drawn;

  const stage = a.stage;
  if (stage && INSTRUMENT[stage] && (a.financial.instrument === "—" || !a.financial.instrument) && stage !== "NEW") {
    a.financial.instrument = INSTRUMENT[stage];
  }

  return { capacity, headroom };
}

function addLedger(asset_id: string, rtype: string, lender: string, amount: number, note = "") {
  const prev_hash = LEDGER.length > 0 ? LEDGER[LEDGER.length - 1].hash : "GENESIS";
  const ts = nowTs();
  const amt = Math.floor(amount);
  const raw = `${prev_hash}${asset_id}${rtype}${lender}${amt}${ts}`;
  const h = crypto.createHash("sha256").update(raw, "utf8").digest("hex");
  const record = {
    asset_id,
    type: rtype,
    lender,
    amount: amt,
    note,
    ts,
    prev_hash,
    hash: h,
  };
  LEDGER.push(record);
  return record;
}

function verifyLedger(): boolean {
  if (LEDGER.length === 0) return true;
  for (let i = 0; i < LEDGER.length; i++) {
    const rec = LEDGER[i];
    const expected_prev = i > 0 ? LEDGER[i - 1].hash : "GENESIS";
    if (rec.prev_hash !== expected_prev) return false;
    const raw = `${rec.prev_hash}${rec.asset_id}${rec.type}${rec.lender}${rec.amount}${rec.ts}`;
    const computed = crypto.createHash("sha256").update(raw, "utf8").digest("hex");
    if (rec.hash !== computed) return false;
  }
  return true;
}

function totalClaims(asset_id: string): number {
  return LEDGER.filter((r) => r.asset_id === asset_id && r.type === "financing").reduce(
    (sum, r) => sum + r.amount,
    0
  );
}

function checkLedger(asset_id: string, amount: number, requester: string): { ok: boolean; reason: string } {
  const owner = ASSET.contractual?.owner || "Ravi Textiles";
  if (requester !== owner) {
    return {
      ok: false,
      reason: `BLOCKED — requester '${requester}' does not own ${asset_id}; title is with ${owner}.`,
    };
  }
  const existing = totalClaims(asset_id);
  const eff = effectiveLtv(ASSET);
  const orderVal = ASSET.order_value || 5000000;
  const safeCap = Math.floor(orderVal * eff);
  if (existing + amount > safeCap) {
    return {
      ok: false,
      reason: `BLOCKED — claims would exceed safe capacity (existing ₹${existing.toLocaleString("en-IN")} + requested ₹${amount.toLocaleString("en-IN")} > ₹${safeCap.toLocaleString("en-IN")}).`,
    };
  }
  return { ok: true, reason: "clear" };
}

// WebSocket Bus
const wsClients = new Set<WebSocket>();

function broadcast(obj: any) {
  const msg = JSON.stringify(obj);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

async function pushTwin() {
  broadcast({
    kind: "twin_update",
    asset: ASSET,
    meta: {
      fraud_blocked: COUNTERS.fraud_blocked,
      ledger_count: LEDGER.length,
    },
  });
}

async function pushMsg(agent: string, reason: string) {
  const ts = nowTs();
  const entry = { agent, reason, ts };
  ASSET.history.push(entry);
  if (ASSET.history.length > 40) {
    ASSET.history = ASSET.history.slice(-40);
  }
  broadcast({
    kind: "agent_message",
    agent,
    reason,
    ts,
  });
}

async function pushLedger() {
  broadcast({
    kind: "ledger_update",
    records: LEDGER,
  });
}

// Auction Bot Definition
const BOTS = [
  { name: "Cautious Bank", start: 14.0, floor: 11.0, step: 0.35 },
  { name: "Aggressive NBFC", start: 13.0, floor: 8.5, step: 0.9 },
  { name: "Balanced Fintech", start: 13.5, floor: 9.5, step: 0.6 },
];

async function runAuction(amount: number) {
  AUCTION.active = true;
  AUCTION.amount = amount;
  AUCTION.best = null;
  AUCTION.bids = {
    "Cautious Bank": 14.0,
    "Aggressive NBFC": 13.0,
    "Balanced Fintech": 13.5,
  };

  const risk_pts = (ASSET.risk_index || 0.08) * 4;
  broadcast({ kind: "auction_start", amount });

  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 1200));
    for (const bot of BOTS) {
      const curr = AUCTION.bids[bot.name];
      const botFloor = bot.floor + risk_pts;
      if (curr > botFloor && Math.random() < 0.85) {
        const cut = Math.random() * (bot.step - 0.2) + 0.2;
        const newRate = Math.round(Math.max(bot.floor, curr - cut) * 100) / 100;
        AUCTION.bids[bot.name] = newRate;
        broadcast({ kind: "bid", lender: bot.name, rate: newRate });
      }
    }
  }

  let minBot = "Aggressive NBFC";
  let minRate = Infinity;
  for (const [name, rate] of Object.entries(AUCTION.bids)) {
    if (rate < minRate) {
      minRate = rate;
      minBot = name;
    }
  }

  const best = { lender: minBot, rate: minRate };
  AUCTION.best = best;
  AUCTION.active = false;

  broadcast({ kind: "auction_end", best, amount });
  await pushMsg(
    "Loan",
    `Bank battle over — best offer ${best.rate.toFixed(2)}% from ${best.lender} for ₹${amount.toLocaleString("en-IN")}.`
  );
}

// Agent events
async function runAgentEvents(asset: typeof ASSET, eventType: string) {
  const risk = asset.risk_index || 0.08;
  const safe_lim = asset.financial?.safe_limit || 0;
  const safe_str = safe_lim.toLocaleString("en-IN");

  if (eventType === "ORDER_CONFIRMED") {
    await pushMsg("Tracker", "Order confirmed for 10,000 t-shirts by BigRetail. Title registered to Ravi Textiles.");
    await pushMsg("Risk", `Initial baseline risk assessed at ${risk.toFixed(2)}. Buyer BigRetail credit rating rated AA.`);
    await pushMsg("Loan", `Safe financing headroom established at ₹${safe_str} (50% LTV). Available for PO drawdown.`);
  } else if (eventType === "RAW_PROCURED") {
    await pushMsg("Tracker", "Yarn & dye procured at Ravi's factory. Value added to physical asset.");
    await pushMsg("Loan", `Stage advanced to RAW_PROCURED. Base LTV elevated to 55%. Safe limit updated to ₹${safe_str}.`);
  } else if (eventType === "PRODUCED") {
    await pushMsg("Tracker", "10,000 t-shirts manufactured and quality checked at Factory store.");
    await pushMsg("Loan", `Stage updated to FINISHED_GOODS. Inventory financing headroom unlocked at 65% LTV (₹${safe_str}).`);
  } else if (eventType === "SHIPPED") {
    await pushMsg("Tracker", "Consignment in transit on NH-48 via GPS-tracked container fleet.");
    await pushMsg("Risk", "In-transit sensors online. Telemetry and route adherence normal.");
    await pushMsg("Loan", `LTV increased to 75% for in-transit financing (₹${safe_str} safe headroom).`);
  } else if (eventType === "DELAYED") {
    const delay = asset.physical?.delay_days || 3;
    await pushMsg("Tracker", `Logistics alert: +3 days transit delay reported (total delay: ${delay}d) due to highway congestion.`);
    await pushMsg("Risk", `Transit delay detected (+3 days). Risk index adjusted upwards to ${risk.toFixed(2)}. Financing capacity scaled down.`);
  } else if (eventType === "TEMP_SPIKE") {
    await pushMsg("Tracker", "Sensor telemetry alert: Temperature spike detected in transit container.");
    await pushMsg("Risk", `Condition marked DEGRADED (heat). Risk index elevated to ${risk.toFixed(2)} to account for inspection buffer.`);
  } else if (eventType === "WAREHOUSED") {
    await pushMsg("Tracker", "Goods safely received and checked in at Chennai WH-7.");
    await pushMsg("Loan", `Warehouse financing active at 80% LTV. Headroom recomputed to ₹${safe_str}.`);
  } else if (eventType === "DELIVERED") {
    await pushMsg("Tracker", "Proof of Delivery logged at BigRetail DC. Delay counter reset to 0.");
    await pushMsg("Risk", `Delivery confirmed. Physical transit risk resolved to baseline (${risk.toFixed(2)}).`);
    await pushMsg("Loan", `Trade financing headroom expanded to 85% LTV (₹${safe_str}).`);
  } else if (eventType === "INVOICED") {
    await pushMsg("Tracker", "Commercial Invoice raised for ₹50,00,000 under net-60 terms with BigRetail.");
    await pushMsg("Loan", `Invoice financing unlocked at maximum 90% LTV (₹${safe_str} safe headroom).`);
  } else if (eventType === "RECEIVABLE_DELAYED") {
    await pushMsg("Tracker", "Payment alert: BigRetail missed day-60 settlement schedule.");
    await pushMsg("Risk", `Buyer risk elevated (+0.35). Risk index adjusted to ${risk.toFixed(2)}; credit headroom constrained.`);
  }
}

function getUserEmail(username: string): string {
  if (username === "ravi123" || username === "ravi") {
    return (process.env.DEMO_SUPPLIER_EMAIL || "").trim() || "supplier@capitaltwin.demo";
  }
  if (username === "lender01" || username === "lender") {
    return (process.env.DEMO_LENDER_EMAIL || "").trim() || "lender@capitaltwin.demo";
  }
  if (username === "admin2026" || username === "admin") {
    return (process.env.DEMO_ADMIN_EMAIL || "").trim() || "admin@capitaltwin.demo";
  }
  return `${username}@capitaltwin.demo`;
}

function getUserByEmail(email: string): { id: string; username: string; role: string; name: string; org: string; is_active: boolean } | null {
  const cleanEmail = email.trim().toLowerCase();
  for (const [uname, u] of Object.entries(USERS)) {
    const userEmail = getUserEmail(uname).toLowerCase();
    if (userEmail === cleanEmail) {
      return {
        id: uname,
        username: uname,
        role: u.role,
        name: u.name,
        org: u.org,
        is_active: true,
      };
    }
  }
  return null;
}

// In-memory Audit Log Store
interface AuditLog {
  id: number;
  userId: string | null;
  action: string;
  ip: string;
  detail: string;
  timestamp: string;
}
let auditLogCounter = 0;
const AUDIT_LOGS: AuditLog[] = [];

const auditRepo = {
  logAuthEvent(userId: string | null, action: string, ip: string, detail: string) {
    auditLogCounter += 1;
    AUDIT_LOGS.push({
      id: auditLogCounter,
      userId,
      action,
      ip,
      detail,
      timestamp: new Date().toISOString(),
    });
  },
  getLogs() {
    return AUDIT_LOGS;
  },
};

// In-memory OTP store
interface OtpRecord {
  id: number;
  user_id: string;
  email: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  consumed: number;
  created_at: string;
}

let otpIdCounter = 0;
const OTP_STORE: OtpRecord[] = [];

const otpRepo = {
  createOtp(userId: string, email: string, codeHash: string, expiresAt: string): OtpRecord {
    const now = new Date().toISOString();
    const normalized = email.trim().toLowerCase();
    for (const item of OTP_STORE) {
      if (item.email === normalized && item.consumed === 0) {
        item.consumed = 1;
      }
    }
    otpIdCounter += 1;
    const record: OtpRecord = {
      id: otpIdCounter,
      user_id: userId,
      email: normalized,
      code_hash: codeHash,
      expires_at: expiresAt,
      attempts: 0,
      consumed: 0,
      created_at: now,
    };
    OTP_STORE.push(record);
    return record;
  },
  getActiveByEmail(email: string): OtpRecord | null {
    const now = new Date().toISOString();
    const normalized = email.trim().toLowerCase();
    for (let i = OTP_STORE.length - 1; i >= 0; i--) {
      const rec = OTP_STORE[i];
      if (rec.email === normalized && rec.consumed === 0 && rec.expires_at > now) {
        return rec;
      }
    }
    return null;
  },
  incrementAttempts(id: number): number {
    const rec = OTP_STORE.find((r) => r.id === id);
    if (rec) {
      rec.attempts += 1;
      return rec.attempts;
    }
    return 0;
  },
  markConsumed(id: number): void {
    const rec = OTP_STORE.find((r) => r.id === id);
    if (rec) {
      rec.consumed = 1;
    }
  },
};

export function generateOtpCode(): string {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Simple in-memory login rate limiter (zero deps): max 8 failed attempts / 15 min per IP.
const LOGIN_ATTEMPTS = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 8;

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "127.0.0.1";
}

function loginRateBlocked(key: string): boolean {
  const entry = LOGIN_ATTEMPTS.get(key);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    LOGIN_ATTEMPTS.delete(key);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILURES;
}

function loginRateFail(key: string): void {
  const now = Date.now();
  const entry = LOGIN_ATTEMPTS.get(key);
  if (!entry || now > entry.resetAt) {
    LOGIN_ATTEMPTS.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

function loginRateClear(key: string): void {
  LOGIN_ATTEMPTS.delete(key);
}

// POST /auth/login (and /login alias)
const handleLoginRoute = (req: Request, res: Response) => {
  const { username = "", password = "" } = req.body || {};
  const ip = getClientIp(req);

  if (loginRateBlocked(ip)) {
    auditRepo.logAuthEvent(null, "LOGIN_FAILURE", ip, "RATE_LIMITED");
    return res.status(429).json({
      ok: false,
      error: "Too many failed login attempts. Please wait a few minutes and try again.",
    });
  }

  const user = USERS[username];
  if (!user || user.pw !== password) {
    loginRateFail(ip);
    auditRepo.logAuthEvent(user ? username : null, "LOGIN_FAILURE", ip, "INVALID_CREDENTIALS");
    return res.status(401).json({ ok: false, why: "Invalid username or password", error: "Invalid username or password" });
  }

  loginRateClear(ip);
  auditRepo.logAuthEvent(username, "LOGIN_SUCCESS", ip, "SUCCESS");

  const safeUser = {
    id: username,
    username,
    role: user.role,
    name: user.name,
    org: user.org,
    email: getUserEmail(username),
    is_active: true,
  };

  res.json({
    ok: true,
    user: safeUser,
    username,
    role: user.role,
    name: user.name,
    org: user.org,
    email: safeUser.email,
  });
};

app.post("/auth/login", handleLoginRoute);
app.post("/login", handleLoginRoute);

// --------------------------------------------------
// EMAIL OTP (PASSWORDLESS) LOGIN
// --------------------------------------------------

const OTP_REQUESTS = new Map<string, { count: number; resetAt: number }>();
const OTP_REQUEST_WINDOW_MS = 10 * 60 * 1000;
const OTP_REQUEST_MAX = 3;
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_VERIFY_ATTEMPTS = 5;

function otpRequestAllowed(key: string): boolean {
  const now = Date.now();
  const entry = OTP_REQUESTS.get(key);
  if (!entry || now > entry.resetAt) {
    OTP_REQUESTS.set(key, { count: 1, resetAt: now + OTP_REQUEST_WINDOW_MS });
    return true;
  }
  if (entry.count >= OTP_REQUEST_MAX) return false;
  entry.count += 1;
  return true;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function otpDevMode(): boolean {
  if (process.env.OTP_DEV_MODE === "false") return false;
  if (process.env.OTP_DEV_MODE === "true") return true;
  return !process.env.RESEND_API_KEY;
}

async function sendOtpEmail(email: string, code: string): Promise<{ sent: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, error: "RESEND_API_KEY not configured" };
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || "CapitalTwin <onboarding@resend.dev>",
        to: [email],
        subject: `${code} is your CapitalTwin login code`,
        text: `Your CapitalTwin one-time login code is ${code}.\n\nIt expires in 5 minutes. If you didn't request this, you can ignore this email.`,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      return { sent: false, error: `Email provider error ${resp.status}: ${body.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (err: any) {
    return { sent: false, error: err?.message || String(err) };
  }
}

// POST /auth/otp/request — issue a one-time code for a registered email
app.post("/auth/otp/request", async (req: Request, res: Response) => {
  const { email = "" } = req.body || {};
  const ip = getClientIp(req);
  const cleanEmail = String(email).trim().toLowerCase();

  if (!cleanEmail || !isValidEmail(cleanEmail)) {
    return res.status(400).json({ ok: false, error: "A valid email address is required." });
  }

  if (!otpRequestAllowed(`${ip}:${cleanEmail}`)) {
    auditRepo.logAuthEvent(null, "OTP_REQUEST", ip, "RATE_LIMITED");
    return res.status(429).json({ ok: false, error: "Too many code requests. Please wait a few minutes." });
  }

  const genericMsg = "If that email is registered, a login code has been sent.";
  const user = getUserByEmail(cleanEmail);

  if (!user || !user.is_active) {
    auditRepo.logAuthEvent(null, "OTP_REQUEST", ip, `UNKNOWN_EMAIL: ${cleanEmail.slice(0, 40)}`);
    // Identical response to the success path to prevent account enumeration
    return res.json({ ok: true, message: genericMsg });
  }

  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
  otpRepo.createOtp(user.id, cleanEmail, hashSessionToken(code), expiresAt);
  auditRepo.logAuthEvent(user.id, "OTP_REQUEST", ip, "CODE_ISSUED");

  const delivery = await sendOtpEmail(cleanEmail, code);

  if (otpDevMode()) {
    // Demo convenience only: expose the code so the flow works without an
    // email provider. Set OTP_DEV_MODE=false with a real key for production.
    console.log(`[OTP DEV MODE] Login code for ${cleanEmail}: ${code}`);
    return res.json({
      ok: true,
      message: delivery.sent ? genericMsg : "Dev mode: email provider not configured; code shown below.",
      dev_mode: true,
      demo_otp: code,
    });
  }

  if (!delivery.sent) {
    console.error("OTP email delivery failed:", delivery.error);
    return res.status(502).json({ ok: false, error: "Could not send the code email. Try again shortly." });
  }

  return res.json({ ok: true, message: genericMsg });
});

// POST /auth/otp/verify — exchange email + code for an authenticated session
app.post("/auth/otp/verify", (req: Request, res: Response) => {
  const { email = "", code = "" } = req.body || {};
  const ip = getClientIp(req);
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanCode = String(code).trim();

  if (!cleanEmail || !isValidEmail(cleanEmail) || !/^\d{6}$/.test(cleanCode)) {
    return res.status(400).json({ ok: false, error: "Email and the 6-digit code are required." });
  }

  const user = getUserByEmail(cleanEmail);
  const active = user ? otpRepo.getActiveByEmail(cleanEmail) : null;

  if (!user || !user.is_active || !active) {
    auditRepo.logAuthEvent(user ? user.id : null, "OTP_LOGIN_FAILURE", ip, "NO_ACTIVE_CODE");
    return res.status(401).json({ ok: false, error: "Invalid or expired code. Request a new one." });
  }

  if (active.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    otpRepo.markConsumed(active.id);
    auditRepo.logAuthEvent(user.id, "OTP_LOGIN_FAILURE", ip, "MAX_ATTEMPTS");
    return res.status(429).json({ ok: false, error: "Too many incorrect attempts. Request a new code." });
  }

  const providedHash = Buffer.from(hashSessionToken(cleanCode), "hex");
  const storedHash = Buffer.from(active.code_hash, "hex");
  const match = providedHash.length === storedHash.length && crypto.timingSafeEqual(providedHash, storedHash);

  if (!match) {
    const attempts = otpRepo.incrementAttempts(active.id);
    auditRepo.logAuthEvent(user.id, "OTP_LOGIN_FAILURE", ip, `WRONG_CODE_${attempts}`);
    return res.status(401).json({ ok: false, error: "Invalid or expired code. Request a new one." });
  }

  otpRepo.markConsumed(active.id);

  const rawToken = generateSessionToken();
  auditRepo.logAuthEvent(user.id, "OTP_LOGIN_SUCCESS", ip, "SUCCESS");

  const safeUser = {
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    org: user.org,
    email: cleanEmail,
    is_active: true,
  };
  return res.json({ ok: true, user: safeUser, token: rawToken, ...safeUser });
});

app.get("/admin/audit-logs", (req: Request, res: Response) => {
  res.json({ ok: true, logs: auditRepo.getLogs() });
});

app.get("/asset/:id", (req: Request, res: Response) => {
  recomputeFinance(ASSET);
  res.json({
    asset: ASSET,
    meta: {
      fraud_blocked: COUNTERS.fraud_blocked,
      ledger_count: LEDGER.length,
    },
  });
});

app.get("/ledger/:id", (req: Request, res: Response) => {
  res.json({
    records: LEDGER,
    chain_ok: verifyLedger(),
  });
});

app.post("/event", async (req: Request, res: Response) => {
  const { asset_id = "ORD-123", type: etype } = req.body || {};
  const order_val = ASSET.order_value || 5000000;

  if (etype === "DOUBLE_FINANCE_ATTEMPT") {
    const chk = checkLedger(asset_id, order_val * 0.6, "ShadyLend Corp");
    COUNTERS.fraud_blocked += 1;
    const verifyStr = verifyLedger() ? " Ledger chain verified: intact ✓" : " TAMPERED";
    const fullMsg = chk.reason + verifyStr;
    await pushMsg("Fraud", fullMsg);
    await pushTwin();
    return res.json({ blocked: true, reason: fullMsg });
  }

  if (etype === "BUYER_PAID") {
    ASSET.stage = "SETTLED";
    const drawn = ASSET.financial?.drawn || 0;
    const lenderName = ASSET.financial?.lender || "—";
    if (drawn > 0) {
      addLedger(asset_id, "settlement", lenderName, -drawn, "loan repaid from buyer payment");
      await pushLedger();
    }
    ASSET.financial.drawn = 0;
    ASSET.financial.rate = 0.0;
    ASSET.financial.instrument = "settled";
    ASSET.financial.lender = "—";
    recomputeFinance(ASSET);

    await pushMsg(
      "Transition",
      `Buyer paid ₹${order_val.toLocaleString("en-IN")} — loan of ₹${drawn.toLocaleString("en-IN")} settled itself; lifecycle complete.`
    );
    await pushTwin();
    return res.json({ ok: true, stage: "SETTLED" });
  }

  if (etype === "ORDER_CONFIRMED") {
    ASSET.stage = "PO_ISSUED";
    ASSET.physical.location = "Ravi's factory";
    const expDate = new Date();
    expDate.setDate(expDate.getDate() + 135);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    ASSET.contractual.expected_cash_date = `${expDate.getDate()} ${months[expDate.getMonth()]}`;
    recomputeFinance(ASSET);
    await runAgentEvents(ASSET, etype);
    await pushTwin();
    return res.json({ ok: true, stage: ASSET.stage });
  }

  if (etype === "RAW_PROCURED") {
    ASSET.stage = "RAW_PROCURED";
    ASSET.physical.location = "Ravi's factory";
    recomputeFinance(ASSET);
    await runAgentEvents(ASSET, etype);
    await pushTwin();
    return res.json({ ok: true, stage: ASSET.stage });
  }

  if (etype === "PRODUCED") {
    ASSET.stage = "FINISHED_GOODS";
    ASSET.physical.location = "Factory store";
    recomputeFinance(ASSET);
    await runAgentEvents(ASSET, etype);
    await pushTwin();
    return res.json({ ok: true, stage: ASSET.stage });
  }

  if (etype === "SHIPPED") {
    ASSET.stage = "IN_TRANSIT";
    ASSET.physical.location = "NH-48, in transit";
    recomputeFinance(ASSET);
    await runAgentEvents(ASSET, etype);
    await pushTwin();
    return res.json({ ok: true, stage: ASSET.stage });
  }

  if (etype === "DELAYED") {
    ASSET.physical.delay_days = (ASSET.physical?.delay_days || 0) + 3;
    recomputeFinance(ASSET);
    await runAgentEvents(ASSET, etype);
    await pushTwin();
    return res.json({ ok: true, delay_days: ASSET.physical.delay_days });
  }

  if (etype === "TEMP_SPIKE") {
    ASSET.physical.condition = "DEGRADED (heat)";
    recomputeFinance(ASSET);
    await runAgentEvents(ASSET, etype);
    await pushTwin();
    return res.json({ ok: true, condition: ASSET.physical.condition });
  }

  if (etype === "WAREHOUSED") {
    ASSET.stage = "WAREHOUSED";
    ASSET.physical.location = "Chennai WH-7";
    recomputeFinance(ASSET);
    await runAgentEvents(ASSET, etype);
    await pushTwin();
    return res.json({ ok: true, stage: ASSET.stage });
  }

  if (etype === "DELIVERED") {
    ASSET.stage = "DELIVERED";
    ASSET.physical.location = "BigRetail DC";
    ASSET.physical.delay_days = 0;
    recomputeFinance(ASSET);
    await runAgentEvents(ASSET, etype);
    await pushTwin();
    return res.json({ ok: true, stage: ASSET.stage });
  }

  if (etype === "INVOICED") {
    ASSET.stage = "INVOICED";
    recomputeFinance(ASSET);
    await runAgentEvents(ASSET, etype);
    await pushTwin();
    return res.json({ ok: true, stage: ASSET.stage });
  }

  if (etype === "RECEIVABLE_DELAYED") {
    const bRisk = ASSET.contractual?.buyer_risk || 0.15;
    ASSET.contractual.buyer_risk = Math.round(Math.min(1.0, bRisk + 0.35) * 100) / 100;
    recomputeFinance(ASSET);
    await runAgentEvents(ASSET, etype);
    await pushTwin();
    return res.json({ ok: true, buyer_risk: ASSET.contractual.buyer_risk });
  }

  return res.status(400).json({ error: `Unknown event type: ${etype}` });
});

app.post("/financing/request", async (req: Request, res: Response) => {
  const { asset_id = "ORD-123", amount } = req.body || {};
  const { headroom } = recomputeFinance(ASSET);

  if (headroom <= 0) {
    const chk = checkLedger(asset_id, amount || 1, ASSET.contractual?.owner || "Ravi Textiles");
    COUNTERS.fraud_blocked += 1;
    await pushMsg("Fraud", chk.reason);
    await pushTwin();
    return res.status(409).json({ blocked: true, reason: chk.reason });
  }

  const requestedAmount = amount !== undefined && Number(amount) > 0 ? Number(amount) : headroom;
  const finalAmount = Math.min(requestedAmount, headroom);

  if (finalAmount < requestedAmount) {
    const eff = effectiveLtv(ASSET);
    const ltvPct = Math.round(eff * 100);
    await pushMsg(
      "Loan",
      `Requested ₹${requestedAmount.toLocaleString("en-IN")} exceeds the safe limit — capped to ₹${finalAmount.toLocaleString("en-IN")} (LTV ${ltvPct}%).`
    );
  }

  await pushMsg("Fraud", "Ledger check clear — no duplicate claims; ownership verified. Opening the bank battle.");
  runAuction(finalAmount);
  res.json({ auction: "started", amount: finalAmount });
});

app.post("/financing/accept", async (req: Request, res: Response) => {
  const best = AUCTION.best;
  if (!best) {
    return res.status(400).json({ error: "No active or concluded auction to accept." });
  }

  const { headroom } = recomputeFinance(ASSET);
  const amt = Math.min(AUCTION.amount || headroom, headroom) || AUCTION.amount;
  const stage = ASSET.stage || "PO_ISSUED";
  const instrument = INSTRUMENT[stage] || "trade financing";

  addLedger(ASSET.id || "ORD-123", "financing", best.lender, amt, instrument);

  ASSET.financial.drawn = (ASSET.financial.drawn || 0) + amt;
  ASSET.financial.lender = best.lender;
  ASSET.financial.rate = best.rate;
  ASSET.financial.instrument = instrument;
  recomputeFinance(ASSET);

  await pushMsg(
    "Loan",
    `₹${amt.toLocaleString("en-IN")} disbursed by ${best.lender} at ${best.rate.toFixed(2)}% — recorded on the exposure ledger.`
  );
  await pushLedger();
  await pushTwin();

  AUCTION.best = null;
  res.json({ ok: true, amount: amt, lender: best.lender, rate: best.rate });
});

app.post("/ask", async (req: Request, res: Response) => {
  const { q = "" } = req.body || {};
  recomputeFinance(ASSET);

  const stage = ASSET.stage || "NEW";
  const loc = ASSET.physical?.location || "Ravi's factory";
  const risk = (ASSET.risk_index || 0.08).toFixed(2);
  const safe = (ASSET.financial?.safe_limit || 0).toLocaleString("en-IN");
  const drawn = (ASSET.financial?.drawn || 0).toLocaleString("en-IN");
  const inst = ASSET.financial?.instrument || "—";
  const expCash = ASSET.contractual?.expected_cash_date || "—";

  const fallback = `Asset ORD-123 is at ${stage} stage located at ${loc} with risk index ${risk}. Safe financing limit is ₹${safe} with ₹${drawn} drawn under ${inst}. Expected cash date is ${expCash}.`;

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
        contents: `You are CapitalTwin's AI Assistant for supply chain financing. Digital twin state: ${JSON.stringify(ASSET)}. Question: ${q}. Give a concise, professional, clear 1-2 sentence response. Direct facts only.`,
      });
      if (response && response.text) {
        answer = response.text.trim();
      }
    } catch {
      answer = fallback;
    }
  }

  await pushMsg("Assistant", answer);
  res.json({ answer });
});

app.get("/speak", (req: Request, res: Response) => {
  res.status(503).send("Fallback to client speechSynthesis");
});

app.post("/reset", async (req: Request, res: Response) => {
  ASSET = freshAsset();
  LEDGER = [];
  COUNTERS.fraud_blocked = 0;
  AUCTION = { active: false, amount: 0, best: null, bids: {} };
  await pushLedger();
  await pushTwin();
  await pushMsg("Tracker", "Demo reset — fresh asset ready.");
  res.json({ ok: true });
});

// Setup WebSocket Server
const wss = new WebSocketServer({ server, path: "/ws/live" });
wss.on("connection", (ws: WebSocket) => {
  wsClients.add(ws);

  // Send initial payloads
  ws.send(
    JSON.stringify({
      kind: "twin_update",
      asset: ASSET,
      meta: {
        fraud_blocked: COUNTERS.fraud_blocked,
        ledger_count: LEDGER.length,
      },
    })
  );

  ws.send(
    JSON.stringify({
      kind: "ledger_update",
      records: LEDGER,
    })
  );

  ws.on("close", () => {
    wsClients.delete(ws);
  });
  ws.on("error", () => {
    wsClients.delete(ws);
  });
});

// Static / Vite integration
async function start() {
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
    console.log(`CapitalTwin Server running on http://0.0.0.0:${PORT}`);
  });
}

start();
