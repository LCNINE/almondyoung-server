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
import {
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
