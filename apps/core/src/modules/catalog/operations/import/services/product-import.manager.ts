import { Injectable } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import { BadRequestError } from '@app/shared';
import { eq } from 'drizzle-orm';
import {
  type PimSchema,
  productImportSessions,
  productImportItems,
  productVariants,
} from '../../../schema/catalog.schema';
import { UpdateProductMasterVersion, DbTransaction } from '../../../catalog.types';
import { ProductMastersService } from '../../../core/products/services/product-masters.service';
import { ProductVersionsService } from '../../../core/products/services/product-versions.service';
import { PricingService } from '../../../core/pricing/pricing.service';
import { ProductImportSessionReader, ItemRow } from './product-import-session.reader';
import { ProductImportPricingBuilder } from './product-import-pricing.builder';
import { ProductRecord, NormalizedVariantOverride } from '../dto/import.types';

export interface CommitItem {
  rowNumber: number;
  productKey: string;
  status: 'created' | 'failed';
  masterId?: string;
  errorMessage?: string;
}

export interface CommitResult {
  sessionId: string;
  createdCount: number;
  failedCount: number;
  items: CommitItem[];
}

@Injectable()
export class ProductImportManager {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly reader: ProductImportSessionReader,
    private readonly productMastersService: ProductMastersService,
    private readonly productVersionsService: ProductVersionsService,
    private readonly pricingService: PricingService,
    private readonly pricingBuilder: ProductImportPricingBuilder,
  ) {}

  async commit(input: { fileName: string; userId: string; records: ProductRecord[] }): Promise<CommitResult> {
    const { fileName, userId, records } = input;

    const [session] = await this.db.run((trx) =>
      trx
        .insert(productImportSessions)
        .values({ fileName, uploadedBy: userId, totalRows: records.length, status: 'completed' })
        .returning(),
    );
    const sessionId = session.id;

    const items: CommitItem[] = [];
    let createdCount = 0;
    let failedCount = 0;
    // 이 commit() 호출(=한 파일) 안에서 이미 어느 행이 어떤 variantCode 를 요청했는지 추적한다.
    // record 단위 검증만으로는 서로 다른 상품이 같은 코드를 요청하는 경우를 못 잡는다 —
    // publishVersion 의 _validateVariantCodeUniqueness 는 한 버전(=한 상품)의 variant 끼리만
    // 검증하므로 상품을 건너 뛰는 중복은 게시 시점에도 걸러지지 않는다.
    const seenVariantCodes = new Map<string, number>();

    for (const record of records) {
      if (record.errors.length > 0) {
        const errorMessage = record.errors.map((e) => `[${e.sheet} ${e.rowNumber}행] ${e.message}`).join('; ');
        await this.recordItem(sessionId, record, 'failed', null, errorMessage);
        items.push({ rowNumber: record.rowNumber, productKey: record.productKey, status: 'failed', errorMessage });
        failedCount += 1;
        continue;
      }

      try {
        // record 의 트랜잭션이 이후 단계(가격 규칙 등)에서 실패해 롤백되면 이 행이 요청한
        // variantCode 도 "실제로 반영되지 않은" 것이므로, 성공이 확정된 뒤에만 seenVariantCodes 에 반영한다
        // (그렇지 않으면 실패한 행 때문에 뒤 행이 잘못된 "중복" 으로 튕겨나갈 수 있다).
        let claimedVariantCodes: Array<{ code: string; rowNumber: number }> = [];
        const masterId = await this.db.run(async (trx) => {
          const version = await this.productMastersService.createMaster(userId, trx);
          const data: UpdateProductMasterVersion = {
            ...record.version,
            categoryIds: record.categoryIds,
            primaryCategoryId: record.primaryCategoryId,
            optionDiff: record.options.length > 0 ? { add: record.options } : undefined,
          };
          await this.productMastersService.updateVersion(version.id, data, trx);

          // variant 생성 이후여야 조합 → variantId 해석이 가능하다.
          const comboMap = await this.reader.getVariantComboMap(version.masterId, version.id, trx);
          claimedVariantCodes = await this.applyVariantCodes(record, comboMap, seenVariantCodes, trx);
          await this.pricingService.replaceVersionRules(version.id, this.pricingBuilder.build(record, comboMap), trx);

          await trx.insert(productImportItems).values({
            sessionId,
            rowNumber: record.rowNumber,
            productKey: record.productKey,
            status: 'created',
            masterId: version.masterId,
          });
          return version.masterId;
        });
        for (const { code, rowNumber } of claimedVariantCodes) seenVariantCodes.set(code, rowNumber);
        items.push({ rowNumber: record.rowNumber, productKey: record.productKey, status: 'created', masterId });
        createdCount += 1;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
        await this.recordItem(sessionId, record, 'failed', null, errorMessage);
        items.push({ rowNumber: record.rowNumber, productKey: record.productKey, status: 'failed', errorMessage });
        failedCount += 1;
      }
    }

    await this.db.run((trx) =>
      trx
        .update(productImportSessions)
        .set({ createdCount, failedCount, committedAt: new Date() })
        .where(eq(productImportSessions.id, sessionId)),
    );

    return { sessionId, createdCount, failedCount, items };
  }

  private recordItem(
    sessionId: string,
    record: ProductRecord,
    status: 'created' | 'failed',
    masterId: string | null,
    errorMessage: string | null,
  ) {
    return this.db.run((trx) =>
      trx.insert(productImportItems).values({
        sessionId,
        rowNumber: record.rowNumber,
        productKey: record.productKey,
        status,
        masterId: masterId ?? undefined,
        errorMessage: errorMessage ?? undefined,
      }),
    );
  }

  /**
   * 조합별 variantCode 를 write 한다. variantCode 는 채널·WMS 매칭의 다리라
   * 여기서 심어두면 대량 등록 후 별도 SKU 매칭 작업의 규모가 줄어든다.
   *
   * publishVersion 이 active 버전 내 중복을 검증하지만(_validateVariantCodeUniqueness),
   * 그 검증은 "한 버전(=한 상품)의 variant 끼리만" 비교한다 — 서로 다른 상품이 같은
   * variantCode 를 요청하는 경우는 게시 시점에도 걸러지지 않는다. 파일 안 중복은(같은 상품 안이든,
   * 파일 안의 다른 상품과의 충돌이든) 여기서 먼저 막는다 — seenVariantCodes 는 commit() 이
   * 파일 전체에 걸쳐 공유하는 맵이다.
   *
   * 실제로 seenVariantCodes 에 반영(commit)하는 것은 호출자(commit())의 몫이다 — 이 record 의
   * 트랜잭션이 이후 단계에서 실패해 롤백되면 여기서 쓴 값도 무효가 되므로, 이 메서드는 "이번
   * 호출에서 이 record 가 요청한 코드" 목록만 반환하고 전역 상태는 건드리지 않는다.
   */
  private async applyVariantCodes(
    record: ProductRecord,
    comboMap: Map<string, string>,
    seenVariantCodes: Map<string, number>,
    tx: DbTransaction,
  ): Promise<Array<{ code: string; rowNumber: number }>> {
    // 타입 가드로 좁혀두면 이후 override.variantCode 가 string 으로 추론되어 `as` 캐스팅이 필요 없다.
    const withCode = record.variantOverrides.filter((o): o is NormalizedVariantOverride & { variantCode: string } =>
      Boolean(o.variantCode),
    );
    if (withCode.length === 0) return [];

    const claimedInRecord = new Map<string, number>();
    for (const override of withCode) {
      const code = override.variantCode;
      const conflictRow = claimedInRecord.get(code) ?? seenVariantCodes.get(code);
      if (conflictRow !== undefined) {
        throw new BadRequestError(
          `variantCode 가 파일 안에서 중복됩니다: ${code} (${conflictRow}행, ${override.rowNumber}행)`,
        );
      }
      claimedInRecord.set(code, override.rowNumber);
    }

    for (const override of withCode) {
      const variantId = comboMap.get(override.comboKey);
      if (!variantId) {
        throw new BadRequestError(
          `조합에 해당하는 variant 를 찾을 수 없습니다: ${override.comboKey} (${record.productKey})`,
        );
      }
      await tx
        .update(productVariants)
        .set({ variantCode: override.variantCode, updatedAt: new Date() })
        .where(eq(productVariants.id, variantId));
    }

    return Array.from(claimedInRecord, ([code, rowNumber]) => ({ code, rowNumber }));
  }

  async publishSession(
    sessionId: string,
  ): Promise<{ published: number; failed: { masterId: string; reason: string }[] }> {
    const { items } = await this.reader.getSession(sessionId);
    const created = items.filter(
      (i): i is ItemRow & { masterId: string } => i.status === 'created' && i.masterId !== null,
    );

    let published = 0;
    const failed: { masterId: string; reason: string }[] = [];

    for (const item of created) {
      const { masterId } = item;
      try {
        const draftVersionId = await this.reader.getDraftVersionId(masterId);
        if (!draftVersionId) continue; // 이미 publish 됨(active) → skip (멱등)
        await this.db.run((trx) => this.productVersionsService.publishVersion(draftVersionId, trx));
        published += 1;
      } catch (error) {
        failed.push({ masterId, reason: error instanceof Error ? error.message : '알 수 없는 오류' });
      }
    }

    return { published, failed };
  }
}
