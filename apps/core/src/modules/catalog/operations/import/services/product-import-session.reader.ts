import { Injectable } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import { NotFoundError } from '@app/shared';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  type PimSchema,
  productCategories,
  productImportSessions,
  productImportItems,
  productImportImages,
  productMasterVersions,
  productMasterVariants,
  productVariants,
} from '../../../schema/catalog.schema';
import { CategoryNode, comboKey } from '../dto/import.types';
import { DbTransaction } from '../../../catalog.types';
import { OptionReadLoader } from '../../../core/products/loaders/option-read.loader';
import type { ImportItemStatusCount, ImportImageStatusCount } from './product-import-progress.builder';
import type { SessionImageRow } from './product-import-image.resolver';

export type SessionRow = typeof productImportSessions.$inferSelect;
/**
 * getSession() 이 실제로 매핑에 쓰는 열만 담은 축소 타입이다. 더 이상 폴링 대상이
 * 아니지만(진행률은 getProgressCounts 가 집계로 본다) admin-web 은 사용자가 행 목록을
 * 펼치는 순간 이 응답을 통째로 가져온다 — 세션 하나가 수천 행일 수 있어 `payload`
 * (jsonb, 행당 2-3KB) 같은 안 쓰는 열을 실어 보내면 안 된다. getSession() 아래 select
 * 프로젝션과 항상 같이 좁힌다.
 */
export type ItemRow = Pick<
  typeof productImportItems.$inferSelect,
  'rowNumber' | 'productKey' | 'status' | 'masterId' | 'errorMessage' | 'publishStatus' | 'publishError'
>;

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
        .select({
          rowNumber: productImportItems.rowNumber,
          productKey: productImportItems.productKey,
          status: productImportItems.status,
          masterId: productImportItems.masterId,
          errorMessage: productImportItems.errorMessage,
          publishStatus: productImportItems.publishStatus,
          publishError: productImportItems.publishError,
        })
        .from(productImportItems)
        .where(eq(productImportItems.sessionId, sessionId))
        .orderBy(productImportItems.rowNumber);
      return { session, items };
    }, tx);
  }

  /**
   * 진행률 집계에 필요한 것만 읽는다 — 세션 1행 + 아이템 `(status, publish_status)`
   * 조합별 행 수. 조합은 3×4 로 상한이 12행이라 **세션 크기와 무관한 고정 비용**이다.
   *
   * getSession() 을 2초마다 부르던 폴링을 이쪽으로 옮기는 것이 v3 2단계다 — 1,000행
   * 세션이면 2초마다 1,000행이 오갔다(스펙 §2.9).
   */
  async getProgressCounts(
    sessionId: string,
    tx?: DbTransaction,
  ): Promise<{
    session: SessionRow;
    itemCounts: ImportItemStatusCount[];
    imageCounts: ImportImageStatusCount[];
  }> {
    return this.db.run(async (trx) => {
      const [session] = await trx
        .select()
        .from(productImportSessions)
        .where(eq(productImportSessions.id, sessionId))
        .limit(1);
      if (!session) throw new NotFoundError(`임포트 세션을 찾을 수 없습니다: ${sessionId}`);

      const grouped = await trx
        .select({
          status: productImportItems.status,
          publishStatus: productImportItems.publishStatus,
          value: count(),
        })
        .from(productImportItems)
        .where(eq(productImportItems.sessionId, sessionId))
        .groupBy(productImportItems.status, productImportItems.publishStatus);

      // 이미지 집계는 5행 이하다 — 세 번째 쿼리를 더해도 응답은 여전히 세션 크기와 무관하다.
      const groupedImages = await trx
        .select({ status: productImportImages.status, value: count() })
        .from(productImportImages)
        .where(eq(productImportImages.sessionId, sessionId))
        .groupBy(productImportImages.status);

      return {
        session,
        itemCounts: grouped.map((row) => ({
          status: row.status,
          publishStatus: row.publishStatus,
          // count() 는 드라이버에 따라 bigint 문자열로 올라온다 — getSessions 도 같은 이유로 Number() 를 씌운다.
          count: Number(row.value),
        })),
        imageCounts: groupedImages.map((row) => ({ status: row.status, count: Number(row.value) })),
      };
    }, tx);
  }

  /**
   * 세션의 이미지 행 전체. 커밋 슬라이스가 **슬라이스당 한 번** 부르고 인덱스를 만들어
   * 그 안의 모든 행이 공유한다. 행 수는 MAX_IMAGE_ROWS 로 유계다.
   */
  getSessionImages(sessionId: string, tx?: DbTransaction): Promise<SessionImageRow[]> {
    return this.db.run(
      (trx) =>
        trx
          .select({
            imageKey: productImportImages.imageKey,
            usage: productImportImages.usage,
            status: productImportImages.status,
            fileId: productImportImages.fileId,
            errorMessage: productImportImages.errorMessage,
          })
          .from(productImportImages)
          .where(eq(productImportImages.sessionId, sessionId)),
      tx,
    );
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

  /**
   * 주어진 코드 중 **현재 active 버전에 매달린** variant 가 이미 쓰고 있는 것들.
   *
   * 스코프가 active 인 이유: 같은 master 의 active variant 와 draft variant 는
   * 같은 물리 상품을 가리키므로 의도적으로 코드를 공유한다(catalog.schema.ts:477-482,
   * ADR-0004). 모든 product_variants 를 보면 남의 미게시 draft 에 오탐이 난다.
   * publishVersion._validateVariantCodeUniqueness 가 강제하는 규칙과 같은 스코프다.
   */
  async findActiveVariantCodes(codes: string[], tx?: DbTransaction): Promise<Set<string>> {
    if (codes.length === 0) return new Set();
    return this.db.run(async (trx) => {
      const found = new Set<string>();
      // postgres 파라미터 상한(65534)에 걸리지 않도록 나눠 조회한다.
      for (let i = 0; i < codes.length; i += 1000) {
        const chunk = codes.slice(i, i + 1000);
        const rows = await trx
          .selectDistinct({ variantCode: productVariants.variantCode })
          .from(productVariants)
          .innerJoin(productMasterVariants, eq(productMasterVariants.variantId, productVariants.id))
          .innerJoin(productMasterVersions, eq(productMasterVersions.id, productMasterVariants.versionId))
          .where(and(inArray(productVariants.variantCode, chunk), eq(productMasterVersions.status, 'active')));
        for (const row of rows) {
          if (row.variantCode !== null) found.add(row.variantCode);
        }
      }
      return found;
    }, tx);
  }
}
