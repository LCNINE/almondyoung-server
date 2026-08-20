import { DEFAULT_PAYMENT_PROVIDER_DESCRIPTORS, PAYMENT_PROVIDER_DESCRIPTORS } from './provider-descriptors';

/**
 * 결제창(wallet-web)의 결제수단 라벨은 DB 가 아니라 이 descriptor 가 정본이다
 * (payment-config.service 가 항상 descriptor 값을 쓰고, DB 행은 upsert 로 덮어쓴다).
 * 고객은 PG사가 누구인지 모르고 알 필요도 없으므로 checkout 노출 수단에는 PG 브랜드명을 쓰지 않는다.
 */
describe('PAYMENT_PROVIDER_DESCRIPTORS', () => {
  it('TOSS 는 고객에게 PG명이 아닌 결제수단 이름으로 보인다', () => {
    expect(PAYMENT_PROVIDER_DESCRIPTORS.TOSS.displayName).toBe('카드 간편결제');
    expect(PAYMENT_PROVIDER_DESCRIPTORS.TOSS.description).toBe('카드, 카카오페이, 네이버페이, 토스페이 등');
  });

  it('BANK_TRANSFER 설명에도 PG명을 쓰지 않는다', () => {
    expect(PAYMENT_PROVIDER_DESCRIPTORS.BANK_TRANSFER.description).toBe('발급된 가상계좌로 입금');
  });

  // 간편결제 브랜드(카카오페이·네이버페이·토스페이)는 고객이 아는 결제수단이라 허용 대상이 아니다.
  // 여기서 막는 건 고객이 알 필요 없는 PG사(결제대행사) 상호다.
  const PG_BRAND_PATTERN = /토스페이먼츠|나이스페이|이니시스|KG모빌리언스|다날|효성|페이레터|헥토/;

  it.each(DEFAULT_PAYMENT_PROVIDER_DESCRIPTORS.filter((d) => d.publicExposure === 'checkout').map((d) => [d.code, d]))(
    '%s 의 고객 노출 문구에 PG사 상호가 없다',
    (_code, descriptor) => {
      const d = descriptor as (typeof DEFAULT_PAYMENT_PROVIDER_DESCRIPTORS)[number];
      expect(d.displayName).not.toMatch(PG_BRAND_PATTERN);
      expect(d.description ?? '').not.toMatch(PG_BRAND_PATTERN);
    },
  );
});
