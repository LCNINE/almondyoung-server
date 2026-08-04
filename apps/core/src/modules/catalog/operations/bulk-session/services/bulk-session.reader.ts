import { Injectable } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import { NotFoundError } from '@app/shared';
import { and, count, desc, eq, isNotNull } from 'drizzle-orm';
import {
  type PimSchema,
  productBulkSessions,
  productBulkItems,
  productBulkImages,
} from '../../../schema/catalog.schema';
import { DbTransaction } from '../../../catalog.types';
import { flattenBundle, fieldLabel } from './bulk-session.fields';
import { isBulkItemPayload, isPrefillBundle } from './bulk-session.types';
import { BULK_IMAGE_CONTEXT_BY_USAGE, collectReferencedImageRefs, imageRefKey } from './bulk-session.images';
import { hasUndecided, toConflictDecisionMap, toConflictMap, type ConflictFilter } from './bulk-session.conflicts';
import {
  BulkSessionImageDto,
  BulkSessionImageListDto,
  BulkSessionItemDto,
  BulkSessionItemListDto,
  BulkSessionListDto,
  BulkSessionProgressDto,
  BulkSessionSummaryDto,
} from '../dto';

/** GET /product-bulk-sessions/:id/items 의 status 필터가 받는 값. productBulkItemStatusEnum 과 같다. */
export const BULK_ITEM_STATUS_VALUES = ['pending', 'invalid', 'drafted', 'excluded', 'failed'] as const;
export type BulkItemStatus = (typeof BULK_ITEM_STATUS_VALUES)[number];

/** 컨트롤러 입력 가드용. 배열 `.includes()` 는 리터럴 유니언과 `string` 인자가 만나 타입
 * 오류가 나므로(캐스팅 없이 통과하려면) 단순 비교 체인으로 판정한다. */
export function isBulkItemStatus(value: string): value is BulkItemStatus {
  return (
    value === 'pending' || value === 'invalid' || value === 'drafted' || value === 'excluded' || value === 'failed'
  );
}

/**
 * GET /product-bulk-sessions/:id/items 의 publishStatus 필터가 받는 값.
 * productBulkItemPublishStatusEnum 과 같다. `status` 와 다른 축이다 — 한 행이
 * status='drafted' 이면서 publishStatus='failed' 일 수 있다(getProgress 의 publishCounts
 * 주석과 같은 경고).
 *
 * fix-round: published 패널이 실패 행을 찾을 서버 필터가 없어서(admin-web 이 limit=1000
 * 을 보냈지만 이 라우트의 실제 상한은 parseLimit 이 미는 100 이라 100행 이후 실패는
 * 조용히 사라졌다) 이 필터를 추가한다. status 필터와 같은 관례를 그대로 따른다.
 */
export const BULK_PUBLISH_STATUS_VALUES = ['idle', 'pending', 'published', 'failed'] as const;
export type BulkPublishStatus = (typeof BULK_PUBLISH_STATUS_VALUES)[number];

/** isBulkItemStatus 와 같은 이유로 비교 체인을 쓴다 — `.includes()` 캐스팅을 피한다. */
export function isBulkPublishStatus(value: string): value is BulkPublishStatus {
  return value === 'idle' || value === 'pending' || value === 'published' || value === 'failed';
}

/** GET /product-bulk-sessions/:id/images 의 필터. 컨트롤러가 파싱해 넘긴다. */
export interface BulkImageFilter {
  status?: 'resolved' | 'awaiting_upload';
  onlyRequired: boolean;
  page: number;
  limit: number;
}

/**
 * getItems·setConflictDecision(매니저) 이 공유하는 행 프로젝션 — 화면 매핑에 필요한 것만
 * 담는다(`input` 은 2-3KB 짜리 jsonb 라 여기 넣지 않는다, product-import-session.reader.ts:26
 * 와 같은 이유). 매니저가 충돌 결정을 쓴 뒤 `.returning()` 에도 그대로 재사용해 두 곳의
 * 컬럼 목록이 벌어지지 않게 한다.
 */
export const bulkItemRowColumns = {
  id: productBulkItems.id,
  rowNumber: productBulkItems.rowNumber,
  rowKey: productBulkItems.rowKey,
  kind: productBulkItems.kind,
  status: productBulkItems.status,
  masterId: productBulkItems.masterId,
  errorMessage: productBulkItems.errorMessage,
  payload: productBulkItems.payload,
  conflict: productBulkItems.conflict,
  conflictDecision: productBulkItems.conflictDecision,
  baseSnapshot: productBulkItems.baseSnapshot,
  draftVersionId: productBulkItems.draftVersionId,
  // Task 8: 화면이 "무엇이 실패했는지" 를 보려면 발행 상태·실패 사유가 행 단위로 필요하다
  // — 지금까지는 getProgress 의 집계에만 있었다.
  publishStatus: productBulkItems.publishStatus,
  publishError: productBulkItems.publishError,
};

