import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { createOperationStore, type StoredOperation } from './operationStore';
import { createOperationRunner } from './operationRunner';
import type { WorkRuntime } from './OperationContext';
import type { ApiClient } from '../data/httpClient';
import { rememberBoxLabel } from './boxChecks';
import {
  REPORT_DEBOUNCE_MS,
  REPORT_INTERVAL_MS,
  nextReportSeq,
  reportableOperations,
  useDeviceWorkReport,
} from './deviceWorkReport';

type Request = Parameters<ApiClient['request']>[0];

const op = (over: Partial<StoredOperation>): StoredOperation => ({
  id: 'k1',
  scope: 's',
  resource: 'r',
  method: 'POST',
  path: '/inbound/simple',
  bodyJson: JSON.stringify({ productBarcode: '880000000001', quantity: 3 }),
  createdAt: Date.UTC(2026, 10, 26, 1, 0, 0),
  status: 'uncertain',
  attempts: 4,
  ...over,
});

describe('올릴 결과 모름 고르기', () => {
  it('응답을 못 받은 것만 올리고 대기·첫 전송은 뺀다', () => {
    const list = reportableOperations(
      [
        op({ id: 'lost' }),
        op({ id: 'retrying', status: 'sending', attempts: 2 }),
        op({ id: 'first-send', status: 'sending', attempts: 1 }),
        op({ id: 'queued', status: 'queued', attempts: 0 }),
      ],
      undefined
    );
    expect(list.map((o) => o.operationKey)).toEqual(['lost', 'retrying']);
  });

  it('작업 이름과 대상, 기기 기록 시각을 붙인다', () => {
    const [reported] = reportableOperations(
      [op({ summary: '데모 상품 11 ×3', errorCode: 'Internal' })],
      undefined
    );
    expect(reported).toEqual({
      operationKey: 'k1',
      method: 'POST',
      path: '/inbound/simple',
      workName: '입고',
      summary: '데모 상품 11 ×3',
      status: 'uncertain',
      attempts: 4,
      errorCode: 'Internal',
      recordedAt: '2026-11-26T01:00:00.000Z',
    });
  });

  it('출고 스캔은 송장과 찍은 상품 이름으로 말한다', () => {
    const [reported] = reportableOperations(
      [
        op({
          path: '/shipments/box-1/simple-outbound-scans',
          bodyJson: JSON.stringify({ barcode: '880000000002', quantity: 1 }),
        }),
      ],
      {
        'box-1': {
          trackingNo: '512345678901',
          items: { '880000000002': '데모 상품 12' },
        },
      }
    );
    expect(reported.workName).toBe('출고');
    expect(reported.summary).toBe('송장 512345678901 · 데모 상품 12 ×1');
  });
});

