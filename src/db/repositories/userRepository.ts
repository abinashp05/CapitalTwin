import type Database from "better-sqlite3";
import crypto from "crypto";
import { hashPassword } from "../../auth/passwordUtils";

export type UserRole = "supplier" | "lender" | "admin";

export interface UserRecord {
  id: string;
  username: string;
  password_hash: string;
  salt: string;
  role: UserRole;
  name: string;
  org: string;
  created_at: string;
  updated_at: string;
  is_active: number; // 1 = active, 0 = inactive
}

export interface SafeUser {
  id: string;
  username: string;
  role: UserRole;
  name: string;
  org: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

export interface UserSessionRecord {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  last_active_at: string;
}

export interface AuthAuditLogRecord {
  id: number;
  user_id: string | null;
  action: string;
  ip_address: string;
  timestamp: string;
  status: string;
}

export class UserRepository {
  constructor(private db: Database.Database) {}

  toSafeUser(record: UserRecord): SafeUser {
    return {
      id: record.id,
      username: record.username,
      role: record.role,
      name: record.name,
      org: record.org,
      created_at: record.created_at,
      updated_at: record.updated_at,
      is_active: Boolean(record.is_active),
    };
  }

  getUserByUsername(username: string): UserRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1
    `);
    const row = stmt.get(username.trim()) as UserRecord | undefined;
    return row || null;
  }

  getUserById(id: string): UserRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM users WHERE id = ? LIMIT 1
    `);
    const row = stmt.get(id) as UserRecord | undefined;
    return row || null;
  }

  getAllUsers(): SafeUser[] {
    const stmt = this.db.prepare(`
      SELECT * FROM users ORDER BY created_at ASC
    `);
    const rows = stmt.all() as UserRecord[];
    return rows.map((r) => this.toSafeUser(r));
  }

  createUser(data: {
    username: string;
    password_hash: string;
    salt: string;
    role: UserRole;
    name: string;
    org: string;
  }): SafeUser {
    const id = `usr_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO users (
        id, username, password_hash, salt, role, name, org, created_at, updated_at, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    stmt.run(
      id,
      data.username.trim(),
      data.password_hash,
      data.salt,
      data.role,
      data.name.trim(),
      data.org.trim(),
      now,
      now
    );

    const created = this.getUserById(id);
    if (!created) {
      throw new Error("Failed to retrieve created user record.");
    }
    return this.toSafeUser(created);
  }

  updatePassword(userId: string, passwordHash: string, salt: string): boolean {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE users
      SET password_hash = ?, salt = ?, updated_at = ?
      WHERE id = ?
    `);
    const result = stmt.run(passwordHash, salt, now, userId);
    return result.changes > 0;
  }

  setUserActive(userId: string, isActive: boolean): boolean {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE users
      SET is_active = ?, updated_at = ?
      WHERE id = ?
    `);
    const result = stmt.run(isActive ? 1 : 0, now, userId);
    return result.changes > 0;
  }

  countActiveAdmins(): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND is_active = 1
    `);
    const row = stmt.get() as { count: number };
    return row ? row.count : 0;
  }

  seedDemoUsers(): void {
    const demoAccounts: Array<{
      username: string;
      passwordRaw: string;
      role: UserRole;
      name: string;
      org: string;
    }> = [
      {
        username: "ravi123",
        passwordRaw: "RaviSecure!2026",
        role: "supplier",
        name: "Ravi Kumar",
        org: "Ravi Textiles",
      },
      {
        username: "lender01",
        passwordRaw: "LenderAlpha#2026",
        role: "lender",
        name: "Alex Mercer",
        org: "Alpha Bank",
      },
      {
        username: "admin2026",
        passwordRaw: "AdminMaster$2026",
        role: "admin",
        name: "Demo Director",
        org: "CapitalTwin",
      },
    ];

    for (const acc of demoAccounts) {
      const existing = this.getUserByUsername(acc.username);
      const { hash, salt } = hashPassword(acc.passwordRaw);
      if (!existing) {
        this.createUser({
          username: acc.username,
          password_hash: hash,
          salt,
          role: acc.role,
          name: acc.name,
          org: acc.org,
        });
      } else {
        // Ensure standard demo passwords are sync'd
        this.updatePassword(existing.id, hash, salt);
      }
    }
  }
}

export class SessionRepository {
  constructor(private db: Database.Database) {}

  createSession(userId: string, tokenHash: string, expiresAt: string): UserSessionRecord {
    const id = `ses_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO user_sessions (
        id, user_id, token_hash, expires_at, created_at, last_active_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, userId, tokenHash, expiresAt, now, now);

    return {
      id,
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_at: now,
      last_active_at: now,
    };
  }

  getSessionWithUser(tokenHash: string): { session: UserSessionRecord; user: UserRecord } | null {
    const stmt = this.db.prepare(`
      SELECT 
        s.id AS s_id, s.user_id AS s_user_id, s.token_hash AS s_token_hash,
        s.expires_at AS s_expires_at, s.created_at AS s_created_at, s.last_active_at AS s_last_active_at,
        u.id AS u_id, u.username AS u_username, u.password_hash AS u_password_hash, u.salt AS u_salt,
        u.role AS u_role, u.name AS u_name, u.org AS u_org, u.created_at AS u_created_at,
        u.updated_at AS u_updated_at, u.is_active AS u_is_active
      FROM user_sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token_hash = ?
      LIMIT 1
    `);

    const row = stmt.get(tokenHash) as any;
    if (!row) return null;

    const now = new Date().toISOString();
    if (row.s_expires_at < now) {
      // Expired session -> delete and return null
      this.deleteSession(tokenHash);
      return null;
    }

    return {
      session: {
        id: row.s_id,
        user_id: row.s_user_id,
        token_hash: row.s_token_hash,
        expires_at: row.s_expires_at,
        created_at: row.s_created_at,
        last_active_at: row.s_last_active_at,
      },
      user: {
        id: row.u_id,
        username: row.u_username,
        password_hash: row.u_password_hash,
        salt: row.u_salt,
        role: row.u_role,
        name: row.u_name,
        org: row.u_org,
        created_at: row.u_created_at,
        updated_at: row.u_updated_at,
        is_active: row.u_is_active,
      },
    };
  }

  updateSessionActivity(sessionId: string): void {
    const now = new Date().toISOString();
    // Extend rolling expiration to 24h from now
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const stmt = this.db.prepare(`
      UPDATE user_sessions
      SET last_active_at = ?, expires_at = ?
      WHERE id = ?
    `);
    stmt.run(now, expiresAt, sessionId);
  }

  deleteSession(tokenHash: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM user_sessions WHERE token_hash = ?
    `);
    const res = stmt.run(tokenHash);
    return res.changes > 0;
  }

  deleteExpiredSessions(): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      DELETE FROM user_sessions WHERE expires_at < ?
    `);
    stmt.run(now);
  }
}

export class AuditLogRepository {
  constructor(private db: Database.Database) {}

  logAuthEvent(
    userId: string | null,
    action: "LOGIN_SUCCESS" | "LOGIN_FAILURE" | "LOGOUT" | "USER_CREATED" | "USER_DEACTIVATED" | "PASSWORD_CHANGED",
    ipAddress: string,
    status: string
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO auth_audit_logs (user_id, action, ip_address, timestamp, status)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(userId, action, ipAddress || "127.0.0.1", new Date().toISOString(), status);
  }

  getRecentLogs(limit: number = 50): AuthAuditLogRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM auth_audit_logs ORDER BY id DESC LIMIT ?
    `);
    return stmt.all(limit) as AuthAuditLogRecord[];
  }
}
