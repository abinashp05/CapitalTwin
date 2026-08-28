import crypto from "crypto";

export interface PasswordHashResult {
  hash: string;
  salt: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates username:
 * - /^[a-zA-Z0-9_]{3,30}$/
 */
export function validateUsername(username: string): ValidationResult {
  if (!username || typeof username !== "string") {
    return { valid: false, error: "Username is required." };
  }
  const trimmed = username.trim();
  if (trimmed.length < 3 || trimmed.length > 30) {
    return { valid: false, error: "Username must be between 3 and 30 characters." };
  }
  const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;
  if (!usernameRegex.test(trimmed)) {
    return {
      valid: false,
      error: "Username can only contain alphanumeric characters and underscores (letters, numbers, _).",
    };
  }
  return { valid: true };
}

/**
 * Validates password:
 * - 8 to 72 characters
 * - at least 1 uppercase letter
 * - at least 1 lowercase letter
 * - at least 1 digit
 * - at least 1 special character
 */
export function validatePassword(password: string): ValidationResult {
  if (!password || typeof password !== "string") {
    return { valid: false, error: "Password is required." };
  }
  if (password.length < 8) {
    return { valid: false, error: "Password must be at least 8 characters long." };
  }
  if (password.length > 72) {
    return { valid: false, error: "Password cannot exceed 72 characters." };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: "Password must contain at least one uppercase letter (A-Z)." };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: "Password must contain at least one lowercase letter (a-z)." };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: "Password must contain at least one numeric digit (0-9)." };
  }
  const specialCharRegex = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/;
  if (!specialCharRegex.test(password)) {
    return { valid: false, error: "Password must contain at least one special character (e.g. !@#$%^&*)." };
  }
  return { valid: true };
}

/**
 * Hashes a plaintext password using crypto.scryptSync with a 32-byte cryptographically secure random salt.
 */
export function hashPassword(password: string, providedSalt?: string): PasswordHashResult {
  const salt = providedSalt || crypto.randomBytes(32).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return {
    hash: derivedKey.toString("hex"),
    salt,
  };
}

/**
 * Timing-safe verification of password against stored hash and salt.
 */
export function verifyPassword(password: string, storedHash: string, salt: string): boolean {
  try {
    const derivedKey = crypto.scryptSync(password, salt, 64);
    const storedBuffer = Buffer.from(storedHash, "hex");
    if (derivedKey.length !== storedBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(derivedKey, storedBuffer);
  } catch (err) {
    return false;
  }
}

/**
 * Generates a cryptographically random 32-byte hex session token.
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Generates SHA-256 hash of a session token for secure database storage.
 */
export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
