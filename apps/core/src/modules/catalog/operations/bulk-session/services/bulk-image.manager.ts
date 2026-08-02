import { Injectable, Logger } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { type PimSchema, productBulkImages, productBulkSessions } from '../../../schema/catalog.schema';
import { DbTransaction } from '../../../catalog.types';
import { FormExportFileClient, type BulkFileMetadata } from './form-export-file.client';
import { BulkSessionReader } from './bulk-session.reader';
import { checkFileMetadata, dedupeResolutions, imageRefKey, type BulkImageUsage } from './bulk-session.images';
import { ResolveImageResultDto, ResolveImagesResponseDto } from '../dto';

/**
 * 한 요청이 담을 수 있는 해석 통보 수.
 *
 * 항목마다 file-service 메타데이터를 순차로 확인하므로 요청 시간이 이 수에 비례한다.
 * ALB idle timeout 이 60초(스펙 §2.7)이고 건당 타임아웃이 5초라 최악을 감당할 수는
 * 없지만, 정상 경로(수십 ms)에서는 50건이 1~2초다. 브라우저는 업로드가 끝나는 대로
 * 나눠 보낸다 — 한 번에 다 보내야 할 이유가 없다.
 */
export const MAX_RESOLUTIONS_PER_REQUEST = 50;

export interface ResolveEntry {
  imageKey: string;
  usage: BulkImageUsage;
  fileId: string;
}

/** ② 단계를 통과해 실제로 쓸 것 하나. `previousFileId` 는 ④ 단계 정리 대상이다. */
interface AppliedResolution {
  rowId: string;
  fileId: string;
  previousFileId: string | null;
  /**
   * `results` 에 이미 들어간 이 항목의 결과 객체 **참조**. ③이 잠금 후 phase 를 다시
   * 읽어 기록을 포기했을 때 그 항목만 실패로 내리기 위해 들고 있는다 — 인덱스로
   * 되찾으려면 `results` 가 `deduped` 와 정렬돼 있어야 하는데 그 보장이 없다.
   */
  result: ResolveImageResultDto;
}

