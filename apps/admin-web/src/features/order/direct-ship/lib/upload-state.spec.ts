import type { SupplierSheetApplyResult, SupplierSheetPreview } from '@/lib/types/dto/fulfillment';
import { INITIAL_UPLOAD_STATE, uploadReducer } from './upload-state';

const COUNTS = { ship: 1, merge: 0, unfulfillable: 0, waiting: 0, correct: 0, unchanged: 0, error: 0 };
const PREVIEW: SupplierSheetPreview = {
  rows: [{ rowNumber: 2, rowKey: 'foi-1', orderNo: '1', verdict: 'ship', carrier: 'CJ', trackingNo: '1' }],
  counts: COUNTS,
  token: 'tok-1',
};
const RESULT: SupplierSheetApplyResult = { counts: COUNTS, shippedShipmentIds: ['sh-1'] };
const fileA = new File(['a'], 'a.xlsx');
const fileB = new File(['b'], 'b.xlsx');

describe('uploadReducer', () => {
  it('처음은 비어 있다', () => {
    expect(INITIAL_UPLOAD_STATE).toEqual({ file: null, preview: null, result: null, stale: false });
  });

  it('미리보기 뒤 다른 파일을 고르면 미리보기·결과가 지워진다(옛 토큰으로 새 파일을 보내지 않는다)', () => {
    let s = uploadReducer(INITIAL_UPLOAD_STATE, { type: 'fileChosen', file: fileA });
    s = uploadReducer(s, { type: 'previewed', file: fileA, preview: PREVIEW });
    s = uploadReducer(s, { type: 'applied', result: RESULT });
    s = uploadReducer(s, { type: 'fileChosen', file: fileB });
    expect(s).toEqual({ file: fileB, preview: null, result: null, stale: false });
  });

  it('409 STALE 이면 미리보기를 지우고 stale 을 켠다, 파일은 남긴다', () => {
    let s = uploadReducer(INITIAL_UPLOAD_STATE, { type: 'fileChosen', file: fileA });
    s = uploadReducer(s, { type: 'previewed', file: fileA, preview: PREVIEW });
    s = uploadReducer(s, { type: 'staleRejected' });
    expect(s).toEqual({ file: fileA, preview: null, result: null, stale: true });
  });

  it('다시 미리보기 하면 stale 이 꺼진다', () => {
    let s = uploadReducer(INITIAL_UPLOAD_STATE, { type: 'fileChosen', file: fileA });
    s = uploadReducer(s, { type: 'staleRejected' });
    s = uploadReducer(s, { type: 'previewed', file: fileA, preview: PREVIEW });
    expect(s.stale).toBe(false);
    expect(s.preview).toBe(PREVIEW);
  });

  it('적용 결과를 담는다', () => {
    let s = uploadReducer(INITIAL_UPLOAD_STATE, { type: 'fileChosen', file: fileA });
    s = uploadReducer(s, { type: 'previewed', file: fileA, preview: PREVIEW });
    s = uploadReducer(s, { type: 'applied', result: RESULT });
    expect(s.result).toBe(RESULT);
  });

  it('늦게 온 파일 A 의 미리보기는 파일 B 에 붙지 않는다', () => {
    let s = uploadReducer(INITIAL_UPLOAD_STATE, { type: 'fileChosen', file: fileA });
    s = uploadReducer(s, { type: 'fileChosen', file: fileB });
    s = uploadReducer(s, { type: 'previewed', file: fileA, preview: PREVIEW });
    expect(s).toEqual({ file: fileB, preview: null, result: null, stale: false });
  });

  it('적용이 끝나면 미리보기(토큰)를 지운다 — 같은 토큰으로 두 번 적용하지 않는다', () => {
    let s = uploadReducer(INITIAL_UPLOAD_STATE, { type: 'fileChosen', file: fileA });
    s = uploadReducer(s, { type: 'previewed', file: fileA, preview: PREVIEW });
    s = uploadReducer(s, { type: 'applied', result: RESULT });
    expect(s.preview).toBeNull();
    expect(s.file).toBe(fileA);
  });

  it('reset 은 처음으로', () => {
    let s = uploadReducer(INITIAL_UPLOAD_STATE, { type: 'fileChosen', file: fileA });
    s = uploadReducer(s, { type: 'staleRejected' });
    expect(uploadReducer(s, { type: 'reset' })).toEqual(INITIAL_UPLOAD_STATE);
  });
});
