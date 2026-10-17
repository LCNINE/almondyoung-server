import { classifyOldRefund, OldRefund } from './1016-40-refund-kind-rules';

const base: OldRefund = {
  id: 'r1',
  reasonCode: null,
  reasonMessage: null,
  intentPurpose: 'PURCHASE',
  medusaNotes: null,
};
const make = (o: Partial<OldRefund>): OldRefund => ({ ...base, ...o });

describe('classifyOldRefund (#1016 40번 §7)', () => {
  describe('1단계 — 코드로 확정', () => {
    it('SUBSCRIPTION 의도는 SUBSCRIPTION_FEE', () => {
      expect(classifyOldRefund(make({ reasonCode: 'NOT_USING', intentPurpose: 'SUBSCRIPTION' }))).toMatchObject({
        step: 1,
        kind: 'SUBSCRIPTION_FEE',
      });
    });
    it('RETURN_COMPLETED 는 RETURN', () => {
      expect(classifyOldRefund(make({ reasonCode: 'RETURN_COMPLETED' }))).toMatchObject({ step: 1, kind: 'RETURN' });
    });
    it.each(['CUSTOMER_REFUND_REQUEST', 'CUSTOMER_CANCEL', 'CHANGE_OF_MIND', 'WRONG_ORDER', 'FOUND_CHEAPER', 'DELAY', 'OTHER'])(
      '%s 는 ITEM_CANCEL',
      (code) => {
        expect(classifyOldRefund(make({ reasonCode: code }))).toMatchObject({ step: 1, kind: 'ITEM_CANCEL' });
      },
    );
    it('ORPHAN_PAYMENT_RECONCILE 는 PAYMENT_ERROR', () => {
      expect(classifyOldRefund(make({ reasonCode: 'ORPHAN_PAYMENT_RECONCILE' }))).toMatchObject({
        step: 1,
        kind: 'PAYMENT_ERROR',
      });
    });
    it('MEDUSA_REFUND 는 노트가 전부 partial-cancel:/channel-cancel: 이면 ITEM_CANCEL', () => {
      expect(
        classifyOldRefund(make({ reasonCode: 'MEDUSA_REFUND', medusaNotes: ['partial-cancel:r1'] })),
      ).toMatchObject({ step: 1, kind: 'ITEM_CANCEL' });
      expect(
        classifyOldRefund(make({ reasonCode: 'MEDUSA_REFUND', medusaNotes: ['partial-cancel:a', 'channel-cancel:b'] })),
      ).toMatchObject({ step: 1, kind: 'ITEM_CANCEL' });
    });
    it('MEDUSA_REFUND 는 노트가 섞이거나 없으면 3단계', () => {
      expect(classifyOldRefund(make({ reasonCode: 'MEDUSA_REFUND', medusaNotes: ['wallet:x'] }))).toMatchObject({ step: 3 });
      expect(
        classifyOldRefund(make({ reasonCode: 'MEDUSA_REFUND', medusaNotes: ['partial-cancel:a', 'wallet:x'] })),
      ).toMatchObject({ step: 3 });
      expect(classifyOldRefund(make({ reasonCode: 'MEDUSA_REFUND', medusaNotes: null }))).toMatchObject({ step: 3 });
      expect(classifyOldRefund(make({ reasonCode: 'MEDUSA_REFUND', medusaNotes: [] }))).toMatchObject({ step: 3 });
    });
  });

  describe('2단계 — 사유 문구 후보', () => {
    it('품절 단종 + 취소 는 ITEM_CANCEL 후보', () => {
      expect(
        classifyOldRefund(make({ reasonMessage: '엘라 맵핑실 본체1개+리필1개 품절 단종 부분 취소' })),
      ).toMatchObject({ step: 2, candidate: 'ITEM_CANCEL' });
    });
    it('반품 은 RETURN 후보', () => {
      expect(classifyOldRefund(make({ reasonMessage: '반품건' }))).toMatchObject({ step: 2, candidate: 'RETURN' });
    });
    it('중복 결제 는 PAYMENT_ERROR 후보', () => {
      expect(classifyOldRefund(make({ reasonMessage: '중복 결제' }))).toMatchObject({
        step: 2,
        candidate: 'PAYMENT_ERROR',
      });
    });
    it('차액 은 PRICE_ADJUSTMENT 후보', () => {
      expect(classifyOldRefund(make({ reasonMessage: '차액 환불' }))).toMatchObject({
        step: 2,
        candidate: 'PRICE_ADJUSTMENT',
      });
    });
    it('reasonCode 와 reasonMessage 를 이어서 본다', () => {
      expect(classifyOldRefund(make({ reasonCode: 'X', reasonMessage: '반품 처리' }))).toMatchObject({ step: 2 });
    });
  });

  describe('3단계 — 사람이 본다', () => {
    it('부족 + 차액 은 둘이 걸려 3단계', () => {
      expect(
        classifyOldRefund(make({ reasonMessage: '인텐즈 디본더 크림 리무버 1개 부족 -> 투명 해면볼 2개 변경 후 차액 부분 환불' })),
      ).toMatchObject({ step: 3 });
    });
    it('누락만(취소 없음) 은 3단계', () => {
      expect(classifyOldRefund(make({ reasonMessage: '화이트 캐릭터 땅콩 브러쉬 1개 누락' }))).toMatchObject({ step: 3 });
    });
    it('사유가 없으면 3단계', () => {
      expect(classifyOldRefund(make({}))).toMatchObject({ step: 3 });
    });
  });
});