export type BulkItemRow = Pick<
  typeof productBulkItems.$inferSelect,
  | 'id'
  | 'rowNumber'
  | 'rowKey'
  | 'kind'
  | 'status'
  | 'masterId'
  | 'errorMessage'
  | 'payload'
  | 'conflict'
  | 'conflictDecision'
  | 'baseSnapshot'
  | 'draftVersionId'
  | 'publishStatus'
  | 'publishError'
>;

// bulk-session.conflicts.ts 로 옮겼다(승인 가드와 목록 필터가 같은 판정을 쓰게 하려고) —
// 여기서는 재export 만 한다. `bulk-session-job.manager.ts` 등 외부 소비자가 그대로
// `./bulk-session.reader` 에서 import 할 수 있어야 한다.
export { toConflictMap, toConflictDecisionMap };

@Injectable()
export class BulkSessionReader {
  constructor(@InjectDb() private readonly db: DbService<PimSchema>) {}

  async getSessions(userId: string, page = 1, limit = 20, tx?: DbTransaction): Promise<BulkSessionListDto> {
    return this.db.run(async (trx) => {
      const offset = (Math.max(page, 1) - 1) * Math.max(limit, 1);
      const owned = eq(productBulkSessions.uploadedBy, userId);

      const rows = await trx
        .select()
        .from(productBulkSessions)
        .where(owned)
        .orderBy(desc(productBulkSessions.createdAt))
        .limit(limit)
        .offset(offset);

      const [totalRow] = await trx.select({ value: count() }).from(productBulkSessions).where(owned);

      return { data: rows.map((row) => this.toSummaryDto(row)), total: Number(totalRow?.value ?? 0), page, limit };
    }, tx);
  }

  /**
   * 진행률은 **매번 집계한다** — 카운터 컬럼을 두면 워커가 중단됐을 때 드리프트한다
   * (v3 2단계 결론). 행 목록이 없어 응답 크기가 세션 크기와 무관하므로 폴링은 이쪽으로 한다.
   *
   * 소유권은 존재 검사와 같은 NotFoundError 로 합친다 — form-export.manager.ts:getStatus
   * 와 같은 이유(구분 자체가 UUIDv7 id 존재 여부를 캐는 오라클이 된다).
   */
  async getProgress(sessionId: string, userId: string, tx?: DbTransaction): Promise<BulkSessionProgressDto> {
    return this.db.run(async (trx) => {
      const session = await this.assertOwned(trx, sessionId, userId);

      const itemCounts = await trx
        .select({ status: productBulkItems.status, value: count() })
        .from(productBulkItems)
        .where(eq(productBulkItems.sessionId, sessionId))
        .groupBy(productBulkItems.status);

      const imageCounts = await trx
        .select({ status: productBulkImages.status, value: count() })
        .from(productBulkImages)
        .where(eq(productBulkImages.sessionId, sessionId))
        .groupBy(productBulkImages.status);

      // 발행 단계의 분모·분자다. 아이템 status 집계와 축이 다르다 — 한 행은 status='drafted'
      // 이면서 publish_status='failed' 일 수 있고, 화면은 그 둘을 함께 봐야 한다.
      const publishCounts = await trx
        .select({ status: productBulkItems.publishStatus, value: count() })
        .from(productBulkItems)
        .where(eq(productBulkItems.sessionId, sessionId))
        .groupBy(productBulkItems.publishStatus);

      const mappedItemCounts = itemCounts.map((row) => ({ status: row.status, count: Number(row.value) }));

      return {
        sessionId: session.id,
        phase: session.phase,
        phaseError: session.phaseError,
        // "상품" 시트 데이터 행 수다 — 합성 아이템(고아 참조 등)이 빠져 있어 아이템 수와
        // 어긋난다. 진행률 분모로 쓰지 않는다(Task 9 리뷰 인계) — 분모는 아래 itemTotal 이 대신한다.
        totalRows: session.totalRows,
        // Task 10 리뷰 #6: itemCounts 만 내려주면 화면이 결국 totalRows 를 분모로 집어 쓰게
        // 된다(합성 아이템이 빠져 있어 어긋남). 올바른 분모(집계 합)를 명시적으로 함께 준다.
        itemTotal: mappedItemCounts.reduce((acc, row) => acc + row.count, 0),
        itemCounts: mappedItemCounts,
        imageCounts: imageCounts.map((row) => ({ status: row.status, count: Number(row.value) })),
        publishCounts: publishCounts.map((row) => ({ status: row.status, count: Number(row.value) })),
        cancelRequestedAt: session.cancelRequestedAt,
      };
    }, tx);
  }

