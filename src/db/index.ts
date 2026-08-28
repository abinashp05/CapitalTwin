import { getDatabase, closeDatabase } from "./database";
import { initSchema } from "./schema";
import { AssetRepository } from "./repositories/assetRepository";
import { RiskRepository } from "./repositories/riskRepository";
import { FinancingRepository } from "./repositories/financingRepository";
import { AuctionRepository } from "./repositories/auctionRepository";
import { LedgerRepository } from "./repositories/ledgerRepository";
import { EventRepository } from "./repositories/eventRepository";
import { MetricsRepository } from "./repositories/metricsRepository";
import {
  UserRepository,
  SessionRepository,
  AuditLogRepository,
  SafeUser,
  UserRole,
  UserRecord,
  UserSessionRecord,
  AuthAuditLogRecord,
} from "./repositories/userRepository";

let assetRepo: AssetRepository;
let riskRepo: RiskRepository;
let financingRepo: FinancingRepository;
let auctionRepo: AuctionRepository;
let ledgerRepo: LedgerRepository;
let eventRepo: EventRepository;
let metricsRepo: MetricsRepository;
let userRepo: UserRepository;
let sessionRepo: SessionRepository;
let auditRepo: AuditLogRepository;

export function initDb(customPath?: string) {
  const db = getDatabase(customPath);
  initSchema(db);

  assetRepo = new AssetRepository(db);
  riskRepo = new RiskRepository(db);
  financingRepo = new FinancingRepository(db);
  auctionRepo = new AuctionRepository(db);
  ledgerRepo = new LedgerRepository(db);
  eventRepo = new EventRepository(db);
  metricsRepo = new MetricsRepository(db);
  userRepo = new UserRepository(db);
  sessionRepo = new SessionRepository(db);
  auditRepo = new AuditLogRepository(db);

  // Seed default demonstration users if not present
  userRepo.seedDemoUsers();

  return {
    db,
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
  };
}

export {
  getDatabase,
  closeDatabase,
  initSchema,
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
  AssetRepository,
  RiskRepository,
  FinancingRepository,
  AuctionRepository,
  LedgerRepository,
  EventRepository,
  MetricsRepository,
  UserRepository,
  SessionRepository,
  AuditLogRepository,
};

export type {
  SafeUser,
  UserRole,
  UserRecord,
  UserSessionRecord,
  AuthAuditLogRecord,
};

