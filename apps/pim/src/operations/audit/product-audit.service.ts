import { Injectable } from '@nestjs/common';
import { eq, desc } from 'drizzle-orm';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { pimSchema, productAuditLog } from '../../schema';
import { NewProductAuditLog } from '../../types';

@Injectable()
export class ProductAuditService {
  constructor(
    @InjectTypedDb<typeof pimSchema>()
    private readonly dbService: DbService<typeof pimSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  /**
   * Get audit history for a specific product
   */
  async getProductAuditHistory(productId: string) {
    return this.db
      .select()
      .from(productAuditLog)
      .where(eq(productAuditLog.versionId, productId))
      .orderBy(desc(productAuditLog.timestamp));
  }

  /**
   * Get recent audit logs (all products)
   */
  async getRecentAuditLogs(limit = 100) {
    return this.db.select().from(productAuditLog).orderBy(desc(productAuditLog.timestamp)).limit(limit);
  }

  /**
   * Get audit logs by user
   */
  async getAuditLogsByUser(userId: string, limit = 100) {
    return this.db
      .select()
      .from(productAuditLog)
      .where(eq(productAuditLog.userId, userId))
      .orderBy(desc(productAuditLog.timestamp))
      .limit(limit);
  }

  /**
   * Get audit logs by action type
   */
  async getAuditLogsByAction(action: string, limit = 100) {
    return this.db
      .select()
      .from(productAuditLog)
      .where(eq(productAuditLog.action, action))
      .orderBy(desc(productAuditLog.timestamp))
      .limit(limit);
  }

  /**
   * Manually log an audit entry
   */
  async logAuditEntry(entry: NewProductAuditLog) {
    const [logged] = await this.db.insert(productAuditLog).values(entry).returning();
    return logged;
  }
}