  /** 행 목록. status·conflict·publishStatus 필터·페이지. 변경분·충돌·라벨은 toItemDto 가 붙인다. */
  async getItems(
    sessionId: string,
    userId: string,
    status: BulkItemStatus | undefined,
    conflict: ConflictFilter | undefined,
    publishStatus: BulkPublishStatus | undefined,
    page = 1,
    limit = 20,
    tx?: DbTransaction,
  ): Promise<BulkSessionItemListDto> {
    return this.db.run(async (trx) => {
      await this.assertOwned(trx, sessionId, userId);

      const base = [eq(productBulkItems.sessionId, sessionId)];
      if (status) base.push(eq(productBulkItems.status, status));
      // publishStatus 는 status 와 마찬가지로 단순 컬럼 동치라 공유 SQL 조건에 얹는다 —
      // 아래 두 분기(SQL 페이징/메모리 필터) 모두가 이 base 를 쓰므로 conflict 필터와
      // 같이 걸어도 새지 않는다.
      if (publishStatus) base.push(eq(productBulkItems.publishStatus, publishStatus));
      // 'any'·'undecided' 둘 다 "충돌이 있는 행"이 출발점이다. undecided 는 그 위에
      // 메모리 필터를 한 번 더 건다.
      if (conflict) base.push(isNotNull(productBulkItems.conflict));
      const conditions = and(...base);

      const safePage = Math.max(page, 1);
      const safeLimit = Math.max(limit, 1);

      // 필터가 없으면 기존 경로 그대로 — SQL 페이징이다.
      if (!conflict) {
        const rows = await trx
          .select(bulkItemRowColumns)
          .from(productBulkItems)
          .where(conditions)
          .orderBy(productBulkItems.rowNumber)
          .limit(safeLimit)
          .offset((safePage - 1) * safeLimit);
        const [totalRow] = await trx.select({ value: count() }).from(productBulkItems).where(conditions);
        return {
          data: rows.map((row) => this.toItemDto(row)),
          total: Number(totalRow?.value ?? 0),
          page: safePage,
          limit: safeLimit,
        };
      }

      // 충돌 필터는 getImages 와 같은 방식이다 — 대상 행만 적재해 메모리에서 자른다.
      // `undecided` 가 jsonb 두 개의 키 차집합이라 SQL 술어로 못 내리고, 충돌은 정의상
      // (작업자가 바꾼 필드 ∩ 남이 바꾼 필드) 드물어 전량 적재가 감당된다.
      const all = await trx
        .select(bulkItemRowColumns)
        .from(productBulkItems)
        .where(conditions)
        .orderBy(productBulkItems.rowNumber);
      const filtered =
        conflict === 'undecided' ? all.filter((row) => hasUndecided(row.conflict, row.conflictDecision)) : all;
      const offset = (safePage - 1) * safeLimit;

      return {
        data: filtered.slice(offset, offset + safeLimit).map((row) => this.toItemDto(row)),
        total: filtered.length,
        page: safePage,
        limit: safeLimit,
      };
    }, tx);
  }

