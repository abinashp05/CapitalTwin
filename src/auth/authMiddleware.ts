import { Request, Response, NextFunction } from "express";
import { hashSessionToken } from "./passwordUtils";
import { sessionRepo, userRepo, SafeUser, UserRole } from "../db";
import { assetRegistry } from "../state/assetRuntime";

declare global {
  namespace Express {
    interface Request {
      user?: SafeUser;
      sessionToken?: string;
    }
  }
}

/**
 * Parses cookies from the Cookie request header without external dependencies.
 */
export function parseCookies(cookieHeader?: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx < 0) continue;
    const key = pair.substring(0, idx).trim();
    const val = pair.substring(idx + 1).trim();
    cookies[key] = decodeURIComponent(val);
  }
  return cookies;
}

/**
 * Extracts session token from cookie or Authorization header.
 */
export function extractToken(req: Request): string | null {
  // 1. Try HttpOnly cookie
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.capitaltwin_session) {
    return cookies.capitaltwin_session;
  }

  // 2. Try Authorization: Bearer <token>
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7).trim();
  }

  return null;
}

/**
 * Resolves session and safe user record from request token.
 */
export function resolveUserFromRequest(req: Request): { user: SafeUser; token: string } | null {
  const token = extractToken(req);
  if (!token) return null;

  const tokenHash = hashSessionToken(token);
  const sessionResult = sessionRepo.getSessionWithUser(tokenHash);
  if (!sessionResult) return null;

  const { session, user } = sessionResult;
  if (!user.is_active) return null;

  // Extend rolling session expiry
  sessionRepo.updateSessionActivity(session.id);

  const safeUser = userRepo.toSafeUser(user);
  return { user: safeUser, token };
}

/**
 * Middleware: Requires an active, authenticated session.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = resolveUserFromRequest(req);
  if (!auth) {
    res.status(401).json({
      ok: false,
      error: "Unauthorized: Invalid or expired session. Please log in.",
    });
    return;
  }

  req.user = auth.user;
  req.sessionToken = auth.token;
  next();
}

/**
 * Middleware: Requires the authenticated user to possess one of the specified roles.
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      const auth = resolveUserFromRequest(req);
      if (!auth) {
        res.status(401).json({
          ok: false,
          error: "Unauthorized: Please log in to perform this action.",
        });
        return;
      }
      req.user = auth.user;
      req.sessionToken = auth.token;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        ok: false,
        error: `Forbidden: Access restricted to role(s): [${roles.join(", ")}]. Current role: ${req.user.role}`,
      });
      return;
    }

    next();
  };
}

/**
 * Middleware: Enforces asset ownership policies.
 * - Admin: Full access to all assets.
 * - Lender: Read-only access to all portfolio assets.
 * - Supplier: Allowed only if the asset belongs to their organization (contractual.owner).
 */
export function requireAssetOwnership(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  // Admin has universal asset access
  if (req.user.role === "admin") {
    next();
    return;
  }

  // Extract asset id from route params, body, or query
  const assetId = (req.params.id || req.body.asset_id || req.query.asset_id || "") as string;
  if (!assetId) {
    // If no specific asset specified in route/body, continue
    next();
    return;
  }

  const asset = assetRegistry.getAsset(assetId);
  if (!asset) {
    res.status(404).json({ ok: false, error: `Asset ${assetId} not found.` });
    return;
  }

  // Lender has read access to all portfolio assets
  if (req.user.role === "lender") {
    // If lender attempts write/modification, block; otherwise allow read and shadow simulations
    const fullUrl = req.originalUrl || req.url || req.path || "";
    const isReadMethod = req.method === "GET" || fullUrl.includes("/shadow/simulate");
    if (isReadMethod) {
      next();
      return;
    }
    res.status(403).json({
      ok: false,
      error: "Forbidden: Lenders cannot mutate asset lifecycle or initiate financing.",
    });
    return;
  }

  // Supplier role: Must match asset contractual owner/org
  if (req.user.role === "supplier") {
    const userOrg = (req.user.org || "").trim().toLowerCase();
    const assetOwner = (asset.contractual?.owner || "").trim().toLowerCase();

    // Check organization match or standard fallback
    if (userOrg && assetOwner && userOrg !== assetOwner) {
      res.status(403).json({
        ok: false,
        error: `Forbidden: Asset ${assetId} is owned by '${asset.contractual.owner}'. Your organization '${req.user.org}' does not have ownership access.`,
      });
      return;
    }

    next();
    return;
  }

  res.status(403).json({ ok: false, error: "Forbidden: Insufficient privileges." });
}
