import { CmsMemberPollerService } from './cms-member-poller.service';

// 심사 거절을 고객이 알 수 있는 유일한 경로가 이 발행이다 — mandate.rejected 는 인보이스가
// 있어야 나가므로 계좌만 등록한 사람(구독 전)은 그쪽으로 아무 통지도 못 받는다.

const MEMBER = {
  id: 'cms-row-1',
  cmsMemberId: 'A4801367',
  billingMethodId: 'bm-1',
  userId: 'user-1',
} as never;

function makePoller(opts: { liveStatus: string; contact?: { email: string; username: string } | null }) {
  const cmsMemberService = {
    findPendingMembers: jest.fn().mockResolvedValue([MEMBER]),
    updateStatus: jest.fn().mockResolvedValue(undefined),
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

  const poller = new CmsMemberPollerService(
    cmsMemberService as never,
    cmsApi as never,
    dbService as never,
    invoiceOutcomeService as never,
    userContactClient as never,
    publisher as never,
  );
  return { poller, cmsMemberService, publisher, userContactClient };
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

  it('발행이 터져도 폴링을 중단시키지 않는다 — 상태는 이미 확정됐다', async () => {
    const { poller, publisher, cmsMemberService } = makePoller({ liveStatus: '신청실패' });
    publisher.enqueue.mockRejectedValue(new Error('kafka down'));

    await expect(poller.pollPendingMembers()).resolves.toBeUndefined();
    expect(cmsMemberService.updateStatus).toHaveBeenCalledWith('cms-row-1', 'FAILED', 'Q201', '생년월일 불일치');
  });
});