  /**
   * 이 세션의 이미지 참조 목록. 작업자가 "무슨 파일을 올려야 하는가"를 보는 자리다.
   *
   * **행을 전부 읽어 메모리에서 자른다.** 페이지네이션을 SQL 로 내리지 않는 이유는
   * `required` 판정과 요약 카운트(`requiredTotal`/`requiredResolved`)가 **필터와 무관하게
   * 세션 전체 기준**이어야 하기 때문이다 — 전량 게이트의 분모를 페이지가 바꾸면 화면이
   * "3/3 완료"라고 해놓고 다음으로 안 넘어간다. 이미지 행은 컬럼이 작고 파싱 슬라이스가
   * 세션당 1만 건에서 끊으므로(bulk-session-job.manager.ts) 전량 적재가 감당된다.
   */
  async getImages(
    sessionId: string,
    userId: string,
    filter: BulkImageFilter,
    tx?: DbTransaction,
  ): Promise<BulkSessionImageListDto> {
    return this.db.run(async (trx) => {
      await this.assertOwned(trx, sessionId, userId);

      const rows = await trx
        .select({
          imageKey: productBulkImages.imageKey,
          usage: productBulkImages.usage,
          sourceKind: productBulkImages.sourceKind,
          sourceValue: productBulkImages.sourceValue,
          status: productBulkImages.status,
          fileId: productBulkImages.fileId,
        })
        .from(productBulkImages)
        .where(eq(productBulkImages.sessionId, sessionId))
        .orderBy(productBulkImages.imageKey, productBulkImages.usage);

      // 이미지 행이 없으면 payload 전량 스캔을 하지 않는다(hasPendingImageWork 와 같은 절약).
      const referenced = rows.length > 0 ? await this.loadReferencedImageRefs(trx, sessionId) : new Set<string>();

      const all: BulkSessionImageDto[] = rows.map((row) => ({
        imageKey: row.imageKey,
        usage: row.usage,
        contextId: BULK_IMAGE_CONTEXT_BY_USAGE[row.usage],
        sourceKind: row.sourceKind,
        sourceValue: row.sourceValue,
        status: row.status,
        fileId: row.fileId,
        required: referenced.has(imageRefKey(row.usage, row.imageKey)),
      }));

      const requiredRows = all.filter((row) => row.required);
      const filtered = all.filter(
        (row) =>
          (!filter.onlyRequired || row.required) && (filter.status === undefined || row.status === filter.status),
      );
      const page = Math.max(filter.page, 1);
      const limit = Math.max(filter.limit, 1);
      const offset = (page - 1) * limit;

      return {
        data: filtered.slice(offset, offset + limit),
        total: filtered.length,
        page,
        limit,
        requiredTotal: requiredRows.length,
        requiredResolved: requiredRows.filter((row) => row.status === 'resolved').length,
      };
    }, tx);
  }

  /**
   * 행 하나를 화면용 DTO 로 편다. 순수 변환이라 DB 접근이 없다 — 매니저가 충돌 결정을 쓴
   * 뒤 `.returning()` 결과를 그대로 넣어 재조회 없이 응답을 만들 때도 이 메서드를 쓴다.
   */
  toItemDto(row: BulkItemRow): BulkSessionItemDto {
    const fields = isBulkItemPayload(row.payload) ? row.payload.fields : {};
    // update 행만 기준값이 있다 — create 행은 비교 대상이 없으므로 before 는 항상 빈 문자열이다.
    const baseFields =
      row.kind === 'update' && isPrefillBundle(row.baseSnapshot) ? flattenBundle(row.baseSnapshot) : {};

    const changes = Object.entries(fields)
      .map(([field, after]) => ({
        field,
        label: fieldLabel(field),
        before: row.kind === 'update' ? (baseFields[field] ?? '') : '',
        after,
      }))
      // create 행의 손대지 않은 선택 필드(빈 문자열)는 "바꾼 것"이 아니다.
      .filter((change) => change.before !== change.after);

    // productName: 검토 목록에 보여줄 표시용 이름. `changes` 는 before!==after 인 필드만
    // 남기므로(위 filter), 이름을 건드리지 않은 update 행에는 'product.name' 이 아예 없을 수
    // 있다 — 그 경우를 위해 changes 와 별도로 여기서 직접 뽑는다.
    // - create 행은 비교 대상(스냅샷)이 없다 — 업로드값만 쓴다.
    // - update 행은 업로드값을 우선한다 — 승인되면 그 이름이 될 것이기 때문이다(리네임 행은
    //   새 이름을 보여줘야 한다). 업로드값이 비어 있으면(이름을 안 건드린 흔한 경우) 스냅샷의
    //   현재 이름으로 떨어진다.
    // - 둘 다 없으면 빈 문자열이다 — 자리표시자를 지어내지 않는다(화면이 대체 표시를 정한다).
    const productName =
      row.kind === 'create'
        ? (fields['product.name'] ?? '')
        : fields['product.name'] || baseFields['product.name'] || '';

    const conflictMap = toConflictMap(row.conflict);
    const decisionMap = toConflictDecisionMap(row.conflictDecision);
    const conflicts = Object.entries(conflictMap).map(([field, entry]) => ({
      field,
      label: fieldLabel(field),
      base: entry.base,
      mine: entry.mine,
      current: entry.current,
      decision: decisionMap[field] ?? null,
    }));

    return {
      // Task 10 리뷰 #1: 목록에 id 가 없으면 PATCH .../items/:itemId/conflict-decision 을
      // 호출할 방법이 없다 — rowKey 로는 부를 수 없다(매니저는 productBulkItems.id 로 찾는다).
      id: row.id,
      rowNumber: row.rowNumber,
      rowKey: row.rowKey,
      kind: row.kind,
      productName,
      status: row.status,
      masterId: row.masterId,
      errorMessage: row.errorMessage,
      // Task 9: 생성된 draft 를 가리킨다 — 화면이 이 id 로 통상의 draft 편집 화면을 연다.
      draftVersionId: row.draftVersionId,
      // Task 8: 발행 레인의 상태·실패 사유. 아이템 status 와 축이 다르다 — 한 행이
      // status='drafted' 이면서 publishStatus='failed' 일 수 있다.
      publishStatus: row.publishStatus,
      publishError: row.publishError,
      changes,
      conflicts,
    };
  }