@Injectable()
export class BulkImageManager {
  private readonly logger = new Logger(BulkImageManager.name);

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly fileClient: FormExportFileClient,
    private readonly reader: BulkSessionReader,
  ) {}

  /**
   * 브라우저가 file-service 에 직접 올린 파일들을 `(imageKey, usage, fileId)` 로 통보받아
   * 기록하고, 요구된 파일이 전부 채워졌으면 `drafting` 으로 전진시킨다.
   *
   * **부분 성공이다.** 50건 중 3건이 실패해도 47건은 기록된다 — 배치 전체를 400 으로
   * 돌리면 성공한 47장이 재업로드돼 S3 고아가 47개 생긴다(file-service 에 고아 정리 잡이
   * 없다, 스펙 §2.7). 실패는 `results` 항목의 `error` 로 돌려준다.
   *
   * **`results` 와 요청 `entries` 의 대응**: 순서는 보존되지만 **인덱스는 어긋난다** —
   * `dedupeResolutions` 가 같은 `(imageKey, usage)` 중복을 접어 길이가 줄 수 있기
   * 때문이다. 그래서 짝은 반드시 `(imageKey, usage)` 로 짓는다. `ResolveImagesResponseDto`
   * 의 `results` 설명이 같은 계약을 말한다.
   *
   * **트랜잭션 경계**(2단계 `BulkSessionManager.accept` 가 세운 3단계 분리와 같은 규율):
   * ① 짧은 트랜잭션에서 가드 + 대상 적재 → ② 트랜잭션 **밖**에서 메타데이터 확인 →
   * ③ 짧은 트랜잭션에서 UPDATE + 게이트 + CAS → ④ 트랜잭션 **밖**에서 옛 파일 정리.
   * HTTP 왕복이 DB 트랜잭션을 물면 커넥션이 초 단위로 잠긴다.
   *
   * ⚠️ **이 메서드에 `tx` 를 넘기지 마라.** 시그니처의 `tx?` 는 레포 규약(ADR-0025 —
   * 공개 메서드는 마지막 인자로 `tx?` 를 받는다)을 지키기 위한 것일 뿐, 이 메서드에는
   * 넘겨서는 **안 되는** 인자다. 넘기면 `db.run` 이 새 트랜잭션을 열지 않고 그 트랜잭션을
   * 그대로 쓰므로 ①②③④ 가 한 트랜잭션 안에 들어가고, 위 경계가 통째로 무너진다:
   * ②의 HTTP 왕복(최대 50건 × 5초)과 ④의 삭제 루프가 ③이 잡는 **세션 배타 행 잠금을
   * 쥔 채** 돌아 같은 세션의 다른 요청을 분 단위로 막고 커넥션도 그만큼 붙잡는다.
   * 현재 유일한 호출자(`BulkSessionService.resolveImages`)는 넘기지 않는다.
   */
  async resolve(
    sessionId: string,
    userId: string,
    entries: ResolveEntry[],
    tx?: DbTransaction,
  ): Promise<ResolveImagesResponseDto> {
    // DTO 의 @ArrayMaxSize 와 중복이지만 서버가 다시 막는다 — 매니저는 컨트롤러 없이도
    // (통합 테스트·미래의 내부 호출) 불릴 수 있고, 그때 상한이 사라지면 안 된다.
    if (entries.length > MAX_RESOLUTIONS_PER_REQUEST) {
      throw new BadRequestError(`한 번에 최대 ${MAX_RESOLUTIONS_PER_REQUEST}건까지 보낼 수 있습니다.`);
    }
    const deduped = dedupeResolutions(entries);

    // ─── ① 가드 + 대상 적재 ───
    const targets = await this.db.run(async (trx) => {
      const [session] = await trx
        .select({ phase: productBulkSessions.phase, uploadedBy: productBulkSessions.uploadedBy })
        .from(productBulkSessions)
        .where(eq(productBulkSessions.id, sessionId))
        .limit(1);
      // 소유권은 존재 검사와 같은 오류로 합친다 — 구분 자체가 id 존재 여부 오라클이 된다.
      if (!session || session.uploadedBy !== userId) {
        throw new NotFoundError(`일괄 등록 세션을 찾을 수 없습니다: ${sessionId}`);
      }
      if (session.phase !== 'awaiting_images') {
        throw new ConflictError('이미지 업로드 단계가 아닌 세션입니다.');
      }

      const rows = await trx
        .select({
          id: productBulkImages.id,
          imageKey: productBulkImages.imageKey,
          usage: productBulkImages.usage,
          sourceKind: productBulkImages.sourceKind,
          fileId: productBulkImages.fileId,
        })
        .from(productBulkImages)
        .where(eq(productBulkImages.sessionId, sessionId));

      return new Map(rows.map((row) => [imageRefKey(row.usage, row.imageKey), row]));
    }, tx);

    // ─── ② 항목별 확인 (트랜잭션 밖) ───
    const results: ResolveImageResultDto[] = [];
    const applied: AppliedResolution[] = [];

    for (const entry of deduped) {
      const fail = (error: string) => results.push({ imageKey: entry.imageKey, usage: entry.usage, ok: false, error });
      const row = targets.get(imageRefKey(entry.usage, entry.imageKey));

      if (!row) {
        fail('이 세션에 없는 이미지 참조입니다. 양식의 이미지키와 용도를 확인해 주세요.');
        continue;
      }
      // 양식에 파일ID로 적힌 원본은 이미 file-service 에 있는 파일을 가리킨다 — 그걸
      // 업로드로 바꾸면 워크북과 실제가 어긋난다. 바꾸려면 워크북에서 키를 고쳐야 한다.
      if (row.sourceKind !== 'file_name') {
        fail('양식에 파일ID로 적힌 이미지는 업로드로 바꿀 수 없습니다.');
        continue;
      }
      // 같은 값 재통보는 성공으로 친다(멱등) — 네트워크 재시도가 실패로 보이면 안 된다.
      if (row.fileId === entry.fileId) {
        results.push({ imageKey: entry.imageKey, usage: entry.usage, ok: true, error: null });
        continue;
      }

      // file-service 가 5xx 를 주거나 타임아웃(getMetadata 의 5초 AbortSignal)에 걸리면
      // getMetadata 가 throw 한다(404 만 null). 여기서 못 잡으면 이 예외가 resolve 전체를
      // 죽여 ③ 이 아예 안 돌고, 이미 통과한 앞선 항목들이 한 건도 기록되지 않은 채 S3
      // 고아가 된다 — 부분 성공 설계 전체가 무너진다. 일시적 장애 한 건이 나머지 49건의
      // 성공분을 고아로 만들면 안 된다(getMetadata 의 404→null 처리와 같은 이유).
      let meta: BulkFileMetadata | null;
      try {
        meta = await this.fileClient.getMetadata(entry.fileId, userId);
      } catch (error) {
        const message = error instanceof Error ? error.message : '알 수 없는 오류';
        this.logger.warn(`이미지 메타데이터 확인 실패 (session=${sessionId}, file=${entry.fileId}): ${message}`);
        // 원문 예외 텍스트를 error 필드에 싣지 않는다 — 관리자 화면에 그대로 렌더된다.
        fail('파일 확인에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        continue;
      }
      if (!meta) {
        fail('업로드된 파일을 찾을 수 없습니다. 다시 올려주세요.');
        continue;
      }
      const problem = checkFileMetadata(meta, entry.usage);
      if (problem) {
        fail(problem);
        continue;
      }

      const result: ResolveImageResultDto = { imageKey: entry.imageKey, usage: entry.usage, ok: true, error: null };
      results.push(result);
      applied.push({ rowId: row.id, fileId: entry.fileId, previousFileId: row.fileId, result });
    }

    // ─── ③ 기록 + 전량 게이트 + 전진 ───
    const { progress, recorded } = await this.db.run(async (trx) => {
      // 같은 세션에 대한 동시 해석 요청을 직렬화한다.
      //
      // 없으면 READ COMMITTED 아래에서 두 ③ 트랜잭션이 서로의 미커밋 쓰기를 못 봐
      // **둘 다** "아직 이미지가 남았다"로 판정하고, 결과적으로 아무도 전진시키지 않는다.
      // 게이트를 재평가하는 경로가 approve·resolve 둘뿐이라 그 상태는 스스로 풀리지 않고
      // 세션이 awaiting_images 에 영구히 갇힌다(탈출구는 취소=작업 전량 포기뿐).
      // 통합 테스트 "동시 통보에서 전진 CAS 는 한 번만 이기고 둘 다 성공 응답을 받는다"가
      // 이 잠금 없이는 결정적으로 실패한다.
      //
      // 잠그는 행이 하나(같은 세션)라 잠금 순서가 단일해 교착이 없다.
      //
      // **잠그면서 phase 를 다시 읽는다.** ①의 phase 검사(:84)와 여기 사이에는 ②의 HTTP
      // 왕복(최대 50건 × 5초)이 있어 그 창에서 phase 가 움직일 수 있다 — 다른 탭이 먼저
      // 마지막 파일을 통보해 `drafting` 으로 전진시키면, 늦게 도착한 이 요청이 이미
      // draft 가 참조 중인 이미지 행의 fileId 를 갈아끼우고 ④가 그 draft 참조 파일을
      // soft delete 한다. 3단계에는 drafting 워커가 없어 지금은 도달 불가지만 4단계에서
      // 활성화된다. 잠금은 이미 여기 있으므로 컬럼 두 개를 더 읽는 비용은 0 에 가깝다.
      const [locked] = await trx
        .select({
          phase: productBulkSessions.phase,
          cancelRequestedAt: productBulkSessions.cancelRequestedAt,
        })
        .from(productBulkSessions)
        .where(eq(productBulkSessions.id, sessionId))
        .for('update');

      // **UPDATE 를 건너뛰는 것이 아니라 항목을 실패로 돌린다.** 이 응답의 계약은
      // "`results` 항목마다 그 파일이 기록됐는지"(부분 성공 설계)이고, 기록하지 않은 채
      // `ok:true` 를 주면 화면은 업로드가 끝났다고 믿는데 실제로는 아무 행도 안 바뀐
      // 상태가 된다 — 그 거짓말이 S3 고아를 만들고 작업자가 되돌릴 방법도 없다.
      // ②에서 이미 실패한 항목과 멱등 성공(같은 fileId 재통보 — 이미 기록돼 있으므로
      // 여전히 참)은 그대로 둔다. `applied` 만 뒤집는다.
      if (!locked || locked.phase !== 'awaiting_images') {
        this.logger.warn(
          `이미지 통보 처리 중 세션 단계가 바뀌어 기록하지 않았습니다 (session=${sessionId}, phase=${locked?.phase ?? '없음'})`,
        );
        return { progress: await this.reader.getProgress(sessionId, userId, trx), recorded: false };
      }

      for (const item of applied) {
        // sourceKind 조건을 다시 건다 — ① 이후 바뀔 경로는 없지만 CAS 는 싸고,
        // 조건이 사라지면 나중에 그 불변식을 깨는 경로가 생겨도 조용히 통과한다.
        await trx
          .update(productBulkImages)
          .set({ fileId: item.fileId, status: 'resolved', updatedAt: new Date() })
          .where(and(eq(productBulkImages.id, item.rowId), eq(productBulkImages.sourceKind, 'file_name')));
      }

      // 취소 요청이 이미 걸려 있으면 전진 CAS 가 어차피 진다 — 잠금을 쥔 채 도는
      // 전량 게이트 스캔(세션의 pending payload 전량 + 집계)을 아낀다. CAS 자신의
      // `isNull(cancelRequestedAt)` 은 그대로 둔다(부록 B.5 — 지우면 안 되는 조건).
      if (locked.cancelRequestedAt === null && !(await this.reader.hasPendingImageWork(trx, sessionId))) {
        // `phase='awaiting_images'` + 취소 없음 CAS. 두 탭이 동시에 마지막 파일을
        // 통보하면 한쪽만 이기고, 그 사이 취소가 끼어들면 아무도 이기지 않는다 —
        // "취소됐는데 phase 는 drafting" 인 좀비를 만들지 않는다(2단계 approve 와 같은 CAS).
        const [advanced] = await trx
          .update(productBulkSessions)
          .set({ phase: 'drafting', phaseError: null, updatedAt: new Date() })
          .where(
            and(
              eq(productBulkSessions.id, sessionId),
              eq(productBulkSessions.phase, 'awaiting_images'),
              isNull(productBulkSessions.cancelRequestedAt),
            ),
          )
          .returning({ id: productBulkSessions.id });
        // 졌다고 예외를 던지지 않는다 — 이 요청의 본래 일(파일 기록)은 이미 성공했고,
        // 응답의 progress 가 실제 phase 를 그대로 보여준다.
        if (!advanced) {
          this.logger.debug(`전량 게이트 전진 CAS 에서 밀렸습니다 (session=${sessionId})`);
        }
      }

      return { progress: await this.reader.getProgress(sessionId, userId, trx), recorded: true };
    }, tx);

    // ③이 아무것도 기록하지 않았으면 통과했던 항목도 실패로 내린다. ④ 정리도 건너뛴다 —
    // 새 fileId 가 안 적혔는데 옛 파일을 지우면 그 행은 파일 없는 상태로 남는다.
    if (!recorded) {
      for (const item of applied) {
        item.result.ok = false;
        item.result.error = '세션 단계가 바뀌어 기록하지 못했습니다. 새로고침해 현재 상태를 확인해 주세요.';
      }
      return { results, progress };
    }

    // ─── ④ 교체된 옛 파일 정리 (트랜잭션 밖, best-effort) ───
    // 실패해도 이 요청을 실패시키지 않는다 — 기록은 이미 끝났고, 정리 실패는 S3 고아
    // 한 장이지 작업자가 행동할 수 있는 문제가 아니다. 남의 fileId 를 통보해 두고
    // 교체를 유도하는 공격은 `softDeleteOwnedFile` 의 403 으로 여기서 막힌다.
    for (const item of applied) {
      if (!item.previousFileId || item.previousFileId === item.fileId) continue;
      try {
        await this.fileClient.softDeleteOwnedFile(item.previousFileId, userId);
      } catch (error) {
        const message = error instanceof Error ? error.message : '알 수 없는 오류';
        this.logger.warn(`교체된 옛 이미지 정리 실패 (session=${sessionId}, file=${item.previousFileId}): ${message}`);
      }
    }

    return { results, progress };
  }
}
