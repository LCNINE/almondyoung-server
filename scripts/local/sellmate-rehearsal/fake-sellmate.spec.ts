import { renderUploadCsv } from '../../sellmate/reconcile/upload-csv';
import { readShelfCode } from '../../../apps/core/src/modules/inventory/core/shelf-code-reading';
import {
  applyUpload,
  kstIso,
  kstStamp,
  parseUploadCsv,
  positionFor,
  shipOrders,
  unshippedBySerial,
  type State,
} from './fake-sellmate';

const item = (barcode: string, current: number) => ({
  productCode: 'G',
  productSerial: 'RH-G',
  productName: 'n',
  optionName: 'o',
  barcode,
  barcode2: '',
  current,
  position: '',
});
const state = (): State => ({
  items: { A: item('111', 10), B: item('222', 5) },
  orders: [
    { channel: 'own', orderNo: '20261119-7', lines: [{ serial: 'A', qty: 2 }], state: 'unshipped' },
    {
      channel: 'mk',
      orderNo: 'NV-1',
      lines: [
        { serial: 'A', qty: 1 },
        { serial: 'B', qty: 1 },
      ],
      state: 'unshipped',
    },
    { channel: 'mk', orderNo: 'NV-0', lines: [{ serial: 'B', qty: 9 }], state: 'canceled' },
  ],
  marketSeq: 1,
  log: [],
});

describe('가짜 셀메이트', () => {
  it('미발송은 안 나간 주문만 센다', () => {
    expect(Object.fromEntries(unshippedBySerial(state()))).toEqual({ A: 3, B: 1 });
  });

  it('내보내면 현재재고와 미발송이 같이 준다 — 셀메이트 가용(현재 − 미발송)은 그대로', () => {
    const s = state();
    const before = s.items.A.current - (unshippedBySerial(s).get('A') ?? 0);
    shipOrders(s, [s.orders[0]]);
    expect(s.items.A.current).toBe(8);
    expect(s.items.A.current - (unshippedBySerial(s).get('A') ?? 0)).toBe(before);
  });

  it('업로드는 바코드번호의 현재재고를 덮고 못 찾은 바코드를 돌려준다', () => {
    const s = state();
    const lines = parseUploadCsv(
      renderUploadCsv([
        { barcode: '222', current: 3 },
        { barcode: '999', current: 1 },
      ]),
    );
    expect(applyUpload(s, lines)).toEqual(['999']);
    expect(s.items.B.current).toBe(3);
  });

  it('업로드 머리줄이 다르면 거절한다', () => {
    expect(() => parseUploadCsv('바코드,수량\r\n1,2\r\n')).toThrow('머리줄');
  });

  it('위치 텍스트가 런북 §5 의 갈래를 한 번씩은 낸다', () => {
    const kinds = new Set(
      Array.from({ length: 31 }, (_, i) => positionFor(i)).map((p) => {
        if (p === '') return 'empty';
        const r = readShelfCode(p);
        return r.kind === 'fixed' ? r.rule : r.kind;
      }),
    );
    expect(kinds).toEqual(new Set(['exact', 'dash-position', 'zero-pad', 'exception', 'empty']));
  });

  it('파일명 시각은 KST', () => {
    const at = new Date('2026-11-19T00:30:05Z');
    expect(kstStamp(at)).toBe('20261119_093005');
    expect(kstIso(at)).toBe('2026-11-19T09:30:05+09:00');
  });
});
