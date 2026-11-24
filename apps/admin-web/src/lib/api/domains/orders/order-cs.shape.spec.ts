import {
  contactPeople,
  followUpText,
  goodsText,
  toCsBrief,
  toCsContext,
  toOrderContacts,
  type CsBrief,
} from './order-cs.shape';

const brief = (patch: Partial<CsBrief> = {}): CsBrief => ({
  customerPhone: '010-1111-2222',
  recipientName: '김하나',
  recipientPhone: '01011112222',
  totalAmount: 1000,
  firstItemName: '가위',
  firstItemQty: 2,
  itemCount: 1,
  hasMemo: false,
  lastContact: null,
  ...patch,
});

it('받는 분이 주문자와 같은 이름·번호면 한 사람만, 다르면 둘 다 보인다', () => {
  expect(contactPeople('김하나', brief())).toHaveLength(1);
  expect(
    contactPeople('김하나', brief({ recipientName: '박둘' })).map((p) => p.who)
  ).toEqual(['주문자', '받는 분']);
  expect(
    contactPeople('김하나', brief({ recipientPhone: '010-9999-0000' }))
  ).toHaveLength(2);
});

it('주문자 연락처가 없으면 같은 사람인 받는 분 번호를 보인다', () => {
  expect(contactPeople('김하나', brief({ customerPhone: null }))).toEqual([
    { who: '주문자', name: '김하나', phone: '01011112222' },
  ]);
  expect(
    contactPeople(
      '김하나',
      brief({ customerPhone: null, recipientName: '박둘' })
    )
  ).toHaveLength(2);
});

it('상품은 첫 상품과 나머지 종 수로 줄인다', () => {
  expect(goodsText(brief())).toBe('가위 2개');
  expect(goodsText(brief({ itemCount: 13 }))).toBe('가위 2개 외 12종');
  expect(goodsText(brief({ firstItemName: null, itemCount: 0 }))).toBe(
    '상품 없음'
  );
});

it('다시 연락할 날은 오늘·지남을 구별한다', () => {
  expect(followUpText(null, '2026-11-24')).toBeNull();
  expect(followUpText('2026-11-25', '2026-11-24')).toEqual({
    text: '11-25 다시 연락',
    due: false,
  });
  expect(followUpText('2026-11-24', '2026-11-24')).toEqual({
    text: '오늘 다시 연락',
    due: true,
  });
  expect(followUpText('2026-11-23', '2026-11-24')).toEqual({
    text: '11-23 다시 연락 — 지남',
    due: true,
  });
});

it('옛 응답의 줄은 null, 상세·연락 기록은 모양이 다르면 «없음»이 아니라 던진다', () => {
  expect(toCsBrief(undefined)).toBeNull();
  expect(() => toCsContext({})).toThrow();
  expect(() => toOrderContacts({ success: true, data: null })).toThrow();
  expect(
    toOrderContacts({
      success: true,
      data: {
        items: [
          {
            id: 'c',
            outcome: 'reached',
            body: '확인',
            authorId: 'a',
            createdAt: 't',
            followUpOn: null,
          },
        ],
      },
    })
  ).toEqual([
    {
      id: 'c',
      outcome: 'reached',
      body: '확인',
      authorId: 'a',
      at: 't',
      followUpOn: null,
    },
  ]);
});