describe('서버에 올리기', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function setup(answer: (o: Request) => unknown) {
    const store = createOperationStore(crypto.randomUUID());
    const sent: Request[] = [];
    const api: ApiClient = {
      request: async <T,>(o: Request) => {
        sent.push(o);
        return answer(o) as T;
      },
    };
    const runner = createOperationRunner({
      api,
      store,
      getScope: async () => 'scope-a',
      wait: async () => {},
    });
    const runtime: WorkRuntime = {
      runner,
      store,
      getScope: async () => 'scope-a',
    };
    return { store, sent, runtime };
  }

  const reports = (sent: Request[]) =>
    sent.filter((o) => o.path.endsWith('/unresolved-operations'));

  it('앱을 켜면 남은 것이 없어도 한 번 올리고, 받아 주면 더 보내지 않는다', async () => {
    const { sent, runtime } = await setup(() => ({ decided: [] }));
    renderHook(() =>
      useDeviceWorkReport({
        runtime,
        operations: [],
        scope: 'scope-a',
        station: true,
        workerName: async () => '김현장',
      })
    );
    await act(() => vi.advanceTimersByTimeAsync(REPORT_DEBOUNCE_MS + 10));
    expect(reports(sent)).toHaveLength(1);
    expect(reports(sent)[0]).toMatchObject({
      method: 'PUT',
      body: { deviceKind: 'station', workerName: '김현장', operations: [] },
    });
    await act(() => vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS * 2));
    expect(reports(sent)).toHaveLength(1);
  });

  it('기기 번호는 한 번 만들어 계속 쓴다', async () => {
    const { sent, runtime } = await setup(() => ({ decided: [] }));
    const { rerender } = renderHook(
      ({ ops }) =>
        useDeviceWorkReport({
          runtime,
          operations: ops,
          scope: 'scope-a',
          station: false,
          workerName: async () => undefined,
        }),
      { initialProps: { ops: [] as StoredOperation[] } }
    );
    await act(() => vi.advanceTimersByTimeAsync(REPORT_DEBOUNCE_MS + 10));
    rerender({ ops: [op({ id: 'lost' })] });
    await act(() => vi.advanceTimersByTimeAsync(REPORT_DEBOUNCE_MS + 10));
    const [first, second] = reports(sent);
    expect(second.path).toBe(first.path);
    expect(second.body).toMatchObject({
      deviceKind: 'handheld',
      operations: [{ operationKey: 'lost' }],
    });
    expect(second.body).not.toHaveProperty('workerName');
  });

  it('보고 번호는 뒤에 보낸 것이 더 크다 — 시계가 그대로여도', () => {
    vi.setSystemTime(new Date('2026-11-26T01:00:00.000Z'));
    const a = nextReportSeq();
    const b = nextReportSeq();
    vi.setSystemTime(new Date('2026-11-26T00:00:00.000Z'));
    const c = nextReportSeq();
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('앞 보고가 끝나기 전에는 다음 보고를 보내지 않는다', async () => {
    let finishFirst!: () => void;
    let calls = 0;
    const { sent, runtime } = await setup(() => {
      calls += 1;
      if (calls === 1)
        return new Promise((resolve) => {
          finishFirst = () => resolve({ decided: [] });
        });
      return { decided: [] };
    });
    const { rerender } = renderHook(
      ({ ops }) =>
        useDeviceWorkReport({
          runtime,
          operations: ops,
          scope: 'scope-a',
          station: true,
          workerName: async () => undefined,
        }),
      { initialProps: { ops: [] as StoredOperation[] } }
    );
    await act(() => vi.advanceTimersByTimeAsync(REPORT_DEBOUNCE_MS + 10));
    rerender({ ops: [op({ id: 'lost' })] });
    await act(() => vi.advanceTimersByTimeAsync(REPORT_DEBOUNCE_MS + 10));
    expect(reports(sent)).toHaveLength(1);
    await act(async () => finishFirst());
    await vi.waitFor(() => expect(reports(sent)).toHaveLength(2));
    const [first, second] = reports(sent).map(
      (o) => (o.body as { reportSeq: number }).reportSeq
    );
    expect(second).toBeGreaterThan(first);
  });

  it('보내지 못하면 다음 주기에 다시 보낸다', async () => {
    let fail = true;
    const { sent, runtime } = await setup(() => {
      if (fail) throw new TypeError('offline');
      return { decided: [] };
    });
    renderHook(() =>
      useDeviceWorkReport({
        runtime,
        operations: [],
        scope: 'scope-a',
        station: true,
        workerName: async () => undefined,
      })
    );
    await act(() => vi.advanceTimersByTimeAsync(REPORT_DEBOUNCE_MS + 10));
    fail = false;
    await act(() => vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS));
    expect(reports(sent)).toHaveLength(2);
    await act(() => vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS));
    expect(reports(sent)).toHaveLength(2);
  });

  it('로그인 범위나 기기 종류를 모르면 보내지 않는다', async () => {
    const { sent, runtime } = await setup(() => ({ decided: [] }));
    renderHook(() =>
      useDeviceWorkReport({
        runtime,
        operations: [op({})],
        scope: 'scope-a',
        station: null,
        workerName: async () => undefined,
      })
    );
    await act(() => vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS + 10));
    expect(reports(sent)).toHaveLength(0);
  });

  it('서버가 결과가 정해졌다고 한 키는 같은 키로 한 번만 다시 확인한다', async () => {
    const { store, sent, runtime } = await setup((o) => {
      if (o.path.endsWith('/unresolved-operations'))
        return { decided: ['lost', 'someone-else'] };
      // 다시 확인해도 응답을 못 받는다 — 결과 모름이 그대로 남는다
      throw new TypeError('lost again');
    });
    await store.begin({
      id: 'lost',
      scope: 'scope-a',
      resource: '/inbound/simple:w',
      method: 'POST',
      path: '/inventory/stocks/adjust',
      bodyJson: JSON.stringify({
        skuId: 's',
        warehouseId: 'w',
        locationId: 'l',
        delta: 1,
        reason: 'r',
        contractVersion: 2,
        idempotencyKey: 'lost',
      }),
      createdAt: Date.now(),
    });
    await store.finish('lost', 'uncertain');
    const saved = (await store.get('lost'))!;
    const { rerender } = renderHook(
      ({ ops }) =>
        useDeviceWorkReport({
          runtime,
          operations: ops,
          scope: 'scope-a',
          station: true,
          workerName: async () => undefined,
        }),
      { initialProps: { ops: [saved] } }
    );
    await act(() => vi.advanceTimersByTimeAsync(REPORT_DEBOUNCE_MS + 10));
    await vi.waitFor(async () =>
      expect((await store.get('lost'))?.attempts).toBe(4)
    );
    const rechecks = () =>
      sent.filter((o) => o.idempotencyKey === 'lost').length;
    expect(rechecks()).toBe(4);
    // 목록이 바뀌어 다시 올려도 이미 확인한 키는 또 보내지 않는다(끝없이 다시 보내지 않게)
    rerender({ ops: [{ ...saved, attempts: 9 }] });
    await act(() => vi.advanceTimersByTimeAsync(REPORT_DEBOUNCE_MS + 10));
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(reports(sent)).toHaveLength(2);
    expect(rechecks()).toBe(4);
  });

  it('출고 스캔은 박스 화면이 남긴 송장·상품 이름을 함께 올린다', async () => {
    const { store, sent, runtime } = await setup(() => ({ decided: [] }));
    await rememberBoxLabel(store, 'scope-a', 'box-1', {
      trackingNo: '512345678901',
      items: { '880000000002': '데모 상품 12' },
    });
    renderHook(() =>
      useDeviceWorkReport({
        runtime,
        operations: [
          op({
            path: '/shipments/box-1/simple-outbound-scans',
            bodyJson: JSON.stringify({ barcode: '880000000002', quantity: 1 }),
          }),
        ],
        scope: 'scope-a',
        station: true,
        workerName: async () => undefined,
      })
    );
    await act(() => vi.advanceTimersByTimeAsync(REPORT_DEBOUNCE_MS + 10));
    expect(reports(sent)[0].body).toMatchObject({
      operations: [{ summary: '송장 512345678901 · 데모 상품 12 ×1' }],
    });
  });
});
