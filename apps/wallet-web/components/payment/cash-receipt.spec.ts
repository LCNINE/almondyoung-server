import { buildCashReceipt, EMPTY_CASH_RECEIPT, type CashReceiptState } from './cash-receipt';

const state = (over: Partial<CashReceiptState>): CashReceiptState => ({ ...EMPTY_CASH_RECEIPT, ...over });

describe('buildCashReceipt', () => {
  it('증빙 미신청이면 페이로드 없이 통과한다', () => {
    const result = buildCashReceipt(EMPTY_CASH_RECEIPT, '');
    expect(result).toEqual({ ok: true, offerSaveBizNumber: false });
  });

  describe('소득공제', () => {
    it('휴대폰 10~11자리를 허용하고 하이픈을 제거한다', () => {
      const result = buildCashReceipt(state({ evidenceType: 'CASH_INCOME', method: 'PHONE', number: '010-1234-5678' }), '');
      expect(result).toEqual({
        ok: true,
        cashReceipt: { type: '소득공제', customerIdentityNumber: '01012345678' },
        offerSaveBizNumber: false,
      });
    });

    it('휴대폰이 9자리면 거부한다', () => {
      expect(buildCashReceipt(state({ evidenceType: 'CASH_INCOME', method: 'PHONE', number: '012345678' }), '').ok).toBe(
        false,
      );
    });

    it('현금영수증카드는 13~19자리를 허용한다', () => {
      expect(
        buildCashReceipt(state({ evidenceType: 'CASH_INCOME', method: 'CARD', number: '1234567890123' }), '').ok,
      ).toBe(true);
      // 휴대폰 길이(11)는 카드번호로는 부족하다 — 발급방법을 바꾸면 검증도 바뀐다.
      expect(buildCashReceipt(state({ evidenceType: 'CASH_INCOME', method: 'CARD', number: '01012345678' }), '').ok).toBe(
        false,
      );
    });
  });

  describe('지출증빙', () => {
    it('사업자번호 10자리만 허용한다', () => {
      const result = buildCashReceipt(
        state({ evidenceType: 'CASH_EXPENSE', number: '123-45-67890', saveForNextTime: true }),
        '',
      );
      expect(result).toEqual({
        ok: true,
        cashReceipt: { type: '지출증빙', customerIdentityNumber: '1234567890' },
        offerSaveBizNumber: true,
      });
      expect(buildCashReceipt(state({ evidenceType: 'CASH_EXPENSE', number: '12345678901' }), '').ok).toBe(false);
    });

    it('저장 체크를 하지 않으면 저장하지 않는다', () => {
      const result = buildCashReceipt(state({ evidenceType: 'CASH_EXPENSE', number: '1234567890' }), '');
      expect(result).toMatchObject({ ok: true, offerSaveBizNumber: false });
    });

    it('이미 저장된 사업자번호가 있으면 체크했어도 저장하지 않는다', () => {
      const result = buildCashReceipt(
        state({ evidenceType: 'CASH_EXPENSE', number: '1234567890', saveForNextTime: true }),
        '9999999999',
      );
      expect(result).toMatchObject({ ok: true, offerSaveBizNumber: false });
    });
  });
});
