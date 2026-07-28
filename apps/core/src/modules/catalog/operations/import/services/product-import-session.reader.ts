import { Injectable } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import { NotFoundError } from '@app/shared';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import {
  type PimSchema,
  productCategories,
  productImportSessions,
  productImportItems,
  productMasterVersions,
  productMasterVariants,
} from '../../../schema/catalog.schema';
import { CategoryNode, comboKey } from '../dto/import.types';
import { DbTransaction } from '../../../catalog.types';
import { OptionReadLoader } from '../../../core/products/loaders/option-read.loader';

export type SessionRow = typeof productImportSessions.$inferSelect;
export type ItemRow = typeof productImportItems.$inferSelect;

@Injectable()
export class ProductImportSessionReader {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly optionReadLoader: OptionReadLoader,
  ) {}

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
          .from(productCategories)
          .where(eq(productCategories.isActive, true)),
      tx,
    );
  }

  async getSessions(page = 1, limit = 20, tx?: DbTransaction) {
    const offset = (page - 1) * limit;
    return this.db.run(async (trx) => {
      const data = await trx
        .select()
        .from(productImportSessions)
        .orderBy(desc(productImportSessions.createdAt))
        .limit(limit)
        .offset(offset);
      const [totalRow] = await trx.select({ value: count() }).from(productImportSessions);
      return { data, total: Number(totalRow?.value ?? 0), page, limit };
    }, tx);
  }

  async getSession(sessionId: string, tx?: DbTransaction): Promise<{ session: SessionRow; items: ItemRow[] }> {
    return this.db.run(async (trx) => {
      const [session] = await trx
        .select()
        .from(productImportSessions)
        .where(eq(productImportSessions.id, sessionId))
        .limit(1);
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

  /**
   * 생성된 variant 의 옵션 조합 → variantId 맵. 키는 comboKey 와 같은 규칙으로 정규화한다.
   * 옵션 없는 상품(기본 variant 1개)은 빈 문자열 키로 담는다.
   */
  async getVariantComboMap(masterId: string, versionId: string, tx?: DbTransaction): Promise<Map<string, string>> {
    return this.db.run(async (trx) => {
      const rows = await trx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(and(eq(productMasterVariants.masterId, masterId), eq(productMasterVariants.versionId, versionId)));

      const map = new Map<string, string>();
      for (const row of rows) {
        const displays = await this.optionReadLoader.getVariantOptionValues(trx, row.variantId, versionId, 'ko-KR');
        const key = comboKey(displays.map((d) => ({ name: d.optionGroupName, value: d.displayName })));
        map.set(key, row.variantId);
      }
      return map;
    }, tx);
  }
}
