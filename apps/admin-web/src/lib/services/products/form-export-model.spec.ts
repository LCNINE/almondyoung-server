import {
  formExportListRefetchInterval,
  formExportRowState,
} from './form-export-model';
import type { FormExportSummary } from '@/lib/types/dto/form-export';

function item(over: Partial<FormExportSummary> = {}): FormExportSummary {
  return {
    exportId: 'E1',
    status: 'queued',
    requestedCount: 3,
    productCount: 0,
    errorMessage: null,
    consecutiveFailures: 0,
    downloadable: false,
    createdAt: '2026-08-06T00:00:00.000Z',
    expiresAt: '2026-09-05T00:00:00.000Z',
    ...over,
  };
}

describe('양식 생성 목록 폴링 간격', () => {
  it('데이터가 아직 없으면 계속 두드린다', () => {
    expect(formExportListRefetchInterval(undefined)).toBe(5000);
  });

  it('진행 중 항목이 하나라도 있으면 계속 두드린다', () => {
    const list = {
      data: [item({ status: 'completed' }), item({ status: 'running' })],
      total: 2,
      page: 1,
      limit: 20,
    };
    expect(formExportListRefetchInterval(list)).toBe(5000);
  });

  it('전부 종결이면 멈춘다', () => {
    const list = {
      data: [item({ status: 'completed' }), item({ status: 'failed' })],
      total: 2,
      page: 1,
      limit: 20,
    };
    expect(formExportListRefetchInterval(list)).toBe(false);
  });

  it('빈 목록이면 멈춘다', () => {
    expect(
      formExportListRefetchInterval({ data: [], total: 0, page: 1, limit: 20 })
    ).toBe(false);
  });
});

describe('양식 생성 행 상태 판정', () => {
  it('queued 는 대기 중이고 액션이 없다', () => {
    expect(formExportRowState(item({ status: 'queued' }))).toEqual({
      label: '대기 중',
      tone: 'pending',
      action: 'none',
    });
  });

  it('running 이고 실패가 없으면 생성 중이다', () => {
    expect(formExportRowState(item({ status: 'running' }))).toEqual({
      label: '생성 중',
      tone: 'progress',
      action: 'none',
    });
  });

  it('running 인데 연속 실패가 있으면 재시도 대기 중이다', () => {
    expect(
      formExportRowState(item({ status: 'running', consecutiveFailures: 2 }))
    ).toEqual({
      label: '재시도 대기 중 (2/3)',
      tone: 'error',
      action: 'none',
    });
  });

  it('완료면 다운로드를 준다', () => {
    expect(
      formExportRowState(
        item({ status: 'completed', downloadable: true, productCount: 3 })
      )
    ).toEqual({
      label: '완료',
      tone: 'done',
      action: 'download',
    });
  });

  it('completed 인데 파일이 없으면 다운로드를 주지 않는다', () => {
    expect(
      formExportRowState(item({ status: 'completed', downloadable: false }))
    ).toEqual({
      label: '완료 (파일 없음)',
      tone: 'error',
      action: 'none',
    });
  });

  it('실패면 다시 시도를 준다', () => {
    expect(
      formExportRowState(item({ status: 'failed', errorMessage: 'boom' }))
    ).toEqual({
      label: '실패',
      tone: 'error',
      action: 'retry',
    });
  });
});
