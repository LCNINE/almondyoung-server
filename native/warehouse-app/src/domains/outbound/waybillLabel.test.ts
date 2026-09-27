import { describe, expect, it, vi } from 'vitest';
import { ApiError, ConflictError } from '../../core/data/httpClient';
import type { ApiClient } from '../../core/data/httpClient';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { PrinterError } from '../../core/hardware/print/labelPrinter';
import {
  EmptyLabelError,
  fetchBatchWorkItems,
  fetchWaybillLabel,
  labelErrorMessage,
  printOneLabel,
  printableShipmentIds,
  readBatchPrintedAt,
  retryTargets,
  runBatchLabelPrint,
  waybillConflictCode,
  writeBatchPrintedAt,
  type WaybillLabel,
} from './waybillLabel';

// core 가 실제로 내는 메시지 모양(waybill.manager.ts · waybill-label.manager.ts). 접두어가 계약이다.
const NOT_DISPATCHABLE = new ConflictError(
  'WAYBILL_NOT_DISPATCHABLE: shipment s1 needs one registered waybill',
  'CONFLICT'
);
const STALE = new ConflictError(
  'WAYBILL_STALE: waybill w1 manifest/recipient changed between guard and assembly',
  'CONFLICT'
);
const UNAVAILABLE = new ConflictError(
  'WAYBILL_LABEL_UNAVAILABLE: manual waybill w1 has no carrier label data',
  'CONFLICT'
);

const label = (shipmentId: string): WaybillLabel => ({
  waybillId: `w-${shipmentId}`,
  trackingNo: `T-${shipmentId}`,
  format: 'zpl',
  data: `^XA${shipmentId}^XZ`,
});

describe('API 호출', () => {
  it('라벨과 work-items 경로', async () => {
    const paths: string[] = [];
    const api: ApiClient = {
      request: (async (o: { path: string }) => {
        paths.push(o.path);
        return o.path.endsWith('/label') ? label('s1') : [];
      }) as unknown as ApiClient['request'],
    };
    await fetchWaybillLabel(api, 's1');
    await fetchBatchWorkItems(api, 'b1');
    expect(paths).toEqual([
      '/shipments/s1/waybill/label',
      '/outbound-batches/b1/work-items',
    ]);
  });

  it('completed·excluded 는 인쇄 대상에서 빼고 순서를 유지한다', () => {
    expect(
      printableShipmentIds([
        { id: '1', shipmentId: 'a', status: 'queued' },
        { id: '2', shipmentId: 'b', status: 'completed' },
        { id: '3', shipmentId: 'c', status: 'packing' },
        { id: '4', shipmentId: 'd', status: 'excluded' },
        { id: '5', shipmentId: 'e', status: 'short_pick_recovery' },
      ])
    ).toEqual(['a', 'c', 'e']);
  });
});

describe('409 접두어와 현장 문구', () => {
  it('core 메시지의 접두어를 뽑는다', () => {
    expect(waybillConflictCode(STALE)).toBe('WAYBILL_STALE');
    expect(waybillConflictCode(new ConflictError('version conflict'))).toBeUndefined();
    expect(waybillConflictCode(new Error('WAYBILL_STALE: x'))).toBeUndefined();
  });

  it.each([
    [NOT_DISPATCHABLE, '한진 등록이 끝나지 않은 송장이에요. 관리자에게 운송장 발급 상태를 확인해 달라고 해 주세요.'],
    [STALE, '주문(주소·상품)이 바뀌어 이 송장은 쓸 수 없어요. 관리자에게 재발급을 요청해 주세요.'],
    [UNAVAILABLE, '이 송장은 앱에서 인쇄할 수 없어요(수기 등록 또는 한진 외 택배사).'],
    [new ConflictError('WAYBILL_SOMETHING_NEW: x', 'CONFLICT'), '송장 상태가 바뀌었어요. 관리자에게 문의해 주세요.'],
    [new ConflictError('no prefix at all', 'CONFLICT'), '송장 상태가 바뀌었어요. 관리자에게 문의해 주세요.'],
    [new ApiError('GET /shipments/s1/waybill/label → 404', 404, 'NOT_FOUND'), '출고 정보를 찾을 수 없어요.'],
    [new Error('GET /shipments/s1/waybill/label → 404'), '출고 정보를 찾을 수 없어요.'],
    [new ApiError('GET /x → 500', 500, 'INTERNAL_SERVER_ERROR'), '라벨을 만들지 못했어요(서버 문제). 관리자에게 알려 주세요.'],
    [new EmptyLabelError('empty'), '라벨을 만들지 못했어요(서버 문제). 관리자에게 알려 주세요.'],
    [new PrinterError('OpenPrinterW failed'), '프린터로 보내지 못했어요. 전원·연결과 설정의 프린터 이름을 확인해 주세요.'],
    [new Error('GET /x → 401'), '권한이 없어요. 다시 로그인해 주세요.'],
  ])('%s → 문구', (error, expected) => {
    expect(labelErrorMessage(error)).toBe(expected);
  });
});

