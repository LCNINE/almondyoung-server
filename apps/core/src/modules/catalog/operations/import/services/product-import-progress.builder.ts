import { Injectable } from '@nestjs/common';
import type { productImportSessions, productImportItems, productImportImages } from '../../../schema/catalog.schema';
import { ImportProgressDto, ImportProgressStageDto } from '../dto/import-progress.dto';

type SessionRow = typeof productImportSessions.$inferSelect;
type ItemRow = typeof productImportItems.$inferSelect;
type ImageRow = typeof productImportImages.$inferSelect;

/** 진행률 계산이 실제로 읽는 세션 열만. 전체 행도 구조적으로 대입 가능하다. */
export type ProgressSessionRow = Pick<
  SessionRow,
  | 'id'
  | 'fileName'
  | 'totalRows'
  | 'invalidCount'
  | 'imageStatus'
  | 'commitStatus'
  | 'publishStatus'
  | 'imageError'
  | 'commitError'
  | 'publishError'
  | 'cancelRequestedAt'
>;

/** `(status, publish_status)` 조합별 행 수. 조합은 3×4 로 상한이 12행이다. */
export interface ImportItemStatusCount {
  status: ItemRow['status'];
  publishStatus: ItemRow['publishStatus'];
  count: number;
}

/** 이미지 행의 status 별 개수. 상태가 5값이라 상한이 5행이다. */
export interface ImportImageStatusCount {
  status: ImageRow['status'];
  count: number;
}

/**
 * 세션 집계 → 화면 단계별 진행률. DB 접근이 없는 순수 변환이라 단위테스트가 쉽다
 * (ProductImportPricingBuilder 와 같은 자리).
 *
 * **카운터 컬럼(createdCount·publishedCount)을 읽지 않는다.** 그것들은 워커가 +1 로
 * 올리는 값이라 슬라이스가 중단되면 실제와 어긋난다. 매번 집계하면 드리프트가 없다.
 */
@Injectable()
export class ProductImportProgressBuilder {
  build(
    session: ProgressSessionRow,
    itemCounts: ImportItemStatusCount[],
    imageCounts: ImportImageStatusCount[],
  ): ImportProgressDto {
    const sum = (predicate: (row: ImportItemStatusCount) => boolean): number =>
      itemCounts.reduce((acc, row) => (predicate(row) ? acc + row.count : acc), 0);
    const images = (...statuses: Array<ImageRow['status']>): number =>
      imageCounts.reduce((acc, row) => (statuses.includes(row.status) ? acc + row.count : acc), 0);

    // ─── 이미지 두 단계 ───
    const pending = images('pending');
    const probeFailed = images('probe_failed');
    const uploaded = images('uploaded');
    const fetchFailed = images('fetch_failed');
    const probeTotal = images('pending', 'probed', 'uploaded', 'probe_failed', 'fetch_failed');
    // probe 실패는 fetch 분모에서 빠진다 — 5값 enum 의 존재 이유가 이것이다. 뭉쳐 놓으면
    // 분모가 틀려 진행률이 영영 100% 에 닿지 않는다(스펙 §3.2.1).
    const fetchTotal = images('probed', 'uploaded', 'fetch_failed');

    const probing = session.imageStatus === 'running' && pending > 0;
    // 레인이 도는 중이고 pending 이 0 이면 probe 는 사실상 끝났다 — "probe 전량 완료"는
    // `count(status='pending') = 0` 으로 관측된다(스펙 §3.2.2).
    const probeStatus = session.imageStatus === 'running' && pending === 0 ? 'completed' : session.imageStatus;
    // probe 가 도는 동안 fetch 는 아직 시작 전이다. 'running' 으로 두면 화면이 두 단계가
    // 동시에 도는 것처럼 보인다.
    const fetchStatus = probing ? 'queued' : session.imageStatus;

    const createdRows = sum((row) => row.status === 'created');
    const failedRows = sum((row) => row.status === 'failed');

    // invalid_count 는 v3 1단계에서 생긴 컬럼이라 그 이전 세션은 null 이다. 0 으로 두면
    // failedRows 가 통째로 '생성 실패' 로 보이는데, 그게 바로 화면의 현행 폴백 표시
    // (검증실패/생성실패를 가르지 않고 failedCount 만 보여주는 것)와 같은 결과다.
    // 옛 세션은 이미 동기 경로로 끝나 있어 진행률을 볼 일도 거의 없다.
    const invalidCount = session.invalidCount ?? 0;

    // 뺄셈이 음수가 될 수는 없다 — failedRows 는 접수 시점에 invalidCount 로 시작해
    // failItem 이 더하기만 한다. 그래도 clamp 하는 이유는, 손으로 고친 행 하나가
    // 진행률 바를 음수로 만들어 화면 전체를 깨뜨리는 것보다 0 으로 보이는 편이 낫기 때문이다.
    const commitFailed = Math.max(0, failedRows - invalidCount);
    const commitTotal = Math.max(0, session.totalRows - invalidCount);

    const publishFailed = sum((row) => row.status === 'created' && row.publishStatus === 'failed');
    const publishPublished = sum((row) => row.status === 'created' && row.publishStatus === 'published');

    const stages: ImportProgressStageDto[] = [
      {
        key: 'probe',
        label: '이미지 점검',
        status: probeStatus,
        done: probeTotal - pending,
        total: probeTotal,
        failed: probeFailed,
        // 레인 오류는 어느 phase 에서 났는지 알 수 없으므로 두 단계 모두에 싣는다 —
        // 한쪽에만 실으면 그 단계가 분모 0 으로 접힐 때 오류가 화면 어디에도 안 뜬다.
        error: session.imageError,
      },
      {
        key: 'fetch',
        label: '이미지 업로드',
        status: fetchStatus,
        done: uploaded + fetchFailed,
        total: fetchTotal,
        failed: fetchFailed,
        error: session.imageError,
      },
      {
        key: 'commit',
        label: '상품 생성',
        status: session.commitStatus,
        done: createdRows + commitFailed,
        total: commitTotal,
        failed: commitFailed,
        error: session.commitError,
      },
      {
        key: 'publish',
        label: '게시',
        status: session.publishStatus,
        // 게시 대상은 생성에 성공한 행뿐이다. 검증실패·생성실패 행은 publish_status 가
        // 'skipped' 라 분모에 들어가면 영영 100% 가 되지 않는다.
        done: publishPublished + publishFailed,
        total: createdRows,
        failed: publishFailed,
        error: session.publishError,
      },
    ];

    return {
      sessionId: session.id,
      fileName: session.fileName,
      canceled: Boolean(session.cancelRequestedAt),
      cancelRequestedAt: session.cancelRequestedAt,
      totalRows: session.totalRows,
      invalidCount: session.invalidCount,
      stages,
    };
  }
}
