import { Injectable, Logger } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { isUUID } from 'class-validator';
import { and, eq, isNotNull, isNull, notInArray } from 'drizzle-orm';
import {
  type PimSchema,
  productBulkSessions,
  productBulkItems,
  productFormExportItems,
  productFormExports,
} from '../../../schema/catalog.schema';
import { DbTransaction } from '../../../catalog.types';
import { FormExportFileClient } from './form-export-file.client';
import { parseUploadWorkbook } from './bulk-upload.parser';
import { BulkSessionReader, bulkItemRowColumns, toConflictDecisionMap, toConflictMap } from './bulk-session.reader';
import { type ConflictDecisionMap } from './bulk-session.types';
import { BulkSessionAcceptedDto, BulkSessionItemDto, BulkSessionProgressDto } from '../dto';

export interface BulkSessionAcceptInput {
  buffer: Buffer;
  fileName: string;
  name?: string;
  userId: string;
}

/** productBulkSessions.name 은 varchar(200) — 파일명 폴백이 그 상한을 넘으면 INSERT 가 죽는다. */
const SESSION_NAME_MAX_LENGTH = 200;

const EXPORT_UNUSABLE_MESSAGE = '이 양식은 더 이상 사용할 수 없습니다. 양식을 다시 받아 작업해 주세요.';

/**
 * drizzle-orm 0.44.x 는 driver 에러를 `DrizzleQueryError` 로 감싼다 — 실제 postgres.js
 * `PostgresError(code, constraint_name, ...)` 는 최상위가 아니라 `.cause` 에 있다
 * (`apps/core/src/modules/fulfillment/waybill/waybill.manager.ts` 의 `isUniqueViolation`
 * 과 동일 이슈·동일 관례). 최대 5단계까지 `.cause` 를 따라 내려가며
 * foreign_key_violation(23503)을 찾는다.
 *
 * 실제 형태는 이 레포의 scratch DB(`bulk_stage2_scratch`)에 대고 직접 확인했다 — 존재하지
 * 않는 `export_id` 로 `productBulkSessions` 를 INSERT 하면 top-level `DrizzleQueryError`
 * (`.code === undefined`)의 `.cause` 가 `PostgresError` 이고, 거기서
 * `.code === '23503'`, `.constraint_name === 'product_bulk_sessions_export_id_product_form_exports_id_fk'`
 * 다(task-8-report.md 픽스 리포트에 실행 로그를 남겼다). 이 INSERT 의 FK 는 export_id
 * 하나뿐이라 제약 이름까지 확인할 필요는 없다.
 */
function isForeignKeyViolation(e: unknown): boolean {
  let current: unknown = e;
  for (let depth = 0; current != null && depth < 5; depth += 1) {
    const row = current as { code?: string; cause?: unknown };
    if (row.code === '23503') return true;
    current = row.cause;
  }
  return false;
}

