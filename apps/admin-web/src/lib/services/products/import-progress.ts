// src/lib/services/products/import-progress.ts
// 대량등록 진행률 순수 헬퍼. **런타임 import 를 두지 않는다** — 루트 tsconfig 에 `@/*`
// 별칭이 없어 루트 jest 가 해석하지 못한다. 타입 전용 import 는 isolatedModules 로
// 지워지므로 안전하다(선례: wizard/can-commit.ts).

import type {
  ImportProgressDto,
  ImportProgressStage,
  SessionSummaryDto,
} from '@/lib/types/dto/product-import';

const RUNNING: ReadonlySet<string> = new Set(['queued', 'running']);
/** cancelSession 의 active() 와 같은 집합 — queued/running 에 failed 를 더한다. */
const CANCELABLE: ReadonlySet<string> = new Set(['queued', 'running', 'failed']);

/** 한 단계라도 진행 중이면 true. 폴링 유지 조건이다. */
export function isProgressRunning(progress: ImportProgressDto | undefined): boolean {
  if (!progress) return false;
  return progress.stages.some((s) => RUNNING.has(s.status));
}

/**
 * 화면용 진행 여부. progress 가 있으면 그쪽이 진실이고, 없으면 세션 레인 상태로
 * 폴백한다 — 롤링 배포 중 옛 core 태스크는 /progress 를 모른다(404).
 *
 * 폴백에서 imageStatus 도 봐야 한다 — 이미지 레인이 도는 세션은 commitStatus 가
 * 'idle' 로 게이트돼 있어 커밋·게시만 보면 진행 중을 놓친다. `?? 'completed'` 인
 * 이유: 옛 core 응답에는 이 키가 아예 없다(optional). `'queued'` 같은 값으로
 * 기본을 잡으면 이미지 레인이 없던 옛 세션이 영원히 "진행 중"으로 보여 폴링이
 * 멈추지 않는다.
 */
export function isImportRunning(
  progress: ImportProgressDto | undefined,
  session: SessionSummaryDto | undefined
): boolean {
  if (progress) return isProgressRunning(progress);
  if (!session) return false;
  return (
    RUNNING.has(session.imageStatus ?? 'completed') ||
    RUNNING.has(session.commitStatus) ||
    RUNNING.has(session.publishStatus)
  );
}

/**
 * 취소 버튼 노출 조건. 서버 cancelSession 의 active() 판정과 같은 집합
 * (queued/running/failed) 을 쓴다 — 레인이 연속 실패 상한에 닿아 failed 로 확정되면
 * 스스로 빠져나올 수 없고, 설계상 취소가 유일한 해소 수단이다(design spec §3.4.2).
 *
 * isImportRunning 과 갈라 두는 이유: isImportRunning 은 **폴링 유지** 조건이라 failed 를
 * 넣으면 안 된다 — failed 레인은 더 이상 워커가 갱신하지 않으므로 폴링이 되살아나면
 * 안 된다. 이 함수는 오직 취소 가능 여부에만 쓴다.
 */
export function isImportCancelable(
  progress: ImportProgressDto | undefined,
  session: SessionSummaryDto | undefined
): boolean {
  if (progress) {
    return !progress.canceled && progress.stages.some((s) => CANCELABLE.has(s.status));
  }
  if (!session || session.cancelRequestedAt) return false;
  return (
    CANCELABLE.has(session.imageStatus ?? 'completed') ||
    CANCELABLE.has(session.commitStatus) ||
    CANCELABLE.has(session.publishStatus)
  );
}

/** 진행률 바 퍼센트. 분모 0 은 100% 가 아니라 0% 다 — 아직 분모가 없다는 뜻이다. */
export function stagePercent(stage: ImportProgressStage): number {
  if (stage.total <= 0) return 0;
  return Math.min(100, Math.round((stage.done / stage.total) * 100));
}

/**
 * 분모가 0 인 단계는 접는다. 이미지 없는 워크북의 probe/fetch(v3 4단계)와 아직
 * 생성된 행이 없어 게시 대상이 0 인 publish 가 여기 걸린다.
 *
 * 다만 분모 0 이어도 status: 'failed' 거나 error 가 실려 있으면 접지 않는다 — 전 행
 * 검증실패이거나 0행 세션에서 레인이 10회 연속 실패해 failed 로 확정된 경우 분모가
 * 끝까지 0 인 채로 남는다. 그때 접어버리면 이 오류가 화면 어디에도 안 뜬다(폴백
 * 오류 배너는 progress 자체가 없을 때만 뜬다) — 실패를 보여주는 쪽이 접는 것보다
 * 우선한다.
 */
export function visibleStages(progress: ImportProgressDto): ImportProgressStage[] {
  return progress.stages.filter((s) => s.total > 0 || s.error !== null || s.status === 'failed');
}

export interface ImportCounts {
  totalRows: number;
  created: number;
  createdFailed: number;
  /** null 이면 접수 시점 검증실패를 가를 수 없는 옛 세션이다. */
  invalid: number | null;
  published: number;
  publishFailed: number;
}

/**
 * 화면 상단 요약 숫자. progress 가 진실이다 — 매번 집계하므로 워커가 중단돼도
 * 세션 카운터처럼 드리프트하지 않는다. progress 가 없을 때만 세션 카운터로 폴백한다.
 */
export function importCounts(
  progress: ImportProgressDto | undefined,
  session: SessionSummaryDto | undefined
): ImportCounts | null {
  if (progress) {
    const commit = progress.stages.find((s) => s.key === 'commit');
    const publish = progress.stages.find((s) => s.key === 'publish');
    return {
      totalRows: progress.totalRows,
      created: (commit?.done ?? 0) - (commit?.failed ?? 0),
      createdFailed: commit?.failed ?? 0,
      invalid: progress.invalidCount,
      published: (publish?.done ?? 0) - (publish?.failed ?? 0),
      publishFailed: publish?.failed ?? 0,
    };
  }
  if (!session) return null;
  return {
    totalRows: session.totalRows,
    created: session.createdCount,
    // `== null` 은 의도적이다 — 컬럼 도입 이전 세션(null)과 롤링 배포 중 옛 태스크의
    // 응답(undefined)을 함께 현행 표시로 폴백시킨다.
    createdFailed:
      session.invalidCount == null
        ? session.failedCount
        : session.failedCount - session.invalidCount,
    invalid: session.invalidCount,
    published: session.publishedCount,
    publishFailed: session.publishFailedCount,
  };
}
