import crypto from "crypto";

export function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Generates a 6-digit numeric one-time passcode (leading zeros allowed).
 */
export function generateOtpCode(): string {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}
