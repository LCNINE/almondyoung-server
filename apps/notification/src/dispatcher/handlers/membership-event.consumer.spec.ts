import { MembershipEventConsumer } from './membership-event.consumer';

// 2026-08 내내 이 두 메일이 제목 없이 payload JSON 원문으로 나갔다(81건). 원인 두 가지 —
// 템플릿 contents 에 언어 레이어(EMAIL.ko)가 없었고, 본문이 `{{formatDate x}}` 헬퍼 문법을
// 썼는데 렌더러 정규식(`[\w.]+`)은 공백이 든 표현을 매치하지 않는다.
// 여기서는 컨슈머 몫(포맷 완료된 문자열을 넘기는가)을 못박는다.

function makeConsumer(templateKey: string) {
  const dispatcher = { send: jest.fn().mockResolvedValue(undefined) };
  const eventMapping = {
    getEventMapping: jest.fn().mockResolvedValue({
      isActive: true,
      defaultChannels: ['EMAIL'],
      category: 'TRANSACTIONAL',
      templateKey,
      eventKey: templateKey,
      priority: 'HIGH',
    }),
  };
  const consumer = new MembershipEventConsumer(dispatcher as never, eventMapping as never);
  return { consumer, dispatcher };
}

describe('MembershipEventConsumer — 고지 메일 변수', () => {
  it('갱신 고지: 날짜와 금액을 사람이 읽는 형태로 넘긴다', async () => {
    const { consumer, dispatcher } = makeConsumer('MEMBERSHIP_RENEWAL_UPCOMING');

    await consumer.onRenewalUpcoming({ correlationId: 'c1' } as never, {
      userId: 'u1',
      contractId: 'ct1',
      userName: '정중식',
      planName: '아몬드영 멤버십',
      nextBillingDate: '2026-09-01',
      amount: 29900,
      paymentMethodLabel: '자동이체',
      currentPeriodEnd: '2026-08-31',
      nextPeriodEnd: '2026-09-30',
      noticeDaysBefore: 7,
    } as never);

    const v = dispatcher.send.mock.calls[0][0].variables;
    expect(v.nextBillingDate).toBe('2026년 9월 1일');
    expect(v.amount).toBe('29,900');
    expect(v.nextPeriodEnd).toBe('2026년 9월 30일');
    // 원시 ISO 문자열이 그대로 새어나가면 본문에 "2026-09-01" 로 찍힌다.
    expect(v.nextBillingDate).not.toContain('-');
  });

  it('만료 고지: 종료일을 사람이 읽는 형태로 넘긴다', async () => {
    const { consumer, dispatcher } = makeConsumer('MEMBERSHIP_EXPIRY_UPCOMING');

    await consumer.onExpiryUpcoming({ correlationId: 'c2' } as never, {
      userId: 'u1',
      entitlementId: 'e1',
      userName: '정중식',
      planName: '아몬드영 멤버십',
      expiresAt: '2026-09-01',
      noticeDaysBefore: 7,
    } as never);

    const v = dispatcher.send.mock.calls[0][0].variables;
    expect(v.expiresAt).toBe('2026년 9월 1일');
  });
});
