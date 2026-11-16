/**
 * 닫기 판정 회귀 테스트 (DB 불필요).
 * 설계 문서 판정 표의 한 줄마다 it 하나.
 */
import { confirmedBaseline, isFixPending, isOkVerdict, judgeClose } from './close-verdict';

describe('judgeClose (닫기 판정 표)', () => {
  it('현재·미발송 모두 그대로거나 주문만 늘었으면 ok_new_orders', () => {
    expect(judgeClose({ uploadedCurrent: 10, refUnshipped: 4, now: { current: 10, unshipped: 6 } })).toEqual({
      verdict: 'ok_new_orders',
      correctedCurrent: null,
    });
    expect(judgeClose({ uploadedCurrent: 10, refUnshipped: 4, now: { current: 10, unshipped: 4 } })).toEqual({
      verdict: 'ok_new_orders',
      correctedCurrent: null,
    });
  });
  it('현재·미발송이 같이 줄었으면 업로드 뒤 출고로 보고 ok_shipped_after', () => {
    expect(judgeClose({ uploadedCurrent: 10, refUnshipped: 4, now: { current: 8, unshipped: 2 } })).toEqual({
      verdict: 'ok_shipped_after',
      correctedCurrent: null,
    });
  });
  it('현재만 늘었으면 업로드 뒤 반품으로 보고 ok_return_after', () => {
    expect(judgeClose({ uploadedCurrent: 10, refUnshipped: 4, now: { current: 11, unshipped: 4 } })).toEqual({
      verdict: 'ok_return_after',
      correctedCurrent: null,
    });
  });
  it('현재는 그대로인데 미발송만 줄었으면 업로드 전 출고 — 고칠 현재값을 준다', () => {
    expect(judgeClose({ uploadedCurrent: 10, refUnshipped: 4, now: { current: 10, unshipped: 2 } })).toEqual({
      verdict: 'shipped_before_upload',
      correctedCurrent: 8,
    });
  });
  it('현재만 줄었으면 mismatch', () => {
    expect(judgeClose({ uploadedCurrent: 10, refUnshipped: 4, now: { current: 7, unshipped: 4 } })).toEqual({
      verdict: 'mismatch',
      correctedCurrent: null,
    });
  });
  it('셀메이트에서 품목이 사라졌으면 missing', () => {
    expect(judgeClose({ uploadedCurrent: 10, refUnshipped: 4, now: null })).toEqual({
      verdict: 'missing',
      correctedCurrent: null,
    });
  });
  it('고친 CSV 를 올린 뒤 다시 닫으면 ok_new_orders', () => {
    expect(judgeClose({ uploadedCurrent: 8, refUnshipped: 2, now: { current: 8, unshipped: 2 } })).toEqual({
      verdict: 'ok_new_orders',
      correctedCurrent: null,
    });
  });
  it('mismatch 와 shipped_before_upload 는 일치 판정이 아니고 나머지 ok_* 는 일치다', () => {
    expect(isOkVerdict('ok_new_orders')).toBe(true);
    expect(isOkVerdict('ok_shipped_after')).toBe(true);
    expect(isOkVerdict('ok_return_after')).toBe(true);
    expect(isOkVerdict('shipped_before_upload')).toBe(false);
    expect(isOkVerdict('mismatch')).toBe(false);
    expect(isOkVerdict('missing')).toBe(false);
  });
});

describe('고친 CSV 를 기다리는 품목 (fixPending)', () => {
  // apply 때 올린 현재 10·받을 때 미발송 2. 업로드 전 1 출고 → 고친 값 9·기준 미발송 1 로 바꿨다
  it('같은 닫기 CSV(현재 10, 미발송 1)를 다시 넣으면 반품이 아니라 mismatch', () => {
    expect(
      judgeClose({ uploadedCurrent: 9, refUnshipped: 1, now: { current: 10, unshipped: 1 }, fixPending: true }),
    ).toEqual({ verdict: 'mismatch', correctedCurrent: null });
  });
  it('fixPending 이 아니면 같은 숫자는 ok_return_after 그대로', () => {
    expect(
      judgeClose({ uploadedCurrent: 9, refUnshipped: 1, now: { current: 10, unshipped: 1 }, fixPending: false }),
    ).toEqual({ verdict: 'ok_return_after', correctedCurrent: null });
  });
  it('고친 파일이 먹었으면(현재 9) fixPending 이어도 통과', () => {
    expect(
      judgeClose({ uploadedCurrent: 9, refUnshipped: 1, now: { current: 9, unshipped: 1 }, fixPending: true }),
    ).toEqual({ verdict: 'ok_new_orders', correctedCurrent: null });
    expect(
      judgeClose({ uploadedCurrent: 9, refUnshipped: 1, now: { current: 8, unshipped: 0 }, fixPending: true }),
    ).toEqual({ verdict: 'ok_shipped_after', correctedCurrent: null });
  });
  it('isFixPending: 기준을 바꿨고 그 뒤 통과 판정이 없으면 true', () => {
    const base = { uploadAvail: 8, sellmateUnshipped: 2 };
    expect(isFixPending({ ...base, uploadedCurrent: 10, refUnshipped: 2, closeVerdict: 'mismatch' })).toBe(false);
    expect(isFixPending({ ...base, uploadedCurrent: 9, refUnshipped: 1, closeVerdict: 'shipped_before_upload' })).toBe(
      true,
    );
    // 고친 파일을 안 올린 채 다시 닫아 mismatch 가 저장돼도 여전히 기다린다
    expect(isFixPending({ ...base, uploadedCurrent: 9, refUnshipped: 1, closeVerdict: 'mismatch' })).toBe(true);
    expect(isFixPending({ ...base, uploadedCurrent: 9, refUnshipped: 1, closeVerdict: 'ok_new_orders' })).toBe(false);
  });
});

describe('confirmedBaseline (확정 기준값)', () => {
  it('미확인이면 업로드 현재 − 기준 미발송', () => {
    expect(confirmedBaseline({ uploadedCurrent: 10, refUnshipped: 4, applyS: 3, accept: null })).toBe(6);
  });
  it('반영 확인됐으면 업로드 현재 − 기준 미발송', () => {
    expect(confirmedBaseline({ uploadedCurrent: 10, refUnshipped: 4, applyS: 3, accept: 'landed' })).toBe(6);
  });
  it('반영 안 됐으면 적용 전 셀메이트 가용(applyS)', () => {
    expect(confirmedBaseline({ uploadedCurrent: 10, refUnshipped: 4, applyS: 3, accept: 'not_landed' })).toBe(3);
  });
  it('고친 CSV 뒤 다시 닫은 값도 같은 식으로 확정된다', () => {
    expect(confirmedBaseline({ uploadedCurrent: 8, refUnshipped: 2, applyS: 3, accept: null })).toBe(6);
  });
});
