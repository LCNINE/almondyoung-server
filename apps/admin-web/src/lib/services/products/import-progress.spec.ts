import {
  importCounts,
  isImportRunning,
  isProgressRunning,
  stagePercent,
  visibleStages,
} from './import-progress';
import type {
  ImportProgressDto,
  ImportProgressStage,
  SessionSummaryDto,
} from '@/lib/types/dto/product-import';

const stage = (over: Partial<ImportProgressStage> = {}): ImportProgressStage => ({
  key: 'commit',
  label: '상품 생성',
  status: 'running',
  done: 3,
  total: 10,
  failed: 0,
  error: null,
  ...over,
});

const progress = (over: Partial<ImportProgressDto> = {}): ImportProgressDto => ({
  sessionId: 's1',
  fileName: 'f.xlsx',
  canceled: false,
  cancelRequestedAt: null,
  totalRows: 12,
  invalidCount: 2,
  stages: [
    stage({ key: 'commit', done: 6, total: 10, failed: 1 }),
    stage({ key: 'publish', label: '게시', status: 'idle', done: 0, total: 5, failed: 0 }),
  ],
  ...over,
});

const session = (over: Partial<SessionSummaryDto> = {}): SessionSummaryDto => ({
  id: 's1',
  fileName: 'f.xlsx',
  totalRows: 12,
  createdCount: 5,
  failedCount: 3,
  status: 'completed',
  createdAt: '2026-07-30T00:00:00.000Z',
  commitStatus: 'completed',
  publishStatus: 'idle',
  publishedCount: 0,
  publishFailedCount: 0,
  commitError: null,
  publishError: null,
  invalidCount: 2,
  cancelRequestedAt: null,
  ...over,
});

describe('isProgressRunning', () => {
  it('진행 중인 단계가 하나라도 있으면 true', () => {
    expect(isProgressRunning(progress())).toBe(true);
  });
  it('모든 단계가 끝났으면 false — 폴링이 멈춘다', () => {
    expect(
      isProgressRunning(
        progress({ stages: [stage({ status: 'completed' }), stage({ key: 'publish', status: 'canceled' })] }),
      ),
    ).toBe(false);
  });
  it('queued 도 진행 중이다', () => {
    expect(isProgressRunning(progress({ stages: [stage({ status: 'queued' })] }))).toBe(true);
  });
  it('progress 가 없으면 false', () => {
    expect(isProgressRunning(undefined)).toBe(false);
  });
});

describe('isImportRunning', () => {
  it('progress 가 있으면 그쪽이 진실이다', () => {
    expect(isImportRunning(progress({ stages: [stage({ status: 'completed' })] }), session({ commitStatus: 'running' }))).toBe(false);
  });
  it('progress 가 없으면 세션 레인 상태로 폴백한다 — 롤링 배포 창', () => {
    expect(isImportRunning(undefined, session({ commitStatus: 'running' }))).toBe(true);
    expect(isImportRunning(undefined, session({ publishStatus: 'queued' }))).toBe(true);
    expect(isImportRunning(undefined, session())).toBe(false);
  });
  it('둘 다 없으면 false', () => {
    expect(isImportRunning(undefined, undefined)).toBe(false);
  });
});

describe('stagePercent', () => {
  it('done/total 을 반올림한 퍼센트', () => {
    expect(stagePercent(stage({ done: 1, total: 3 }))).toBe(33);
  });
  it('분모가 0 이면 0% 다 — 아직 분모가 없다는 뜻이지 완료가 아니다', () => {
    expect(stagePercent(stage({ done: 0, total: 0 }))).toBe(0);
  });
  it('100 을 넘지 않는다', () => {
    expect(stagePercent(stage({ done: 12, total: 10 }))).toBe(100);
  });
});

describe('visibleStages', () => {
  it('분모 0 인 단계는 접는다 — 이미지 없는 워크북의 probe/fetch 가 여기 걸린다', () => {
    const dto = progress({ stages: [stage({ key: 'commit', total: 10 }), stage({ key: 'publish', total: 0 })] });
    expect(visibleStages(dto).map((s) => s.key)).toEqual(['commit']);
  });

  it('분모 0 이어도 failed 로 확정된 단계는 접지 않는다 — 오류가 화면에서 사라지면 안 된다', () => {
    const dto = progress({
      stages: [
        stage({ key: 'commit', total: 0, status: 'failed', error: '10회 연속 실패' }),
        stage({ key: 'publish', total: 0, status: 'idle' }),
      ],
    });
    expect(visibleStages(dto).map((s) => s.key)).toEqual(['commit']);
  });

  it('분모 0 이고 정상 종료(completed)인 단계는 여전히 접는다', () => {
    const dto = progress({ stages: [stage({ key: 'commit', total: 0, status: 'completed' })] });
    expect(visibleStages(dto)).toEqual([]);
  });
});

describe('importCounts', () => {
  it('progress 가 있으면 집계에서 뽑는다', () => {
    const counts = importCounts(progress(), undefined);
    expect(counts).toEqual({
      totalRows: 12,
      created: 5, // commit.done 6 - commit.failed 1
      createdFailed: 1,
      invalid: 2,
      published: 0,
      publishFailed: 0,
    });
  });

  it('progress 가 없으면 세션 카운터로 폴백한다', () => {
    const counts = importCounts(undefined, session());
    expect(counts).toEqual({
      totalRows: 12,
      created: 5,
      createdFailed: 1, // failedCount 3 - invalidCount 2
      invalid: 2,
      published: 0,
      publishFailed: 0,
    });
  });

  it('invalidCount 가 null 인 옛 세션은 두 종류를 가르지 않는다', () => {
    const counts = importCounts(undefined, session({ invalidCount: null }));
    expect(counts).toMatchObject({ invalid: null, createdFailed: 3 });
  });

  it('둘 다 없으면 null', () => {
    expect(importCounts(undefined, undefined)).toBeNull();
  });
});
