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
import { ProductPurchaseConstraintsService } from '../../../core/products/services/product-purchase-constraints.service';
import { PricingService } from '../../../core/pricing/pricing.service';
import { ProductImportSessionReader } from './product-import-session.reader';
import { ProductImportPricingBuilder } from './product-import-pricing.builder';
import { ProductRecord } from '../dto/import.types';
import { CommitAcceptedDto, PublishAcceptedDto, CancelAcceptedDto } from '../dto/import-response.dto';

@Injectable()
export class ProductImportManager {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly reader: ProductImportSessionReader,
    private readonly productMastersService: ProductMastersService,
    private readonly pricingService: PricingService,
    private readonly pricingBuilder: ProductImportPricingBuilder,
    private readonly purchaseConstraintsService: ProductPurchaseConstraintsService,
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
          // failedCount 는 이후 failItem 이 생성 실패마다 +1 하므로 두 종류가 섞인다.
          // 접수 시점 값을 별도 컬럼에 얼려야 "생성 대상 행 수"를 복원할 수 있다.
          invalidCount,
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
      // 판매기간은 record 가 ISO **문자열**로 들고 있다 — payload jsonb 왕복에서 Date 가
      // 문자열이 되므로 처음부터 문자열로 두고 여기서만 되살린다. 문자열을 그대로 넘기면
      // drizzle 의 timestamp 매퍼가 값의 .toISOString() 을 불러 TypeError 로 그 행이 죽는다.
      // 값이 없으면 키 자체를 만들지 않는다 — undefined 를 넣으면 drizzle 이 무시하지만,
      // 의도(설정 안 함)와 표현(null 로 덮기)을 구분해 두는 편이 읽기 쉽다.
      ...(record.salesStartDate ? { salesStartDate: new Date(record.salesStartDate) } : {}),
      ...(record.salesEndDate ? { salesEndDate: new Date(record.salesEndDate) } : {}),
      optionDiff: record.options.length > 0 ? { add: record.options } : undefined,
    };
    await this.productMastersService.updateVersion(version.id, data, tx);

    // 구매제약은 버전 스칼라가 아니라 별도 테이블 + 매핑이다. 값이 없을 때 호출하지 않는
    // 이유는 upsertForVersion 의 isDeleteIntent 가 "requiresMembership=false + limit=null" 을
    // **삭제**로 해석하기 때문이다 — 신규 생성엔 지울 것이 없으니 왕복만 늘어난다.
    // publishVersion 은 같은 versionId 의 status 만 뒤집으므로(product-versions.service.ts:302)
    // 여기서 draft 에 심은 매핑이 게시 후에도 그대로 유효하다.
    if (record.purchaseConstraint) {
      await this.purchaseConstraintsService.upsertForDraft(version.masterId, version.id, record.purchaseConstraint, tx);
    }

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
      // 취소는 종단이다. commit 이 completed 인 채로 게시만 취소된 세션은 아래
      // commitStatus 검사를 통과하므로, 이 가드가 없으면 재게시가 열린다.
      if (session.cancelRequestedAt) {
        throw new ConflictError('취소된 세션입니다. 다시 등록하려면 워크북을 재업로드해 주세요.');
      }
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

  /**
   * 세션을 취소한다. "여기서 멈춘다"이지 "없던 일로"가 아니다 — 이미 생성된 draft 상품과
   * 이미 나간 이벤트는 되돌리지 않는다. 삭제는 되돌릴 수 없고, 부분 생성된 상품은 사람이
   * 보고 판단하는 것이 맞다(세션 상세에 masterId 가 전부 있어 수동 정리가 가능하다).
   *
   * **lease 는 건드리지 않는다.** 지우면 진행 중 워커의 renewLease CAS 가 "lease 를
   * 빼앗겼다" 경로로 빠져 취소를 인지하지 못한다. 워커는 renewLease 의 returning 으로
   * cancel_requested_at 을 직접 읽고 멈춘다(product-import-job.manager.ts).
   *
   * **끝난 레인은 덮지 않는다.** commit 이 completed 인 상태에서 게시를 취소했다면
   * 상품은 실제로 생성된 것이다 — canceled 로 덮으면 이력이 거짓이 된다.
   *
   * 취소는 **종단**이다. 재개 경로를 두지 않는 대신 굳은 세션(슬라이스 밖 예외가 반복돼
   * 매 틱 재시도되는 세션)을 푸는 수단을 겸한다 — 별도 reset-lease API 가 없는 이유다.
   */
  async cancelSession(sessionId: string): Promise<CancelAcceptedDto> {
    const active = (status: string): boolean => status === 'queued' || status === 'running';

    return this.db.run(async (trx) => {
      const [session] = await trx
        .select()
        .from(productImportSessions)
        .where(eq(productImportSessions.id, sessionId))
        .limit(1)
        // 행 잠금이 필요한 이유: 이 SELECT 와 아래 UPDATE 사이에 워커의 마감 경로가
        // 끼어들 수 있다. 마감의 WHERE 는 `cancel_requested_at IS NULL` 을 보는데
        // 그 시점엔 아직 취소가 안 쓰여 통과하고, 그 뒤 우리가 completed 를 canceled 로
        // 덮어 "끝난 레인은 덮지 않는다"가 깨진다. 잠그면 마감이 우리 커밋을 기다렸다가
        // 갱신된 행으로 WHERE 를 다시 평가해(READ COMMITTED) 0행이 된다.
        .for('update');
      if (!session) throw new NotFoundError(`임포트 세션을 찾을 수 없습니다: ${sessionId}`);
      if (session.cancelRequestedAt) throw new ConflictError('이미 취소된 세션입니다.');

      const cancelCommit = active(session.commitStatus);
      const cancelPublish = active(session.publishStatus);
      if (!cancelCommit && !cancelPublish) {
        throw new ConflictError('진행 중인 작업이 없어 취소할 수 없습니다.');
      }

      const canceledAt = new Date();
      await trx
        .update(productImportSessions)
        .set({
          cancelRequestedAt: canceledAt,
          ...(cancelCommit ? { commitStatus: 'canceled' as const } : {}),
          ...(cancelPublish ? { publishStatus: 'canceled' as const } : {}),
        })
        .where(eq(productImportSessions.id, sessionId));

      return {
        sessionId,
        // 방금 쓴 값을 그대로 되돌린다 — .returning() 을 붙이지 않는 이유는 왕복이
        // 하나 늘 뿐 새로 알게 되는 것이 없기 때문이다(같은 트랜잭션 안이다).
        commitStatus: cancelCommit ? 'canceled' : session.commitStatus,
        publishStatus: cancelPublish ? 'canceled' : session.publishStatus,
        canceledAt,
      };
    });
  }
}
