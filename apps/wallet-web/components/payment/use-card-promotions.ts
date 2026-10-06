'use client';

import { useEffect, useState } from 'react';

interface Promotion {
  issuerCode: string;
  minimumPaymentAmount: number;
  dueDate: string;
  installmentFreeMonths: number[];
}

export function verifiedCardPromotions(body: { source?: string; interestFreeCards?: Promotion[] }) {
  // 공식 안내와 같은 데이터 출처만 사용한다. 일반결제 테스트 API의 전체 무이자 샘플은 제외한다.
  return body.source === 'TOSS_WIDGET_GUIDE' ? (body.interestFreeCards ?? []) : [];
}

export function useCardPromotions() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  useEffect(() => {
    const abort = new AbortController();
    setPromotions([]);
    void fetch('/api/toss/promotions', { cache: 'no-store', signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { source?: string; interestFreeCards?: Promotion[] };
        if (!abort.signal.aborted) setPromotions(verifiedCardPromotions(body));
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, []);
  return promotions;
}

export function getInterestFreeMonths(promotions: Promotion[], issuerCode: string | null, amount: number) {
  if (!issuerCode || amount < 50000) return [];
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return [
    ...new Set(
      promotions
        .filter(
          (item) => item.issuerCode === issuerCode && item.minimumPaymentAmount <= amount && item.dueDate >= today,
        )
        .flatMap((item) => item.installmentFreeMonths),
    ),
  ].sort((a, b) => a - b);
}

export function getCardIssuer(name: string) {
  if (/(BC|비씨)/i.test(name)) return '31';
  const issuers: [string, string][] = [
    ['신한', '41'],
    ['현대', '61'],
    ['삼성', '51'],
    ['롯데', '71'],
    ['하나', '21'],
    ['국민', '11'],
    ['비씨', '31'],
    ['농협', '91'],
    ['우리', '33'],
    ['전북', '35'],
    ['광주', '46'],
  ];
  return issuers.find(([issuer]) => name.includes(issuer))?.[1] ?? null;
}
