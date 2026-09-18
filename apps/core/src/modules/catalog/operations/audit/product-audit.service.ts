import { Injectable } from '@nestjs/common';
import { eq, desc } from 'drizzle-orm';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { pimSchema, productAuditLog } from '../../schema/catalog.schema';

const auditLogItem = {
  id: productAuditLog.id,
  productId: productAuditLog.masterId,
  versionId: productAuditLog.versionId,
  action: productAuditLog.action,
  userId: productAuditLog.userId,
  createdAt: productAuditLog.timestamp,
};

@Injectable()
export class ProductAuditService {
  constructor(
    @InjectTypedDb<typeof pimSchema>()
    private readonly dbService: DbService<typeof pimSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async getProductAuditHistory(masterId: string) {
    return this.db
      .select({ ...auditLogItem, changes: productAuditLog.changes })
      .from(productAuditLog)
      .where(eq(productAuditLog.masterId, masterId))
      .orderBy(desc(productAuditLog.timestamp));
  }

  async getRecentAuditLogs(limit = 100) {
    return this.db.select(auditLogItem).from(productAuditLog).orderBy(desc(productAuditLog.timestamp)).limit(limit);
  }

  async getAuditLogsByUser(userId: string, limit = 100) {
    return this.db
      .select(auditLogItem)
      .from(productAuditLog)
      .where(eq(productAuditLog.userId, userId))
      .orderBy(desc(productAuditLog.timestamp))
      .limit(limit);
  }

  async getAuditLogsByAction(action: string, limit = 100) {
    return this.db
      .select(auditLogItem)
      .from(productAuditLog)
      .where(eq(productAuditLog.action, action))
      .orderBy(desc(productAuditLog.timestamp))
      .limit(limit);
  }
}
