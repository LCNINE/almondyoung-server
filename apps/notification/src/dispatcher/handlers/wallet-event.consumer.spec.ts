import { WalletEventConsumer } from './wallet-event.consumer';

// 거절 코드마다 고쳐야 할 것이 다르다. 계좌번호 오류(Q101)에 "생년월일을 확인하세요" 라고
// 보내면 고객이 못 고치고 CS 로 되돌아온다 — 그 회귀를 막는 게 이 스펙의 전부다.

function makeConsumer() {
  const dispatcher = { send: jest.fn().mockResolvedValue(undefined) };
  const eventMapping = {
    getEventMapping: jest.fn().mockResolvedValue({
      isActive: true,
      defaultChannels: ['EMAIL'],
      category: 'TRANSACTIONAL',
      templateKey: 'CMS_MEMBER_REJECTED_EMAIL',
      eventKey: 'CMS_MEMBER_REJECTED',
      priority: 'HIGH',
    }),
  };
  const consumer = new WalletEventConsumer(dispatcher as never, eventMapping as never);
  return { consumer, dispatcher };
}

async function dispatchWith(reasonCode: string | null) {
  const { consumer, dispatcher } = makeConsumer();
  await consumer.onCmsMemberRejected({ correlationId: 'corr-1' } as never, {
    cmsMemberId: 'A1',
    billingMethodId: 'bm-1',
    userId: 'user-1',
    email: 'a@b.com',
    userName: '정중식',
    reasonCode,
    reasonMessage: '원문 메시지',
    occurredAt: '2026-08-26T00:00:00.000Z',
  } as never);
  return dispatcher.send.mock.calls[0][0].variables;
}

describe('WalletEventConsumer — CMS 거절 안내 문구', () => {
  it('Q201(생년월일 불일치) 은 생년월일 정정을 안내한다', async () => {
    const v = await dispatchWith('Q201');
    expect(v.reason).toContain('생년월일');
    expect(v.action).toContain('생년월일');
  });

  it('Q101(계좌번호 오류) 은 생년월일이 아니라 계좌번호 정정을 안내한다', async () => {
    const v = await dispatchWith('Q101');
    expect(v.reason).toContain('계좌번호');
    expect(v.action).toContain('계좌번호');
    expect(v.action).not.toContain('생년월일');
  });

  it('Q108(출금불가계좌) 은 정정이 아니라 다른 계좌를 안내한다', async () => {
    const v = await dispatchWith('Q108');
    expect(v.action).toContain('다른 계좌');
  });

  it('Q121(자동이체 미등록계좌) 은 은행 확인을 안내한다', async () => {
    const v = await dispatchWith('Q121');
    expect(v.action).toContain('은행');
  });

  it('모르는 코드는 뭉뚱그리되 빈 문구를 내보내지 않는다', async () => {
    const v = await dispatchWith('ZZZ9');
    expect(v.reason.length).toBeGreaterThan(0);
    expect(v.action.length).toBeGreaterThan(0);
  });

  it('코드가 없어도 터지지 않는다', async () => {
    const v = await dispatchWith(null);
    expect(v.reason.length).toBeGreaterThan(0);
  });

  it('본문 링크는 계좌 등록 진입 화면을 가리킨다', async () => {
    const v = await dispatchWith('Q201');
    expect(v.registerUrl).toContain('/mypage/membership/payment-method');
  });
});
