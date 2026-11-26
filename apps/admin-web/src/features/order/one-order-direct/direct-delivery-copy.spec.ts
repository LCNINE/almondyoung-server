import {
  awaitingAgeText,
  awaitingItemsText,
  isMaskedRecipient,
  recipientClipboardText,
} from './direct-delivery-copy';

describe('직배송 문구', () => {
  it('맡긴 지 지난 시간을 시간·일로 말한다', () => {
    const now = new Date('2026-11-26T12:00:00Z');
    expect(awaitingAgeText('2026-11-26T11:30:00Z', now)).toBe('방금 맡김');
    expect(awaitingAgeText('2026-11-26T09:00:00Z', now)).toBe('맡긴 지 3시간');
    expect(awaitingAgeText('2026-11-24T11:00:00Z', now)).toBe('맡긴 지 2일');
  });

  it('상품이 여럿이면 «외 N종»과 합계', () => {
    expect(
      awaitingItemsText({ firstSkuName: '가', lineCount: 3, totalQty: 5 })
    ).toBe('가 외 2종 · 5개');
    expect(
      awaitingItemsText({ firstSkuName: '가', lineCount: 1, totalQty: 1 })
    ).toBe('가 · 1개');
  });

  it('복사할 받는 분은 비어 있는 칸을 뺀다', () => {
    expect(
      recipientClipboardText({
        name: '가',
        phone: '1',
        address: '주소',
        memo: '',
        entrancePassword: '#1',
      })
    ).toBe('받는 분: 가\n연락처: 1\n주소: 주소\n공동현관: #1');
  });

  it('가린 값이 섞이면 복사하지 않게 알린다', () => {
    expect(isMaskedRecipient({ name: '홍*동', phone: '1', address: 'a' })).toBe(
      true
    );
    expect(
      isMaskedRecipient({ name: '홍길동', phone: '1', address: 'a' })
    ).toBe(false);
  });
});