@Injectable()
export class BulkSessionManager {
  private readonly logger = new Logger(BulkSessionManager.name);

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly fileClient: FormExportFileClient,
    private readonly reader: BulkSessionReader,
  ) {}

  /**
   * 업로드를 접수한다. 파싱·검증은 워커가 이어받는다 — 1,000행 × 7시트를 동기로 처리하면
   * ALB 60초를 넘긴다.
   *
   * **다만 파일 수준 게이트는 여기서 동기로 친다.** 파싱을 두 번 하는 비용을 감수하는 이유:
   * (1) "exportId 는 있는데 해석 안 됨"은 세션을 만들기 **전에** 막아야 하는 사고고,
   * (2) 깨진 파일·필수 열 누락에 즉시 400 을 주는 편이, 세션을 만들어놓고 한 틱 뒤에
   *     failed 로 뒤집는 것보다 작업자에게 훨씬 낫다.
   * 관리자 전용 라우트라 QPS 가 낮아 감당된다.
   *
   * **게이트·업로드·INSERT 를 하나의 트랜잭션으로 묶지 않는다.** 예전에 그렇게 시도했으나
   * 틀렸다 — 이 레포의 기본 격리 수준은 READ COMMITTED(`libs/db/src/db.service.ts` 가
   * 격리 수준 옵션 없이 `transaction(fn)` 을 부른다)라, `assertExportUsable` 의 평범한
   * SELECT(FOR SHARE/UPDATE 없음)는 export 행에 아무 잠금도 안 걸고, `ON DELETE SET NULL`
   * 은 부모가 지워질 때 **기존** 참조 행을 어떻게 할지만 정할 뿐 **새** INSERT 의 FK 검사를
   * 느슨하게 만들지 않는다 — 즉 하나로 묶어도 경쟁의 창은 그대로였고, 대신 살아있는 Postgres
   * 트랜잭션이 `fetch` 왕복(최대 10MB) 동안 열린 채 유지되는 손해만 늘었다.
   *
   * 대신 세 단계로 나눈다: (1) 게이트는 자기 짧은 트랜잭션에서 돈다(업로드 전) — `tx` 를
   * 그대로 전달해 상위 전파도 지원한다. (2) `fileClient.upload` 는 **어떤 DB 트랜잭션도
   * 걸치지 않고** 돈다. (3) INSERT 는 자기 짧은 트랜잭션에서 돌고, 실패가
   * foreign_key_violation(23503)이면 — 게이트 체크와 INSERT 사이에 정리 크론이 export 를
   * 지웠다는 뜻이고, 그건 정확히 "이 양식은 더 이상 쓸 수 없다"이므로 — 이미 올라간 파일을
   * best-effort 로 지우고 같은 `EXPORT_UNUSABLE_MESSAGE` 로 `BadRequestError` 를 던진다
   * (500 대신 작업자가 행동할 수 있는 400). 창은 밀리초고 트리거는 일일 크론이라 이 경로가
   * 실제로 타는 일은 극히 드물 것으로 예상하지만, 잠금이 아니라 "실패를 잡아 번역"하는
   * 방식이라 경쟁 자체가 이론적으로도 남지 않는다.
   */
  async accept(input: BulkSessionAcceptInput, tx?: DbTransaction): Promise<BulkSessionAcceptedDto> {
    const parsed = await parseUploadWorkbook(input.buffer); // 파일 오류는 BadRequestError 로 던진다
    const exportId = parsed.exportId;

    if (exportId) {
      await this.db.run((trx) => this.assertExportUsable(exportId, trx), tx);
    }

    const { fileId } = await this.fileClient.upload({
      buffer: input.buffer,
      fileName: input.fileName,
      userId: input.userId,
    });

    try {
      return await this.db.run(async (trx) => {
        const [row] = await trx
          .insert(productBulkSessions)
          .values({
            // varchar(200) 상한을 넘는 원본 파일명(OS 상 최대 255자)이 폴백으로 들어오면
            // INSERT 가 22001 로 죽는다 — 그 시점엔 이미 위에서 업로드가 끝나 S3 에 고아
            // 파일이 남는다(file-service 에 고아 정리 잡이 없다). 자르는 편이 싸다.
            name: ((input.name ?? '').trim() || input.fileName).slice(0, SESSION_NAME_MAX_LENGTH),
            exportId,
            uploadedBy: input.userId,
            fileName: input.fileName,
            sourceFileId: fileId,
            phase: 'uploaded',
            totalRows: parsed.sheets.products.length,
          })
          .returning();
        if (!row) throw new Error('일괄 세션을 만들지 못했습니다');
        return { sessionId: row.id, phase: 'uploaded' as const, totalRows: row.totalRows };
      }, tx);
    } catch (error) {
      if (!isForeignKeyViolation(error)) throw error;

      // 게이트 체크(assertExportUsable) 통과 후, 이 INSERT 사이에 정리 크론이 export 를
      // 지웠다 — 파일은 이미 올라갔으니 best-effort 로 지운다. 정리가 실패해도 작업자에게
      // 보이는 오류(원래의 BadRequestError)를 바꾸지 않는다 — 파일 정리 실패가 "이 양식은
      // 더 이상 쓸 수 없다"는 진짜 원인을 가리면 안 된다.
      try {
        await this.fileClient.softDelete(fileId, input.userId);
      } catch (cleanupError) {
        const message = cleanupError instanceof Error ? cleanupError.message : '알 수 없는 오류';
        this.logger.warn(
          `게이트 통과 후 export 가 무효화돼 업로드 파일 정리를 시도했으나 실패했습니다 (file=${fileId}): ${message}`,
        );
      }
      throw new BadRequestError(EXPORT_UNUSABLE_MESSAGE);
    }
  }

  /**
   * "없음" 과 "있지만 모름" 을 가른다. 후자는 **업로드 거부**다 — 스펙 §3.1 ⚠️.
   *
   * 소유권은 보지 않는다. 양식을 만든 사람과 올리는 사람이 다른 것은 정상 업무다
   * (MD 가 만들어 팀원에게 넘긴다). 여기서 노출되는 정보는 "이 양식이 아직 유효한가"
   * 하나뿐이고, 그건 파일을 이미 손에 든 사람만 물을 수 있는 질문이다.
   *
   * accept 가 이 게이트 전용으로 연 짧은 트랜잭션의 `trx` 를 받는다 — INSERT 와는 별개
   * 트랜잭션이다(accept 독스트링의 세 단계 분리 참조). private 헬퍼라 `trx` 는 필수다
   * (ADR-0025) — 여기서 새 `db.run` 을 열지 않고 호출부가 연 것을 그대로 쓴다.
   */
  private async assertExportUsable(exportId: string, trx: DbTransaction): Promise<void> {
    // 메타 셀은 형식 검증 없이 그대로 돌아온다(readExportIdFromWorkbook). uuid 컬럼에
    // 비-uuid 문자열을 `eq` 로 걸면 Postgres 가 22P02(invalid input syntax)로 죽어
    // 일반 500 이 된다 — 게이트의 존재 이유(작업자에게 "양식을 다시 받으라" 알리는 것)가
    // 무색해진다. 쿼리 전에 형태만 걸러 같은 거부 메시지로 던진다.
    if (!isUUID(exportId)) throw new BadRequestError(EXPORT_UNUSABLE_MESSAGE);

    const [job] = await trx
      .select({ status: productFormExports.status, expiresAt: productFormExports.expiresAt })
      .from(productFormExports)
      .where(eq(productFormExports.id, exportId))
      .limit(1);
    // status 만으로는 부족하다 — 만료 정리는 하루 한 번(새벽 4시)만 돈다. 만료 시각을
    // 지난 completed 잡은 하루 안팎을 "정상"으로 통과할 수 있다(스펙 §3.1 이 말하는
    // 트리거는 만료지, 삭제가 아니다). expiresAt 을 여기서 직접 본다 — 삭제를 기다리지 않는다.
    if (!job || job.status !== 'completed' || job.expiresAt <= new Date()) {
      throw new BadRequestError(EXPORT_UNUSABLE_MESSAGE);
    }

    // "한 행을 집어 그 행이 NULL 인지" 프로브하지 않는다 — "모든 items 의 snapshot
    // nullity 가 같다"는 오늘은 참이지만(1단계 잡 매니저가 delete+insert 로 items 를
    // 통째로 갈아치운다) 그 불변식을 강제하는 CHECK 도, 쓰기 지점 주석도 없다. 미래에
    // 부분 쓰기 경로가 생기면 임의의 행을 집는 프로브는 시트 절반을 조용히 신규로
    // 재분류한다. 대신 "NULL 인 행이 하나라도 있는가"를 직접 묻는다 — 쿼리 비용은
    // 같고 구조적으로 닫힌다.
    const [nullSnapshotItem] = await trx
      .select({ id: productFormExportItems.id })
      .from(productFormExportItems)
      .where(and(eq(productFormExportItems.exportId, exportId), isNull(productFormExportItems.snapshot)))
      .limit(1);
    // items 가 0행인 양식(active 있는 상품이 하나도 없었다)은 프리필 행이 없다는 뜻이라
    // 신규 전용과 실질적으로 같다 — 거부하지 않는다. NULL 스냅샷 행이 하나라도 있는
    // 것만 거부한다(스냅샷 컬럼 이전에 만들어진 양식).
    if (nullSnapshotItem) throw new BadRequestError(EXPORT_UNUSABLE_MESSAGE);
  }

  /**
   * 필드별 충돌 결정. review 단계에서만 허용한다 — 검증 중엔 충돌이 아직 확정되지
   * 않았고, 승인 이후엔 이미 지나간 결정이라 되돌릴 이유가 없다.
   *
   * **행 단위가 아니라 필드 단위**다(스펙 §3.6) — 한 행에서 판매가는 내 값으로, 브랜드는
   * 남의 값으로 고를 수 있어야 한다. 행 단위로 뭉치면 무관한 필드까지 함께 되돌아간다.
   *
   * **부분 갱신**을 허용한다 — 기존 `conflictDecision` 에 머지한다. 수백 행짜리 세션에서
   * 한 번에 다 보내라고 요구할 수 없다. 결정 키가 그 행의 `conflict` 키에 없으면
   * BadRequestError 다 — 충돌하지도 않은 필드에 결정을 다는 것은 화면이 낡았다는 뜻이다.
   */
  async setConflictDecision(
    sessionId: string,
    itemId: string,
    userId: string,
    decisions: Record<string, string>,
    tx?: DbTransaction,
  ): Promise<BulkSessionItemDto> {
    return this.db.run(async (trx) => {
      const [session] = await trx
        .select({ phase: productBulkSessions.phase, uploadedBy: productBulkSessions.uploadedBy })
        .from(productBulkSessions)
        .where(eq(productBulkSessions.id, sessionId))
        .limit(1);
      if (!session || session.uploadedBy !== userId) {
        throw new NotFoundError(`일괄 등록 세션을 찾을 수 없습니다: ${sessionId}`);
      }
      if (session.phase !== 'review') {
        throw new ConflictError('검토 단계가 아닌 세션은 충돌을 결정할 수 없습니다.');
      }

      const [item] = await trx
        .select({ conflict: productBulkItems.conflict, conflictDecision: productBulkItems.conflictDecision })
        .from(productBulkItems)
        .where(and(eq(productBulkItems.id, itemId), eq(productBulkItems.sessionId, sessionId)))
        .limit(1);
      if (!item) throw new NotFoundError(`일괄 등록 세션의 행을 찾을 수 없습니다: ${itemId}`);

      const conflictMap = toConflictMap(item.conflict);
      const merged: ConflictDecisionMap = { ...toConflictDecisionMap(item.conflictDecision) };
      for (const [field, decision] of Object.entries(decisions)) {
        // Task 10 리뷰 #5: `field in conflictMap` 은 프로토타입 체인도 본다 — `{"toString":
        // "overwrite"}` 같은 바디가 이 가드를 통과해 jsonb 에 쓰레기 키로 저장된다.
        // Object.hasOwn 으로 own key 만 본다.
        if (!Object.hasOwn(conflictMap, field)) {
          throw new BadRequestError(`충돌하지 않은 필드에는 결정을 달 수 없습니다: ${field}`);
        }
        if (decision !== 'overwrite' && decision !== 'skip') {
          throw new BadRequestError(`결정 값은 overwrite 또는 skip 이어야 합니다: ${field}`);
        }
        merged[field] = decision;
      }

      const [row] = await trx
        .update(productBulkItems)
        .set({ conflictDecision: merged, updatedAt: new Date() })
        .where(eq(productBulkItems.id, itemId))
        .returning(bulkItemRowColumns);
      if (!row) throw new Error('충돌 결정을 저장하지 못했습니다');

      return this.reader.toItemDto(row);
    }, tx);
  }

  /**
   * 검토 완료. 미결정 충돌이 하나라도 있으면 거부한다 — "덮어쓰기"는 항상 남의 편집을
   * 되돌리는 결정이라 기본값을 서버가 정할 수 없다(스펙 §3.6). 미결정 개수는 행이 아니라
   * **필드** 단위로 센다 — 결정도 필드 단위이므로 그래야 사람이 "몇 개 더 판단해야
   * 하는지"를 그대로 읽는다.
   *
   * **`status='pending'` 인 행만 본다**(Task 10 리뷰 #2) — 검증기는 한 행에 conflict 와
   * error 를 동시에 굳힐 수 있다(이미지키 오타로 invalid 인데 브랜드도 충돌 중인 행 등,
   * bulk-session-job.manager.ts:588-614 참조). `invalid`/`failed`/`excluded`/`drafted` 행은
   * 4단계가 애초에 집지 않으므로 그 충돌은 절대 적용되지 않는다 — 어차피 버려질 행에
   * "남의 편집을 되돌릴지" 판단을 강요하면 `detectConflicts` 가 피하려던 노이즈가 된다.
   *
   * 다음 phase 는 요구 이미지가 남았는지로 갈린다 — 판정은 `BulkSessionReader.hasPendingImageWork`
   * 가 하고, 거기에도 **같은 `status='pending'` 필터**가 걸린다(버려질 행이 참조하는 파일을 요구하면
   * 안 된다). 남았으면 `awaiting_images`(3단계가 게이트를 연다), 없으면 곧장 `drafting`.
   * **2단계에는 그 두 phase 를 처리하는 워커가 아직 없다** — 승인된 세션은 거기서 멈춘 채
   * 기다린다. 그게 의도다.
   *
   * 마지막 UPDATE 는 `phase='review'` + `cancelRequestedAt IS NULL` CAS 를 건다(Task 10
   * 리뷰 #4) — 위 SELECT 로 읽은 상태와 이 UPDATE 사이에 다른 탭이 취소를 끼워 넣으면
   * (READ COMMITTED 라 경쟁의 창이 있다) CAS 가 0행이 되어 `ConflictError` 로 거부한다.
   * 그러지 않으면 "취소됐는데 phase 는 drafting" 인 좀비 상태가 남는다.
   */
  async approve(sessionId: string, userId: string, tx?: DbTransaction): Promise<BulkSessionProgressDto> {
    return this.db.run(async (trx) => {
      const [session] = await trx
        .select({ phase: productBulkSessions.phase, uploadedBy: productBulkSessions.uploadedBy })
        .from(productBulkSessions)
        .where(eq(productBulkSessions.id, sessionId))
        .limit(1);
      if (!session || session.uploadedBy !== userId) {
        throw new NotFoundError(`일괄 등록 세션을 찾을 수 없습니다: ${sessionId}`);
      }
      if (session.phase !== 'review') {
        throw new ConflictError('검토 단계가 아닌 세션은 승인할 수 없습니다.');
      }

      const conflictedItems = await trx
        .select({
          conflict: productBulkItems.conflict,
          conflictDecision: productBulkItems.conflictDecision,
          rowNumber: productBulkItems.rowNumber,
        })
        .from(productBulkItems)
        .where(
          and(
            eq(productBulkItems.sessionId, sessionId),
            eq(productBulkItems.status, 'pending'),
            isNotNull(productBulkItems.conflict),
          ),
        );

      let undecidedCount = 0;
      // Task 10 리뷰 #7: "결정하지 않은 충돌이 N건" 만으로는 1,000행 세션에서 그 행을 찾을
      // 수 없다 — 이미 읽고 있는 rowNumber 를 메시지에 미리보기로 싣는다(추가 쿼리 없음).
      const undecidedRowNumbers: number[] = [];
      for (const item of conflictedItems) {
        const conflictMap = toConflictMap(item.conflict);
        const decisionMap = toConflictDecisionMap(item.conflictDecision);
        let rowHasUndecided = false;
        for (const field of Object.keys(conflictMap)) {
          if (!decisionMap[field]) {
            undecidedCount += 1;
            rowHasUndecided = true;
          }
        }
        if (rowHasUndecided) undecidedRowNumbers.push(item.rowNumber);
      }
      if (undecidedCount > 0) {
        const preview = undecidedRowNumbers
          .slice(0, 5)
          .map((rowNumber) => `${rowNumber}행`)
          .join(', ');
        throw new ConflictError(`결정하지 않은 충돌이 ${undecidedCount}건 있습니다 (예: ${preview})`);
      }

      const nextPhase = (await this.reader.hasPendingImageWork(trx, sessionId)) ? 'awaiting_images' : 'drafting';

      const [updated] = await trx
        .update(productBulkSessions)
        .set({ phase: nextPhase, phaseError: null, updatedAt: new Date() })
        .where(
          and(
            eq(productBulkSessions.id, sessionId),
            eq(productBulkSessions.phase, 'review'),
            isNull(productBulkSessions.cancelRequestedAt),
          ),
        )
        .returning({ id: productBulkSessions.id });
      if (!updated) {
        throw new ConflictError('세션 상태가 그 사이 바뀌어 승인하지 못했습니다. 다시 조회한 뒤 시도해 주세요.');
      }

      return this.reader.getProgress(sessionId, userId, trx);
    }, tx);
  }

  /**
   * 세션 취소. `phase NOT IN ('published', 'canceled')` 면 허용한다 — **failed 도 대상이다.**
   * v3 는 굳은 세션이 취소도 409 를 받아 영영 못 풀렸다(스펙 §3.2). 종단(published·canceled)
   * 만 409 다.
   *
   * `cancel_requested_at` 과 `phase` 를 **같은 UPDATE** 에서 함께 찍는다 — 워커의
   * `renewLease` 가 매 행마다 `cancel_requested_at` 을 `returning` 으로 관측해 즉시 멈추고
   * (bulk-session-job.manager.ts), `phase` 를 여기서 바로 `canceled` 로 확정해두면 그 사이
   * `finishValidating`/`failSession` 이 끼어들어도(둘 다 WHERE 에 `cancel_requested_at IS
   * NULL` 을 건다) 0행이 되어 아무 것도 덮어쓰지 못한다.
   *
   * **이미지 정리는 여기서 하지 않는다.** 취소는 즉시 끝나야 하고 세션당 이미지 행이
   * 최대 1만 건이라 인라인 삭제가 불가능하다 — `BulkImageCleaner` 의 @Cron 스윕이
   * `phase='canceled'` 세션을 찾아 지운다(draft 가 하나라도 붙은 세션은 건드리지 않는다).
   *
   * 마지막 UPDATE 는 `phase NOT IN ('published','canceled')` CAS 를 다시 건다(Task 10
   * 리뷰 #4) — 위 SELECT 와 이 UPDATE 사이에 다른 탭이 승인/게시를 끝냈으면(READ COMMITTED
   * 라 경쟁의 창이 있다) CAS 가 0행이 되어 `ConflictError` 로 거부한다. 읽기-검사만 하고
   * 쓰기를 무조건 걸면 그 사이의 전이를 조용히 덮어써 좀비 상태가 남는다.
   */
  async cancel(sessionId: string, userId: string, tx?: DbTransaction): Promise<BulkSessionProgressDto> {
    return this.db.run(async (trx) => {
      const [session] = await trx
        .select({ phase: productBulkSessions.phase, uploadedBy: productBulkSessions.uploadedBy })
        .from(productBulkSessions)
        .where(eq(productBulkSessions.id, sessionId))
        .limit(1);
      if (!session || session.uploadedBy !== userId) {
        throw new NotFoundError(`일괄 등록 세션을 찾을 수 없습니다: ${sessionId}`);
      }
      if (session.phase === 'published' || session.phase === 'canceled') {
        throw new ConflictError('이미 종료된 세션은 취소할 수 없습니다.');
      }

      const [updated] = await trx
        .update(productBulkSessions)
        .set({ cancelRequestedAt: new Date(), phase: 'canceled', updatedAt: new Date() })
        .where(
          and(eq(productBulkSessions.id, sessionId), notInArray(productBulkSessions.phase, ['published', 'canceled'])),
        )
        .returning({ id: productBulkSessions.id });
      if (!updated) {
        throw new ConflictError('세션 상태가 그 사이 바뀌어 취소하지 못했습니다. 다시 조회한 뒤 시도해 주세요.');
      }

      return this.reader.getProgress(sessionId, userId, trx);
    }, tx);
  }
}
