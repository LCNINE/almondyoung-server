import { Injectable } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import { NotFoundError } from '@app/shared';
import { and, count, desc, eq } from 'drizzle-orm';
import {
  type PimSchema,
  productBulkSessions,
  productBulkItems,
  productBulkImages,
} from '../../../schema/catalog.schema';
import { DbTransaction } from '../../../catalog.types';
import { flattenBundle, fieldLabel } from './bulk-session.fields';
import { isBulkItemPayload, isPrefillBundle, type ConflictMap, type ConflictDecisionMap } from './bulk-session.types';
import { BULK_IMAGE_CONTEXT_BY_USAGE, collectReferencedImageRefs, imageRefKey } from './bulk-session.images';
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
>;

interface ConflictEntry {
  base: string;
  mine: string;
  current: string;
}

/**
 * conflict/conflictDecision 은 `.$type<>()` 없는 jsonb 라 drizzle 이 `unknown` 으로 돌려준다
 * — 런타임에 형태를 확인해야 한다. `bulk-session.types.ts` 의 `isBulkItemInput` 등과 같은
 * 관례: `as Partial<X>` 로 타입만 좁히고 실제 판정은 아래 typeof 로 한다.
 */
function isConflictEntry(value: unknown): value is ConflictEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<ConflictEntry>;
  return typeof v.base === 'string' && typeof v.mine === 'string' && typeof v.current === 'string';
}

/** jsonb 로 왕복한 conflict 열을 되살린다. 형태가 다르면(옛 코드가 쓴 값 등) 그 필드만 버린다. */
export function toConflictMap(value: unknown): ConflictMap {
  if (typeof value !== 'object' || value === null) return {};
  const out: ConflictMap = {};
  // `Object.entries(value)` 를 `value: object` 에 바로 쓰면 TS 가 색인 시그니처가 없는
  // 오버로드로 빠져 `[string, any][]` 가 된다(no-unsafe-assignment) — 위 isConflictEntry
  // 와 같은 근거로 한 번만 좁혀서 `Object.entries` 가 `[string, unknown][]` 오버로드를
  // 타게 한다.
  const record = value as Record<string, unknown>;
  for (const [field, entry] of Object.entries(record)) {
    if (isConflictEntry(entry)) out[field] = entry;
  }
  return out;
}

/** jsonb 로 왕복한 conflictDecision 열을 되살린다. `overwrite`/`skip` 이 아닌 값은 버린다. */
export function toConflictDecisionMap(value: unknown): ConflictDecisionMap {
  if (typeof value !== 'object' || value === null) return {};
  const out: ConflictDecisionMap = {};
  // toConflictMap 과 같은 이유의 캐스팅 — Object.entries 가 unknown 오버로드를 타게 한다.
  const record = value as Record<string, unknown>;
  for (const [field, decision] of Object.entries(record)) {
    if (decision === 'overwrite' || decision === 'skip') out[field] = decision;
  }
  return out;
}

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
        cancelRequestedAt: session.cancelRequestedAt,
      };
    }, tx);
  }

  /** 행 목록. status 필터·페이지. 변경분·충돌·라벨은 toItemDto 가 붙인다. */
  async getItems(
    sessionId: string,
    userId: string,
    status: BulkItemStatus | undefined,
    page = 1,
    limit = 20,
    tx?: DbTransaction,
  ): Promise<BulkSessionItemListDto> {
    return this.db.run(async (trx) => {
      await this.assertOwned(trx, sessionId, userId);

      const conditions = status
        ? and(eq(productBulkItems.sessionId, sessionId), eq(productBulkItems.status, status))
        : eq(productBulkItems.sessionId, sessionId);

      const offset = (Math.max(page, 1) - 1) * Math.max(limit, 1);
      const rows = await trx
        .select(bulkItemRowColumns)
        .from(productBulkItems)
        .where(conditions)
        .orderBy(productBulkItems.rowNumber)
        .limit(limit)
        .offset(offset);

      const [totalRow] = await trx.select({ value: count() }).from(productBulkItems).where(conditions);

      return { data: rows.map((row) => this.toItemDto(row)), total: Number(totalRow?.value ?? 0), page, limit };
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
      status: row.status,
      masterId: row.masterId,
      errorMessage: row.errorMessage,
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