describe('printOneLabel', () => {
  it('받은 data 를 그대로 target 으로 보낸다 (format 은 보지 않는다)', async () => {
    const print = vi.fn(async () => {});
    const got = await printOneLabel(
      {
        fetchLabel: async () => ({ ...label('s1'), format: 'tspl' }),
        print,
        target: 'spooler://XP',
      },
      's1'
    );
    expect(print).toHaveBeenCalledWith('spooler://XP', '^XAs1^XZ');
    expect(got.trackingNo).toBe('T-s1');
  });

  it('빈 data 는 프린터로 보내지 않고 EmptyLabelError', async () => {
    const print = vi.fn(async () => {});
    await expect(
      printOneLabel(
        { fetchLabel: async () => ({ ...label('s1'), data: '' }), print, target: 't' },
        's1'
      )
    ).rejects.toBeInstanceOf(EmptyLabelError);
    expect(print).not.toHaveBeenCalled();
  });
});

describe('runBatchLabelPrint', () => {
  it('전부 성공하면 순서대로 찍고 진행을 건마다 알린다', async () => {
    const printed: string[] = [];
    const progress: Array<[number, number]> = [];
    const result = await runBatchLabelPrint({
      shipmentIds: ['a', 'b', 'c'],
      target: 't',
      fetchLabel: async (id) => label(id),
      print: async (_t, text) => {
        printed.push(text);
      },
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(printed).toEqual(['^XAa^XZ', '^XAb^XZ', '^XAc^XZ']);
    expect(result).toEqual({ printed: ['a', 'b', 'c'], skipped: [], notAttempted: [] });
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('API 거절은 그 건만 건너뛰고 계속한다', async () => {
    const result = await runBatchLabelPrint({
      shipmentIds: ['a', 'b', 'c'],
      target: 't',
      fetchLabel: async (id) => {
        if (id === 'b') throw STALE;
        return label(id);
      },
      print: async () => {},
    });
    expect(result.printed).toEqual(['a', 'c']);
    expect(result.skipped).toEqual([
      { shipmentId: 'b', message: '주문(주소·상품)이 바뀌어 이 송장은 쓸 수 없어요. 관리자에게 재발급을 요청해 주세요.' },
    ]);
    expect(result.notAttempted).toEqual([]);
  });

  it('빈 라벨은 프린터 오류로 오인하지 않고 그 건만 건너뛴다', async () => {
    const result = await runBatchLabelPrint({
      shipmentIds: ['a', 'b'],
      target: 't',
      fetchLabel: async (id) => (id === 'a' ? { ...label(id), data: '' } : label(id)),
      print: async () => {},
    });
    expect(result.printed).toEqual(['b']);
    expect(result.skipped.map((s) => s.shipmentId)).toEqual(['a']);
    expect(result.printerError).toBeUndefined();
  });

  it('프린터 실패면 즉시 멈추고 그 건부터 나머지를 notAttempted 로 둔다', async () => {
    const fetched: string[] = [];
    const result = await runBatchLabelPrint({
      shipmentIds: ['a', 'b', 'c', 'd'],
      target: 't',
      fetchLabel: async (id) => {
        fetched.push(id);
        return label(id);
      },
      print: async (_t, text) => {
        if (text === '^XAb^XZ') throw new PrinterError('OpenPrinterW failed');
      },
    });
    expect(result.printed).toEqual(['a']);
    expect(result.notAttempted).toEqual(['b', 'c', 'd']);
    expect(result.printerError).toBe('OpenPrinterW failed');
    expect(fetched).toEqual(['a', 'b']);
  });

  it('동시에 두 건을 부르지 않는다', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await runBatchLabelPrint({
      shipmentIds: ['a', 'b', 'c'],
      target: 't',
      fetchLabel: async (id) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        return label(id);
      },
      print: async () => {},
    });
    expect(maxInFlight).toBe(1);
  });

  it('retryTargets 는 실패·미인쇄를 원래 순서로 돌려준다', () => {
    expect(
      retryTargets({
        printed: ['a'],
        skipped: [{ shipmentId: 'b', message: 'x' }],
        notAttempted: ['c', 'd'],
        printerError: 'p',
      })
    ).toEqual(['b', 'c', 'd']);
  });
});

describe('배치 인쇄 기록', () => {
  it('배치별로 이 기기의 마지막 인쇄 시각을 저장한다', () => {
    const prefs = createMemoryPrefs();
    expect(readBatchPrintedAt(prefs, 'b1')).toBeNull();
    writeBatchPrintedAt(prefs, 'b1', '2026-09-27T00:12:00.000Z');
    expect(readBatchPrintedAt(prefs, 'b1')).toBe('2026-09-27T00:12:00.000Z');
    expect(prefs.get('almondwms.labelPrinter.batch.b1')).toBe('2026-09-27T00:12:00.000Z');
    expect(readBatchPrintedAt(prefs, 'b2')).toBeNull();
  });
});