  /**
   * **적용될 행이 참조하는 이미지 중 아직 파일이 없는 것이 있는가.**
   *
   * 2단계 `BulkSessionManager` 의 private 메서드였던 것을 여기로 옮겼다 — 같은 술어를
   * 승인(`approve`)·요구 목록(`getImages`)·해석 후 게이트(`BulkImageManager.resolve`)
   * 셋이 쓴다. 복사본이 생기면 셋 중 하나만 필터를 고쳤을 때 승인은 `drafting` 으로
   * 보냈는데 해석 API 는 아직 남았다고 답하는(또는 그 반대) 어긋남이 생긴다.
   *
   * "세션에 `awaiting_upload` 행이 하나라도 있는가"로 물으면 안 된다. 이미지 행은
   * **파싱 시점**에 만들어지는데 그때는 접합 오류만 알고 필드 검증 결과는 모른다 —
   * 나중에 `invalid` 이 된 행이 참조하던 파일명 이미지가 그대로 `awaiting_upload` 로
   * 남는다. 그것까지 세면 30행이 invalid 인 세션에서 작업자가 **절대 쓰이지 않을 파일
   * 30개**를 올려야 다음으로 넘어간다. 미결정 충돌 게이트가 `status='pending'` 만 세는
   * 것과 같은 이유·같은 필터다.
   *
   * 미해결 이미지가 **하나도 없을 때는 items 를 읽지 않는다** — 흔한 경우(프리필
   * 이미지는 전부 fileId 라 `resolved` 다)에서 payload 전량 스캔을 피한다.
   */
  async hasPendingImageWork(trx: DbTransaction, sessionId: string): Promise<boolean> {
    const awaiting = await trx
      .select({ imageKey: productBulkImages.imageKey, usage: productBulkImages.usage })
      .from(productBulkImages)
      .where(and(eq(productBulkImages.sessionId, sessionId), eq(productBulkImages.status, 'awaiting_upload')));
    if (awaiting.length === 0) return false;

    const referenced = await this.loadReferencedImageRefs(trx, sessionId);
    return awaiting.some((image) => referenced.has(imageRefKey(image.usage, image.imageKey)));
  }

  /**
   * `status='pending'` 아이템이 참조하는 `(usage, imageKey)` 집합. 위 게이트와
   * `getImages` 의 `required` 플래그가 같은 근거를 쓰도록 여기 하나만 둔다.
   */
  async loadReferencedImageRefs(trx: DbTransaction, sessionId: string): Promise<Set<string>> {
    const rows = await trx
      .select({ payload: productBulkItems.payload })
      .from(productBulkItems)
      .where(and(eq(productBulkItems.sessionId, sessionId), eq(productBulkItems.status, 'pending')));
    return collectReferencedImageRefs(rows.map((row) => row.payload));
  }

  /**
   * "없음" 과 "있지만 남의 것" 을 같은 NotFoundError 로 합친다 — 구분해 주면 그 자체가
   * id 존재 여부를 캐는 오라클이 된다. form-export.manager.ts:getStatus 와 같은 관례.
   */
  private async assertOwned(
    trx: DbTransaction,
    sessionId: string,
    userId: string,
  ): Promise<typeof productBulkSessions.$inferSelect> {
    const [row] = await trx.select().from(productBulkSessions).where(eq(productBulkSessions.id, sessionId)).limit(1);
    if (!row || row.uploadedBy !== userId) {
      throw new NotFoundError(`일괄 등록 세션을 찾을 수 없습니다: ${sessionId}`);
    }
    return row;
  }

  private toSummaryDto(row: typeof productBulkSessions.$inferSelect): BulkSessionSummaryDto {
    return {
      id: row.id,
      name: row.name,
      fileName: row.fileName,
      phase: row.phase,
      phaseError: row.phaseError,
      totalRows: row.totalRows,
      cancelRequestedAt: row.cancelRequestedAt,
      createdAt: row.createdAt,
    };
  }
}
