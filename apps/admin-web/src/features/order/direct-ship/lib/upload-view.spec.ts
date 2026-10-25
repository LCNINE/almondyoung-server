import type { SupplierRowVerdict, SupplierSheetVerdictCounts } from '@/lib/types/dto/fulfillment';
import {
  PREVIEW_STALE_MESSAGE,
  applyGate,
  appliedSummaryText,
  isPreviewStaleError,
  previewRowsErrorsFirst,
  verdictCountsText,
} from './upload-view';

const ZERO: SupplierSheetVerdictCounts = {
  ship: 0,
  merge: 0,
  unfulfillable: 0,
  waiting: 0,
  correct: 0,
  unchanged: 0,
  error: 0,
};
const v = (rowNumber: number, verdict: SupplierRowVerdict['verdict']): SupplierRowVerdict => ({
  rowNumber,
  rowKey: `k-${rowNumber}`,
  orderNo: `o-${rowNumber}`,
  verdict,
});

describe('previewRowsErrorsFirst', () => {
  it('오류 줄을 먼저, 안에서는 행 번호 순', () => {
    const rows = [v(2, 'ship'), v(5, 'error'), v(3, 'waiting'), v(4, 'error')];
    expect(previewRowsErrorsFirst(rows).map((r) => r.rowNumber)).toEqual([4, 5, 2, 3]);
  });
  it('입력을 바꾸지 않는다', () => {
    const rows = [v(3, 'ship'), v(2, 'error')];
    previewRowsErrorsFirst(rows);
    expect(rows.map((r) => r.rowNumber)).toEqual([3, 2]);
  });
});

describe('verdictCountsText', () => {
  it('0 인 판정은 숨기고 정해진 순서로 잇는다', () => {
    expect(verdictCountsText({ ...ZERO, error: 2, ship: 3, unchanged: 1 })).toBe('발송 3 · 변경 없음 1 · 오류 2');
  });
  it('모두 0 이면 빈 문자열', () => {
    expect(verdictCountsText(ZERO)).toBe('');
  });
});

describe('applyGate', () => {
  it('쓸 줄이 0 이면 막는다', () => {
    expect(applyGate({ ...ZERO, waiting: 3, error: 1 })).toEqual({
      disabled: true,
      errorNote: '오류 1줄은 적용되지 않습니다',
    });
  });
  it('오류가 있어도 쓸 줄이 있으면 열린다', () => {
    expect(applyGate({ ...ZERO, ship: 1, error: 2 })).toEqual({
      disabled: false,
      errorNote: '오류 2줄은 적용되지 않습니다',
    });
  });
  it('오류가 없으면 안내도 없다', () => {
    expect(applyGate({ ...ZERO, correct: 1 })).toEqual({ disabled: false, errorNote: null });
  });
});

describe('isPreviewStaleError', () => {
  it('409 SUPPLIER_UPLOAD_PREVIEW_STALE 를 알아본다', () => {
    const error = Object.assign(new Error('stale'), {
      statusCode: 409,
      response: { status: 409, data: { code: 'SUPPLIER_UPLOAD_PREVIEW_STALE', message: '...' } },
    });
    expect(isPreviewStaleError(error)).toBe(true);
  });
  it('다른 코드·모양은 아니다', () => {
    expect(isPreviewStaleError({ response: { status: 409, data: { code: 'OTHER' } } })).toBe(false);
    expect(isPreviewStaleError(new Error('x'))).toBe(false);
    expect(isPreviewStaleError(null)).toBe(false);
  });
  it('문구', () => {
    expect(PREVIEW_STALE_MESSAGE).toBe('미리보기 뒤에 바뀐 것이 있습니다. 다시 미리보기 하세요.');
  });
});

describe('appliedSummaryText', () => {
  it('발송한 상자 수', () => {
    expect(appliedSummaryText({ counts: ZERO, shippedShipmentIds: ['a', 'b'] })).toBe('발송 2상자');
    expect(appliedSummaryText({ counts: ZERO, shippedShipmentIds: [] })).toBe('발송 0상자');
  });
});
