import {
  ProductImportProgressBuilder,
  type ImportItemStatusCount,
  type ProgressSessionRow,
} from './product-import-progress.builder';
import type { ImportProgressDto } from '../dto/import-progress.dto';

const session = (over: Partial<ProgressSessionRow> = {}): ProgressSessionRow => ({
  id: 'sess-1',
  fileName: 'f.xlsx',
  totalRows: 10,
  invalidCount: 2,
  commitStatus: 'running',
  publishStatus: 'idle',
  commitError: null,
  publishError: null,
  cancelRequestedAt: null,
  ...over,
});

const c = (
  status: ImportItemStatusCount['status'],
  publishStatus: ImportItemStatusCount['publishStatus'],
  count: number,
): ImportItemStatusCount => ({ status, publishStatus, count });

const stageOf = (dto: ImportProgressDto, key: string) => dto.stages.find((s) => s.key === key)!;

describe('ProductImportProgressBuilder', () => {
  const builder = new ProductImportProgressBuilder();

  it('commit 분모에서 접수 시점 검증실패 행을 뺀다', () => {
    // 10행 중 2행이 접수 시점 검증실패. 남은 8행 중 3행이 생성됐고 5행이 대기 중.
    const dto = builder.build(session(), [
      c('failed', 'skipped', 2),
      c('created', 'pending', 3),
      c('pending', 'pending', 5),
    ]);

    expect(stageOf(dto, 'commit')).toMatchObject({ total: 8, done: 3, failed: 0 });
  });

  it('생성 실패는 검증실패를 뺀 나머지다 — 두 종류가 한 칸에 섞이지 않는다', () => {
    // failed 4행 = 검증실패 2 + 생성실패 2
    const dto = builder.build(session(), [c('failed', 'skipped', 4), c('created', 'pending', 6)]);

    expect(stageOf(dto, 'commit')).toMatchObject({ total: 8, done: 8, failed: 2 });
  });

  it('invalidCount 가 null 인 옛 세션은 검증실패를 가르지 않고 현행 표시로 폴백한다', () => {
    const dto = builder.build(session({ invalidCount: null }), [
      c('failed', 'skipped', 4),
      c('created', 'published', 6),
    ]);

    expect(stageOf(dto, 'commit')).toMatchObject({ total: 10, done: 10, failed: 4 });
    expect(dto.invalidCount).toBeNull();
  });

  it('publish 분모는 생성된 행 수이고 skipped 행은 들어가지 않는다', () => {
    const dto = builder.build(session({ commitStatus: 'completed', publishStatus: 'running' }), [
      c('failed', 'skipped', 2),
      c('created', 'published', 3),
      c('created', 'failed', 1),
      c('created', 'pending', 4),
    ]);

    // 생성 8행이 분모. published 3 + failed 1 = 4 처리됨.
    expect(stageOf(dto, 'publish')).toMatchObject({ total: 8, done: 4, failed: 1 });
  });

  it('레인 상태와 오류를 단계에 그대로 싣는다', () => {
    const dto = builder.build(
      session({
        commitStatus: 'failed',
        commitError: '10회 연속 실패',
        publishStatus: 'canceled',
        publishError: null,
      }),
      [],
    );

    expect(stageOf(dto, 'commit')).toMatchObject({ status: 'failed', error: '10회 연속 실패' });
    expect(stageOf(dto, 'publish')).toMatchObject({ status: 'canceled', error: null });
  });

  it('취소 요청이 있으면 canceled 가 true 다', () => {
    const at = new Date('2026-07-30T00:00:00.000Z');
    const dto = builder.build(session({ cancelRequestedAt: at }), []);

    expect(dto.canceled).toBe(true);
    expect(dto.cancelRequestedAt).toBe(at);
  });

  it('행이 하나도 없으면 분모가 0 이다', () => {
    const dto = builder.build(session({ totalRows: 0, invalidCount: 0 }), []);

    expect(stageOf(dto, 'commit')).toMatchObject({ total: 0, done: 0, failed: 0 });
    expect(stageOf(dto, 'publish')).toMatchObject({ total: 0, done: 0, failed: 0 });
  });

  it('failed 행이 invalidCount 보다 적어도 음수로 새지 않는다', () => {
    const dto = builder.build(session({ invalidCount: 5 }), [
      c('failed', 'skipped', 1),
      c('created', 'pending', 4),
    ]);

    expect(stageOf(dto, 'commit').failed).toBe(0);
  });

  it('세션 식별 정보를 그대로 통과시킨다', () => {
    const dto = builder.build(session(), []);

    expect(dto).toMatchObject({ sessionId: 'sess-1', fileName: 'f.xlsx', totalRows: 10, invalidCount: 2 });
  });
});
