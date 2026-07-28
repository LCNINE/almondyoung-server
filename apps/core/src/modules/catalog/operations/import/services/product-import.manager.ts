import { Injectable } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { and, count, eq } from 'drizzle-orm';
import {
  type PimSchema,
  productImportSessions,
  productImportItems,
  productVariants,
} from '../../../schema/catalog.schema';
import { DbTransaction, UpdateProductMasterVersion } from '../../../catalog.types';
import { ProductMastersService } from '../../../core/products/services/product-masters.service';
import { PricingService } from '../../../core/pricing/pricing.service';
import { ProductImportSessionReader } from './product-import-session.reader';
import { ProductImportPricingBuilder } from './product-import-pricing.builder';
import { ProductRecord } from '../dto/import.types';
import { CommitAcceptedDto, PublishAcceptedDto } from '../dto/import-response.dto';

@Injectable()
export class ProductImportManager {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly reader: ProductImportSessionReader,
    private readonly productMastersService: ProductMastersService,
    private readonly pricingService: PricingService,
    private readonly pricingBuilder: ProductImportPricingBuilder,
  ) {}

  /**
   * 접수만 한다. 검증은 이미 끝났고(파이프라인), 여기서는 세션과 행을 적을 뿐이다.
   * 상품 생성은 ProductImportJobWorker 가 슬라이스 단위로 이어받는다.
   */
  async acceptCommit(input: {
    fileName: string;
    userId: string;
    records: ProductRecord[];
  }): Promise<CommitAcceptedDto> {
    const { fileName, userId, records } = input;
    const invalidCount = records.filter((r) => r.errors.length > 0).length;

    return this.db.run(async (trx) => {
      const [session] = await trx
        .insert(productImportSessions)
        .values({
          fileName,
          uploadedBy: userId,
          totalRows: records.length,
          failedCount: invalidCount,
          // status 는 아카이브 플래그다. 잡 상태는 commitStatus/publishStatus 가 든다.
          status: 'completed',
          commitStatus: 'queued',
          publishStatus: 'idle',
        })
        .returning();

      const rows = records.map((record) =>
        record.errors.length > 0
          ? {
              sessionId: session.id,
              rowNumber: record.rowNumber,
              productKey: record.productKey,
              status: 'failed' as const,
              // 생성이 없으니 게시 대상도 아니다 — pending 으로 두면 영영 안 끝난 것처럼 보인다.
              publishStatus: 'skipped' as const,
              errorMessage: record.errors.map((e) => `[${e.sheet} ${e.rowNumber}행] ${e.message}`).join('; '),
            }
          : {
              sessionId: session.id,
              rowNumber: record.rowNumber,
              productKey: record.productKey,
              status: 'pending' as const,
              payload: record,
            },
      );

      // payload 가 행마다 붙으므로 한 statement 에 다 넣지 않는다(파라미터 상한·문 크기).
      for (let i = 0; i < rows.length; i += 200) {
        await trx.insert(productImportItems).values(rows.slice(i, i + 200));
      }

      return {
        sessionId: session.id,
        status: 'queued' as const,
        totalRows: records.length,
        queuedCount: records.length - invalidCount,
        invalidCount,
      };
    });
  }

  /**
   * 레코드 하나로 draft 상품을 만든다. 호출자가 연 트랜잭션 안에서 돈다 —
   * 이 안에서 터지면 그 행의 변경 전부가 롤백된다.
   */
  async createFromRecord(record: ProductRecord, userId: string, tx: DbTransaction): Promise<string> {
    const version = await this.productMastersService.createMaster(userId, tx);
    const data: UpdateProductMasterVersion = {
      ...record.version,
      categoryIds: record.categoryIds,
      primaryCategoryId: record.primaryCategoryId,
      optionDiff: record.options.length > 0 ? { add: record.options } : undefined,
    };
    await this.productMastersService.updateVersion(version.id, data, tx);

    // variant override 가 없으면 조합 → variantId 맵이 필요 없다. getVariantComboMap 은
    // variant 마다 4-join 조회를 돌리므로 Variants 시트를 안 쓴 파일(=v1 호환 경로)에서
    // 그 비용을 물지 않는다. 빈 맵은 applyVariantCodes 와 pricingBuilder 둘 다 안전하다 —
    // 양쪽 모두 variantOverrides 루프 안에서만 맵을 읽는다.
    const comboMap =
      record.variantOverrides.length > 0
        ? await this.reader.getVariantComboMap(version.masterId, version.id, tx)
        : new Map<string, string>();

    await this.applyVariantCodes(record, comboMap, tx);
    await this.pricingService.replaceVersionRules(version.id, this.pricingBuilder.build(record, comboMap), tx);

    return version.masterId;
  }

  /**
   * 조합별 variantCode 를 write 한다. variantCode 는 채널·WMS 매칭의 다리라
   * 여기서 심어두면 대량 등록 후 별도 SKU 매칭 작업의 규모가 줄어든다.
   *
   * 중복 판정은 여기 없다 — ProductImportVariantCodeChecker 가 파이프라인 단계에서
   * 파일 전체 + DB 전역을 본다. 레코드 하나만 보는 이 자리에서는 알 수 없는 것이고,
   * 커밋이 슬라이스로 쪼개지면 인메모리 누적도 성립하지 않는다.
   */
  private async applyVariantCodes(
    record: ProductRecord,
    comboMap: Map<string, string>,
    tx: DbTransaction,
  ): Promise<void> {
    for (const override of record.variantOverrides) {
      if (!override.variantCode) continue;
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
  }

  /**
   * 게시를 접수한다. 실제 게시는 ProductImportJobWorker 가 슬라이스로 돈다.
   * 실패했던 행만 pending 으로 되돌리므로, 다시 누르면 재시도가 된다 —
   * 이미 published 인 행은 건드리지 않아 이벤트가 두 번 나가지 않는다.
   */
  async queuePublish(sessionId: string): Promise<PublishAcceptedDto> {
    return this.db.run(async (trx) => {
      const [session] = await trx
        .select()
        .from(productImportSessions)
        .where(eq(productImportSessions.id, sessionId))
        .limit(1);
      if (!session) throw new NotFoundError(`임포트 세션을 찾을 수 없습니다: ${sessionId}`);
      if (session.commitStatus !== 'completed') {
        throw new ConflictError('상품 생성이 아직 끝나지 않았습니다. 완료 후 게시할 수 있습니다.');
      }
      if (session.publishStatus === 'queued' || session.publishStatus === 'running') {
        throw new ConflictError('이미 게시가 진행 중입니다.');
      }

      await trx
        .update(productImportItems)
        .set({ publishStatus: 'pending', publishError: null })
        .where(and(eq(productImportItems.sessionId, sessionId), eq(productImportItems.publishStatus, 'failed')));

      const [targetRow] = await trx
        .select({ value: count() })
        .from(productImportItems)
        .where(
          and(
            eq(productImportItems.sessionId, sessionId),
            eq(productImportItems.status, 'created'),
            eq(productImportItems.publishStatus, 'pending'),
          ),
        );

      await trx
        .update(productImportSessions)
        .set({ publishStatus: 'queued', publishError: null, publishFailedCount: 0, leaseUntil: null })
        .where(eq(productImportSessions.id, sessionId));

      return { sessionId, status: 'queued' as const, targetCount: Number(targetRow?.value ?? 0) };
    });
  }
}
