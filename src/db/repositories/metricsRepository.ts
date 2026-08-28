import type Database from "better-sqlite3";

export class MetricsRepository {
  constructor(private db: Database.Database) {}

  getMetric(key: string, defaultValue = 0): number {
    const stmt = this.db.prepare(`
      SELECT metric_value FROM system_metrics WHERE metric_key = ?
    `);
    const row = stmt.get(key) as { metric_value: number } | undefined;
    return row ? row.metric_value : defaultValue;
  }

  setMetric(key: string, value: number): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO system_metrics (metric_key, metric_value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(metric_key) DO UPDATE SET
        metric_value = excluded.metric_value,
        updated_at = excluded.updated_at
    `);
    stmt.run(key, value, now);
  }

  incrementMetric(key: string, amount = 1): number {
    const current = this.getMetric(key, 0);
    const nextVal = current + amount;
    this.setMetric(key, nextVal);
    return nextVal;
  }

  resetMetric(key: string): void {
    this.setMetric(key, 0);
  }
}
