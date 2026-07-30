import { Injectable } from '@nestjs/common';
import type { productImportSessions, productImportItems } from '../../../schema/catalog.schema';
import { ImportProgressDto, ImportProgressStageDto } from '../dto/import-progress.dto';

type SessionRow = typeof productImportSessions.$inferSelect;
type ItemRow = typeof productImportItems.$inferSelect;

/** 진행률 계산이 실제로 읽는 세션 열만. 전체 행도 구조적으로 대입 가능하다. */
export type ProgressSessionRow = Pick<
  SessionRow,
  | 'id'
  | 'fileName'
  | 'totalRows'
  | 'invalidCount'
  | 'commitStatus'
  | 'publishStatus'
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

/**
 * 세션 집계 → 화면 단계별 진행률. DB 접근이 없는 순수 변환이라 단위테스트가 쉽다
 * (ProductImportPricingBuilder 와 같은 자리).
 *
 * **카운터 컬럼(createdCount·publishedCount)을 읽지 않는다.** 그것들은 워커가 +1 로
 * 올리는 값이라 슬라이스가 중단되면 실제와 어긋난다. 매번 집계하면 드리프트가 없다.
 */
@Injectable()
export class ProductImportProgressBuilder {
  build(session: ProgressSessionRow, itemCounts: ImportItemStatusCount[]): ImportProgressDto {
    const sum = (predicate: (row: ImportItemStatusCount) => boolean): number =>
      itemCounts.reduce((acc, row) => (predicate(row) ? acc + row.count : acc), 0);

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
