import { Injectable } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import { NotFoundError } from '@app/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  type PimSchema,
  productCategories,
  productImportSessions,
  productImportItems,
  productMasterVersions,
} from '../../../schema/catalog.schema';
import { CategoryNode } from '../dto/import.types';
import { DbTransaction } from '../../../catalog.types';

export type SessionRow = typeof productImportSessions.$inferSelect;
export type ItemRow = typeof productImportItems.$inferSelect;

@Injectable()
export class ProductImportSessionReader {
  constructor(@InjectDb() private readonly db: DbService<PimSchema>) {}

  loadCategoryTree(tx?: DbTransaction): Promise<CategoryNode[]> {
    return this.db.run(
      (trx) =>
        trx
          .select({
            id: productCategories.id,
            name: productCategories.name,
            slug: productCategories.slug,
            parentId: productCategories.parentId,
          })
          .from(productCategories),
      tx,
    );
  }

  async getSessions(page = 1, limit = 20, tx?: DbTransaction) {
    const offset = (page - 1) * limit;
    const data = await this.db.run(
      (trx) =>
        trx
          .select()
          .from(productImportSessions)
          .orderBy(desc(productImportSessions.createdAt))
          .limit(limit)
          .offset(offset),
      tx,
    );
    return { data, total: data.length, page, limit };
  }

  async getSession(sessionId: string, tx?: DbTransaction): Promise<{ session: SessionRow; items: ItemRow[] }> {
    return this.db.run(async (trx) => {
      const [session] = await trx
        .select()
        .from(productImportSessions)
        .where(eq(productImportSessions.id, sessionId))
        .limit(1)
        .offset(0);
      if (!session) throw new NotFoundError(`임포트 세션을 찾을 수 없습니다: ${sessionId}`);
      const items = await trx
        .select()
        .from(productImportItems)
        .where(eq(productImportItems.sessionId, sessionId))
        .orderBy(productImportItems.rowNumber);
      return { session, items };
    }, tx);
  }

  async getDraftVersionId(masterId: string, tx?: DbTransaction): Promise<string | null> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select({ id: productMasterVersions.id })
        .from(productMasterVersions)
        .where(
          and(
            eq(productMasterVersions.masterId, masterId),
            eq(productMasterVersions.status, 'draft'),
            isNull(productMasterVersions.deletedAt),
          ),
        )
        .orderBy(desc(productMasterVersions.version))
        .limit(1);
      return row?.id ?? null;
    }, tx);
  }
}
