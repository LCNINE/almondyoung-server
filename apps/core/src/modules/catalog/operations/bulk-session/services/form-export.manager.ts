import { Injectable, Logger } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import { ConflictError, NotFoundError } from '@app/shared';
import { and, count, desc, eq, inArray, lt } from 'drizzle-orm';
import { type PimSchema, productFormExports } from '../../../schema/catalog.schema';
import { DbTransaction } from '../../../catalog.types';
import { FormExportFileClient } from './form-export-file.client';
import { FormExportAcceptedDto, FormExportListDto, FormExportStatusDto } from '../dto';

export const FORM_EXPORT_TTL_DAYS = 30;

@Injectable()
export class FormExportManager {
  private readonly logger = new Logger(FormExportManager.name);

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly fileClient: FormExportFileClient,
  ) {}

  /**
   * 양식 생성을 접수한다. 조립은 워커가 이어받는다 — 수천 건이면 ALB 60초 안에 못 끝낸다.
   * 스냅샷 항목은 이 시점이 아니라 조립 시점에 만든다. 접수와 조립 사이에 active 가
   * 바뀔 수 있고, 워크북에 실제로 담긴 버전과 스냅샷이 어긋나면 안 되기 때문이다.
   */
  async accept(masterIds: string[], userId: string, tx?: DbTransaction): Promise<FormExportAcceptedDto> {
    const unique = [...new Set(masterIds)];

    return this.db.run(async (trx) => {
      // 진행 중인 같은 요청이 있으면 그것을 돌려준다. 워커가 인스턴스당 한 번에 잡
      // 하나만 처리하는 직렬 큐라, 중복 잡은 남의 대기시간을 직접 늘린다.
      //
      // SQL 배열 동등 비교(requested_master_ids = ...)를 쓰지 않는 이유: 그러려면 저장 시
      // 정렬이 전제인데 기존 행들은 정렬돼 있지 않아 영영 매칭되지 않는다. 진행 중 잡은
      // 보통 0~2건이므로 가져와서 집합으로 비교한다 — 선택 순서가 달라도 같게 본다.
      const inFlight = await trx
        .select()
        .from(productFormExports)
        .where(
          and(eq(productFormExports.requestedBy, userId), inArray(productFormExports.status, ['queued', 'running'])),
        );

      const wanted = new Set(unique);
      const match = inFlight.find((row) => sameIdSet(row.requestedMasterIds, wanted));
      if (match) {
        return {
          exportId: match.id,
          status: match.status === 'running' ? ('running' as const) : ('queued' as const),
          requestedCount: unique.length,
          reused: true,
        };
      }

      const expiresAt = new Date(Date.now() + FORM_EXPORT_TTL_DAYS * 86_400_000);
      const [row] = await trx
        .insert(productFormExports)
        .values({
          requestedBy: userId,
          requestedMasterIds: unique,
          status: 'queued',
          productCount: 0,
          expiresAt,
        })
        .returning();
      if (!row) throw new Error('양식 생성 잡을 만들지 못했습니다');

      // items 는 여기서 만들지 않는다 — 조립 시점에 실제 active 를 확인한 것만 담긴다.
      return { exportId: row.id, status: 'queued' as const, requestedCount: unique.length, reused: false };
    }, tx);
  }

  /**
   * 소유권 검사는 존재 검사와 같은 에러(NotFoundError)로 합친다 — 남의 export id 를
   * 넣었을 때 "있는데 내 것이 아님(403)"과 "아예 없음(404)"을 구분해 주면, 그 구분
   * 자체가 UUIDv7 id 존재 여부를 캐는 오라클이 된다. library/services/ownership.service.ts
   * `_loadOwnedOrThrow`(:365-368, "본인 외 접근은 존재 여부를 노출하지 않기 위해 404 와
   * 동등 취급")와 같은 선례를 따른다. 이 모듈에는 이제 목록 API(list())가 있지만, 그쪽도
   * 본인 잡만 SELECT 에 올리므로 남의 id 존재 여부를 노출하지 않는다 — 이 판단은 그대로 유효하다.
   */
  async getStatus(exportId: string, userId: string, tx?: DbTransaction): Promise<FormExportStatusDto> {
    return this.db.run(async (trx) => {
      const [row] = await trx.select().from(productFormExports).where(eq(productFormExports.id, exportId)).limit(1);
      if (!row || row.requestedBy !== userId) {
        throw new NotFoundError(`양식 생성 잡을 찾을 수 없습니다: ${exportId}`);
      }

      return {
        exportId: row.id,
        status: row.status,
        productCount: row.productCount,
        errorMessage: row.errorMessage,
        consecutiveFailures: row.consecutiveFailures,
        downloadable: row.status === 'completed' && row.fileId !== null,
        expiresAt: row.expiresAt.toISOString(),
      };
    }, tx);
  }

  /**
   * 내 양식 생성 목록. 남의 잡은 애초에 SELECT 에 들어오지 않는다 —
   * getStatus 가 소유권 실패를 404 로 합치는 것과 같은 이유로, 목록도 본인 것만 본다.
   */
  async list(userId: string, page: number, limit: number, tx?: DbTransaction): Promise<FormExportListDto> {
    return this.db.run(async (trx) => {
      const owned = eq(productFormExports.requestedBy, userId);

      const rows = await trx
        .select()
        .from(productFormExports)
        .where(owned)
        .orderBy(desc(productFormExports.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);

      const [totalRow] = await trx.select({ value: count() }).from(productFormExports).where(owned);

      return {
        data: rows.map((row) => ({
          exportId: row.id,
          status: row.status,
          requestedCount: row.requestedMasterIds.length,
          productCount: row.productCount,
          errorMessage: row.errorMessage,
          consecutiveFailures: row.consecutiveFailures,
          downloadable: row.status === 'completed' && row.fileId !== null,
          createdAt: row.createdAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
        })),
        total: totalRow?.value ?? 0,
        page,
        limit,
      };
    }, tx);
  }

  /**
   * 같은 상품 집합으로 다시 뽑는다. 별도 경로를 만들지 않고 accept 를 그대로 부르는
   * 이유는, 그래야 중복 제거·응답 모양·reused 플래그가 자동으로 똑같이 적용되기
   * 때문이다.
   *
   * **원본 상태에 제약을 두지 않는다.** failed 든 completed 든 "이 집합으로 다시
   * 뽑아줘"는 언제나 정당하고, 노출은 화면이 통제한다. 서버에 상태 제약을 넣으면
   * 화면 표와 서버 표를 둘 다 관리해야 한다.
   */
  async retry(exportId: string, userId: string, tx?: DbTransaction): Promise<FormExportAcceptedDto> {
    return this.db.run(async (trx) => {
      const [row] = await trx.select().from(productFormExports).where(eq(productFormExports.id, exportId)).limit(1);
      // getStatus 와 같은 이유로 소유권 실패를 404 로 합친다 — 구분해 주면 그 구분
      // 자체가 id 존재 여부를 캐는 오라클이 된다.
      if (!row || row.requestedBy !== userId) {
        throw new NotFoundError(`양식 생성 잡을 찾을 수 없습니다: ${exportId}`);
      }
      return this.accept(row.requestedMasterIds, userId, trx);
    }, tx);
  }

  async getDownloadUrl(exportId: string, userId: string, tx?: DbTransaction): Promise<string> {
    const fileId = await this.db.run(async (trx) => {
      const [row] = await trx
        .select({
          fileId: productFormExports.fileId,
          status: productFormExports.status,
          requestedBy: productFormExports.requestedBy,
        })
        .from(productFormExports)
        .where(eq(productFormExports.id, exportId))
        .limit(1);
      // 소유권 검사를 상태 검사보다 먼저 한다 — 순서를 바꾸면 남의 진행 중인 export 에
      // ConflictError(409)가, 완료된 것엔 실제 파일 조회 시도가 나가 "존재하지만 내 것이
      // 아님"을 간접 노출한다. getStatus 와 같은 이유로 NotFoundError 로 합친다.
      if (!row || row.requestedBy !== userId) {
        throw new NotFoundError(`양식 생성 잡을 찾을 수 없습니다: ${exportId}`);
      }
      // 존재하지만 아직 안 끝난 것과 애초에 없는 것은 다르다 — 전자는 나중에 다시 물어보면
      // 되는 재시도 대상이지, 잘못된 id 가 아니다. product-import.manager.ts 의
      // queuePublish()가 같은 상황(작업이 아직 안 끝남)에 ConflictError 를 쓰는 것과 같은 관례.
      if (row.status !== 'completed' || !row.fileId) {
        throw new ConflictError('양식이 아직 생성 중입니다. 잠시 후 다시 시도해 주세요.');
      }
      return row.fileId;
    }, tx);

    return this.fileClient.getDownloadUrl(fileId, userId);
  }

  /**
   * 만료된 잡을 지운다. items 는 FK cascade 로 함께 사라진다.
   *
   * xlsx 도 함께 지운다(catalog.schema.ts:1016 주석, 스펙 §3.12) — file-service 에 고아
   * 파일 정리 잡이 없으므로(스펙 §2.7) 잡 행만 지우면 완료된 잡의 xlsx 가 S3 에 영원히
   * 고아로 남는다. DB 삭제를 먼저 커밋하고 파일 삭제는 그 뒤 best-effort 로 돈다 —
   * 순서를 반대로 하면 file-service 가 이미 지워진 파일(404)이나 일시 장애로 실패했을 때
   * 잡 행 정리 자체가 막힌다. 실패해도 로그만 남기고 계속한다: 파일 하나 지우는 데
   * 실패했다고 나머지 만료 잡 정리를 통째로 포기하는 게, 파일이 하나 새는 것보다 나쁘다.
   * file-service 의 삭제는 soft delete 라 S3 바이트 자체는 이 클라이언트 호출과 무관하게
   * 남는다(FormExportFileClient.softDelete 주석, 스펙 §5.2 기지 결함) — 그건 이 메서드가
   * 풀 문제가 아니다.
   */
  async purgeExpired(now: Date, tx?: DbTransaction): Promise<number> {
    const rows = await this.db.run(async (trx) => {
      return trx.delete(productFormExports).where(lt(productFormExports.expiresAt, now)).returning({
        id: productFormExports.id,
        fileId: productFormExports.fileId,
        requestedBy: productFormExports.requestedBy,
      });
    }, tx);

    for (const row of rows) {
      if (!row.fileId) continue;
      try {
        await this.fileClient.softDelete(row.fileId, row.requestedBy);
      } catch (error) {
        const message = error instanceof Error ? error.message : '알 수 없는 오류';
        this.logger.warn(
          `만료된 양식 파일 삭제 실패 — 잡 행은 이미 정리됨 (export=${row.id}, file=${row.fileId}): ${message}`,
        );
      }
    }

    return rows.length;
  }
}

/**
 * 저장된 masterId 배열이 요청 집합과 같은지 본다. 저장본에 중복이 있을 수 있어
 * (옛 행은 정렬도 중복 제거도 보장되지 않는다) 길이 비교 대신 Set 으로 접는다.
 */
function sameIdSet(stored: string[], wanted: Set<string>): boolean {
  const storedSet = new Set(stored);
  if (storedSet.size !== wanted.size) return false;
  for (const id of storedSet) {
    if (!wanted.has(id)) return false;
  }
  return true;
}
