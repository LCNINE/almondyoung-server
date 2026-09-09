import { CmsMemberPollerService } from './cms-member-poller.service';

// 심사 거절을 고객이 알 수 있는 유일한 경로가 이 발행이다 — mandate.rejected 는 인보이스가
// 있어야 나가므로 계좌만 등록한 사람(구독 전)은 그쪽으로 아무 통지도 못 받는다.

const MEMBER = {
  id: 'cms-row-1',
  cmsMemberId: 'A4801367',
  billingMethodId: 'bm-1',
  userId: 'user-1',
} as never;

function makePoller(opts: {
  liveStatus: string;
  contact?: { email: string; username: string } | null;
  configured?: boolean;
}) {
  const cmsMemberService = {
    findPendingMembers: jest.fn().mockResolvedValue([MEMBER]),
    // #707: 선점에 성공했을 때만 true. 후속 처리(통지·인보이스 종결)가 이 반환값에 걸린다.
    updateStatus: jest.fn().mockResolvedValue(true),
  };
  const cmsApi = {
    getMember: jest.fn().mockResolvedValue({
      ok: true,
      data: { member: { status: opts.liveStatus, result: { code: 'Q201', message: '생년월일 불일치' } } },
    }),
  };
  const dbService = { run: jest.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => fn({})) };
  const invoiceOutcomeService = {
    rejectMandateForBillingMethod: jest.fn().mockResolvedValue(0),
    pullForwardMandatePending: jest.fn().mockResolvedValue(0),
  };
  const contacts = new Map<string, { userId: string; email: string; username: string }>();
  if (opts.contact !== null) {
    const c = opts.contact ?? { email: 'a@b.com', username: '최수경' };
    contacts.set('user-1', { userId: 'user-1', ...c });
  }
  const userContactClient = { findContacts: jest.fn().mockResolvedValue(contacts) };
  const publisher = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const env: Record<string, string> =
    opts.configured === false ? {} : { USER_SERVICE_URL: 'http://user-service', USER_SERVICE_INTERNAL_KEY: 'k' };
  const configService = { get: jest.fn((key: string) => env[key]) };

  const poller = new CmsMemberPollerService(
    cmsMemberService as never,
    cmsApi as never,
    dbService as never,
    invoiceOutcomeService as never,
    userContactClient as never,
    configService as never,
    publisher as never,
  );
  return { poller, cmsMemberService, publisher, userContactClient, invoiceOutcomeService };
}

describe('CmsMemberPollerService — 심사 거절 통지', () => {
  it('심사 실패면 수신자를 실어 cms.member.rejected 를 발행한다', async () => {
    const { poller, publisher } = makePoller({ liveStatus: '신청실패' });

    await poller.pollPendingMembers();

    expect(publisher.enqueue).toHaveBeenCalledTimes(1);
    const [params] = publisher.enqueue.mock.calls[0];
    expect(params.eventType).toBe('cms.member.rejected');
    expect(params.payload).toMatchObject({
      cmsMemberId: 'A4801367',
      userId: 'user-1',
      email: 'a@b.com',
      userName: '최수경',
      reasonCode: 'Q201',
      reasonMessage: '생년월일 불일치',
    });
  });

  it('심사 통과면 통지하지 않는다', async () => {
    const { poller, publisher } = makePoller({ liveStatus: '신청완료' });

    await poller.pollPendingMembers();

    expect(publisher.enqueue).not.toHaveBeenCalled();
  });

  it('연락처를 못 찾아도 심사 결과 반영은 그대로 두고 통지만 거른다', async () => {
    const { poller, publisher, cmsMemberService } = makePoller({ liveStatus: '신청실패', contact: null });

    await poller.pollPendingMembers();

    expect(cmsMemberService.updateStatus).toHaveBeenCalledWith('cms-row-1', 'FAILED', 'Q201', '생년월일 불일치');
    expect(publisher.enqueue).not.toHaveBeenCalled();
  });

  it('user-service 연동이 없는 환경이면 조회 없이 스킵한다 — 고장이 아니라 구성이다', async () => {
    const { poller, publisher, userContactClient, cmsMemberService } = makePoller({
      liveStatus: '신청실패',
      configured: false,
    });

    await poller.pollPendingMembers();

    expect(userContactClient.findContacts).not.toHaveBeenCalled();
    expect(publisher.enqueue).not.toHaveBeenCalled();
    expect(cmsMemberService.updateStatus).toHaveBeenCalledWith('cms-row-1', 'FAILED', 'Q201', '생년월일 불일치');
  });

  it('발행이 터져도 폴링을 중단시키지 않는다 — 상태는 이미 확정됐다', async () => {
    const { poller, publisher, cmsMemberService } = makePoller({ liveStatus: '신청실패' });
    publisher.enqueue.mockRejectedValue(new Error('kafka down'));

    await expect(poller.pollPendingMembers()).resolves.toBeUndefined();
    expect(cmsMemberService.updateStatus).toHaveBeenCalledWith('cms-row-1', 'FAILED', 'Q201', '생년월일 불일치');
  });

  // #707. 배포 창에서 태스크가 겹치면 두 인스턴스가 같은 PENDING 행을 읽는다. 조건부 UPDATE 가
  // 한 쪽만 통과시키므로, 진 쪽은 «통지까지» 건너뛰어야 한다 — 아니면 거절 안내가 두 번 나간다.
  it('상태 선점에 지면 거절 통지를 발행하지 않는다', async () => {
    const { poller, publisher, userContactClient, cmsMemberService } = makePoller({ liveStatus: '신청실패' });
    cmsMemberService.updateStatus.mockResolvedValue(false);

    await poller.pollPendingMembers();

    expect(cmsMemberService.updateStatus).toHaveBeenCalledWith('cms-row-1', 'FAILED', 'Q201', '생년월일 불일치');
    expect(publisher.enqueue).not.toHaveBeenCalled();
    expect(userContactClient.findContacts).not.toHaveBeenCalled();
  });

  it('심사 통과도 선점에 지면 후속 처리를 건너뛴다 — 인보이스를 두 번 당기지 않는다', async () => {
    const { poller, cmsMemberService, invoiceOutcomeService } = makePoller({ liveStatus: '신청완료' });
    cmsMemberService.updateStatus.mockResolvedValue(false);

    await poller.pollPendingMembers();

    expect(invoiceOutcomeService.pullForwardMandatePending).not.toHaveBeenCalled();
  });

  it('발행하는 경우 멱등키를 실어 아웃박스 유니크 제약이 발동하게 한다', async () => {
    const { poller, publisher } = makePoller({ liveStatus: '신청실패' });

    await poller.pollPendingMembers();

    expect(publisher.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'cms:member-rejected:cms-row-1' }),
      expect.anything(),
    );
  });
});
