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
  const consumer = new WalletEventConsumer(dispatcher as never, eventMapping as never, {} as never);
  return { consumer, dispatcher };
}

async function dispatchWith(reasonCode: string | null) {
  const { consumer, dispatcher } = makeConsumer();
  await consumer.onCmsMemberRejected(
    { correlationId: 'corr-1' } as never,
    {
      cmsMemberId: 'A1',
      billingMethodId: 'bm-1',
      userId: 'user-1',
      email: 'a@b.com',
      userName: '정중식',
      reasonCode,
      reasonMessage: '원문 메시지',
      occurredAt: '2026-08-26T00:00:00.000Z',
    } as never,
  );
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

// 승인 메일은 매핑 키나 변수 이름이 어긋나면 «조용히» 안 나간다. 고객은 심사가 끝난 줄
// 모른 채 기다린다 — 그 침묵을 잡는 게 아래 스펙이다.
function makeRegisteredConsumer(mapping: Record<string, unknown> | null = {}) {
  const dispatcher = { send: jest.fn().mockResolvedValue(undefined) };
  const eventMapping = {
    getEventMapping: jest.fn().mockResolvedValue(
      mapping && {
        isActive: true,
        defaultChannels: ['EMAIL'],
        category: 'TRANSACTIONAL',
        templateKey: 'CMS_MEMBER_REGISTERED_EMAIL',
        eventKey: 'CMS_MEMBER_REGISTERED',
        priority: 'HIGH',
        ...mapping,
      },
    ),
  };
  const consumer = new WalletEventConsumer(dispatcher as never, eventMapping as never, {} as never);
  return { consumer, dispatcher, eventMapping };
}

const registeredPayload = {
  cmsMemberId: 'A1',
  billingMethodId: 'bm-1',
  userId: 'user-1',
  email: 'a@b.com',
  userName: '정중식',
  bankName: '카카오뱅크',
  payerName: '정중식',
  occurredAt: '2026-09-11T00:00:00.000Z',
};

describe('WalletEventConsumer — CMS 승인 안내', () => {
  it('템플릿이 쓰는 이름 그대로 변수를 넘긴다', async () => {
    const { consumer, dispatcher } = makeRegisteredConsumer();
    await consumer.onCmsMemberRegistered({ correlationId: 'corr-1' } as never, registeredPayload as never);

    const sent = dispatcher.send.mock.calls[0][0];
    // CMS_MEMBER_REGISTERED_EMAIL 의 {{...}} 와 한 글자라도 다르면 빈칸으로 나간다.
    expect(sent.variables).toEqual({ name: '정중식', bankName: '카카오뱅크', payerName: '정중식' });
    expect(sent.templateKey).toBe('CMS_MEMBER_REGISTERED_EMAIL');
    expect(sent.userId).toBe('user-1');
    // 수신 주소는 payload 에서 와야 한다 — 없으면 메일이 갈 곳이 없다.
    expect(sent.payload.email).toBe('a@b.com');
  });

  it('거절이 아니라 승인 매핑을 찾는다', async () => {
    const { consumer, eventMapping } = makeRegisteredConsumer();
    await consumer.onCmsMemberRegistered({ correlationId: 'corr-1' } as never, registeredPayload as never);
    expect(eventMapping.getEventMapping).toHaveBeenCalledWith('CMS_MEMBER_REGISTERED');
  });

  it('꺼둔 매핑이면 조용히 넘긴다', async () => {
    const { consumer, dispatcher } = makeRegisteredConsumer({ isActive: false });
    await consumer.onCmsMemberRegistered({ correlationId: 'corr-1' } as never, registeredPayload as never);
    expect(dispatcher.send).not.toHaveBeenCalled();
  });

  it('매핑을 못 읽으면 끊어서 재시도에 맡긴다', async () => {
    // getEventMapping 은 DB 장애도 null 로 준다. 조용히 넘기면 이벤트가 ack 되어
    // 승인 메일이 영영 사라진다.
    const { consumer, dispatcher } = makeRegisteredConsumer(null);
    await expect(
      consumer.onCmsMemberRegistered({ correlationId: 'corr-1' } as never, registeredPayload as never),
    ).rejects.toThrow(/CMS_MEMBER_REGISTERED/);
    expect(dispatcher.send).not.toHaveBeenCalled();
  });
});

// 선적용 메일도 같은 침묵 위험을 진다 — 게다가 이건 «가입 직후» 라, 안 나가면 고객은
// 첫 출금이 없는 이유를 끝까지 모른다.
describe('WalletEventConsumer — 선적용 가입 안내', () => {
  const pendingPayload = {
    billingMethodId: 'bm-1',
    userId: 'user-1',
    subscriberType: 'MEMBERSHIP',
    subscriberRef: 'contract-1',
    email: 'a@b.com',
    userName: '정중식',
    occurredAt: '2026-09-12T00:00:00.000Z',
  };

  function makePendingConsumer() {
    const dispatcher = { send: jest.fn().mockResolvedValue(undefined) };
    const eventMapping = {
      getEventMapping: jest.fn().mockResolvedValue({
        isActive: true,
        defaultChannels: ['EMAIL'],
        category: 'TRANSACTIONAL',
        templateKey: 'MANDATE_PENDING_EMAIL',
        eventKey: 'MANDATE_PENDING',
        priority: 'HIGH',
      }),
    };
    return {
      consumer: new WalletEventConsumer(dispatcher as never, eventMapping as never, {} as never),
      dispatcher,
      eventMapping,
    };
  }

  it('템플릿이 쓰는 이름 그대로 변수를 넘긴다', async () => {
    const { consumer, dispatcher, eventMapping } = makePendingConsumer();
    await consumer.onMandatePending({ correlationId: 'corr-1' } as never, pendingPayload as never);

    const sent = dispatcher.send.mock.calls[0][0];
    expect(eventMapping.getEventMapping).toHaveBeenCalledWith('MANDATE_PENDING');
    // MANDATE_PENDING_EMAIL 의 {{...}} 와 한 글자라도 다르면 빈칸으로 나간다.
    expect(Object.keys(sent.variables).sort()).toEqual(['membershipUrl', 'name']);
    expect(sent.variables.name).toBe('정중식');
    // 배너가 상시로 떠 있는 곳 — 결제수단 화면이 아니다.
    expect(sent.variables.membershipUrl).toMatch(/\/mypage\/membership$/);
    expect(sent.payload.email).toBe('a@b.com');
  });
});

describe('WalletEventConsumer 환불 완료 알림', () => {
  const refund = {
    refundId: 'rf-1',
    chargeId: 'ch-1',
    intentId: 'pi-1',
    userId: 'user-1',
    status: 'SUCCEEDED',
    amount: 29900,
    currency: 'KRW',
    occurredAt: '2026-09-22T01:00:00.000Z',
  };
  const envelope = { correlationId: 'c-1' } as never;

  function make(contactEmail?: string) {
    const send = jest.fn().mockResolvedValue({ notificationIds: [] });
    const mapping = {
      eventKey: 'REFUND_COMPLETED',
      isActive: true,
      defaultChannels: ['EMAIL'],
      category: 'TRANSACTIONAL',
      templateKey: 'REFUND_COMPLETED_EMAIL',
      priority: 'NORMAL',
    };
    const contacts = contactEmail
      ? new Map([
          [
            'user-1',
            { userId: 'user-1', email: contactEmail, username: '홍길동', phoneNumber: null, marketingConsent: false },
          ],
        ])
      : new Map();
    const consumer = new WalletEventConsumer(
      { send } as never,
      { getEventMapping: jest.fn().mockResolvedValue(mapping) } as never,
      { findContacts: jest.fn().mockResolvedValue(contacts) } as never,
    );
    return { consumer, send };
  }

  it('상품 주문 환불이면 활성 회원 메일로 금액과 주문명을 보낸다', async () => {
    const { consumer, send } = make('member@example.com');

    await consumer.onRefundSucceeded(envelope, {
      ...refund,
      email: 'buyer@example.com',
      customerName: '홍길동',
      orderName: '아몬드 오일 외 1건',
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ email: 'member@example.com' }),
        variables: { name: '홍길동', amount: '29,900', orderName: '아몬드 오일 외 1건' },
      }),
    );
  });

  it('탈퇴·휴면으로 활성 연락처가 없으면 결제 메일이 있어도 보내지 않는다', async () => {
    const { consumer, send } = make();

    await consumer.onRefundSucceeded(envelope, { ...refund, email: 'buyer@example.com' });

    expect(send).not.toHaveBeenCalled();
  });

  it('일반 구매(purpose=PURCHASE)는 보낸다', async () => {
    const { consumer, send } = make('member@example.com');

    await consumer.onRefundSucceeded(envelope, { ...refund, purpose: 'PURCHASE' });

    expect(send).toHaveBeenCalled();
  });

  it('멤버십 결제 환불은 보내지 않는다', async () => {
    const { consumer, send } = make('member@example.com');

    await consumer.onRefundSucceeded(envelope, { ...refund, purpose: 'SUBSCRIPTION' });
    await consumer.onRefundSucceeded(envelope, { ...refund, intentType: 'MEMBERSHIP_FEE' });

    expect(send).not.toHaveBeenCalled();
  });
});
