import { NhnRequestRejectedError } from '../clients/nhn-alimtalk.client';
import { AlimtalkDispatchManager } from './alimtalk-dispatch.manager';

const row = (id: string, phone: string | null = '010-1234-5678') => ({
  notificationId: id,
  userId: `group:${id}`,
  payload: phone === null ? {} : { phoneNumber: phone, username: `이름${id}` },
  metadata: { templateCode: 'NOTICE_1', templateParameters: { name: `이름${id}` } },
});

function setup(rows: ReturnType<typeof row>[], send: jest.Mock) {
  const repository = {
    failStaleProcessing: jest.fn().mockResolvedValue(0),
    findNextDueCampaignId: jest.fn().mockResolvedValue(rows.length ? 'camp-1' : null),
    claimBatch: jest.fn().mockResolvedValue(rows),
    markSent: jest.fn(),
    markFailed: jest.fn(),
    failPending: jest.fn().mockResolvedValue(7),
  };
  const manager = new AlimtalkDispatchManager(repository as never, { sendTemplateBatch: send } as never);
  return { manager, repository };
}

describe('AlimtalkDispatchManager', () => {
  const originalEnv = process.env.NODE_ENV;
  beforeAll(() => {
    process.env.NODE_ENV = 'production';
  });
  afterAll(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('한 묶음을 NHN 한 요청으로 보내고, 접수된 행과 거절된 행을 나눠 적는다', async () => {
    const send = jest.fn().mockResolvedValue({
      requestId: 'req-1',
      results: [
        { recipientGroupingKey: 'a', resultCode: 0, resultMessage: '' },
        { recipientGroupingKey: 'b', resultCode: -1, resultMessage: '잘못된 번호' },
      ],
    });
    const { manager, repository } = setup([row('a'), row('b')], send);
    await manager.dispatchDue(new Date());

    expect(send).toHaveBeenCalledTimes(1);
    const request = send.mock.calls[0][0];
    expect(request.templateCode).toBe('NOTICE_1');
    expect(request.senderGroupingKey).toBe('camp-1');
    expect(request.recipients).toEqual([
      { recipientNo: '010-1234-5678', templateParameter: { name: '이름a' }, recipientGroupingKey: 'a' },
      { recipientNo: '010-1234-5678', templateParameter: { name: '이름b' }, recipientGroupingKey: 'b' },
    ]);
    expect(repository.markSent).toHaveBeenCalledWith(['a'], 'req-1');
    expect(repository.markFailed).toHaveBeenCalledWith(['b'], '잘못된 번호');
  });

  it('NHN 이 요청 자체를 거절하면 이 묶음과 같은 캠페인의 남은 건을 모두 실패로 닫는다', async () => {
    const send = jest.fn().mockRejectedValue(new NhnRequestRejectedError('템플릿 미승인'));
    const { manager, repository } = setup([row('a')], send);
    await manager.dispatchDue(new Date());
    expect(repository.markFailed).toHaveBeenCalledWith(['a'], expect.stringContaining('템플릿 미승인'));
    expect(repository.failPending).toHaveBeenCalledWith('camp-1', expect.stringContaining('템플릿 미승인'));
    expect(repository.markSent).not.toHaveBeenCalled();
  });

  it('응답을 못 받으면(타임아웃) 나갔을 수 있어 다시 보내지 않고 실패로 적는다', async () => {
    const send = jest.fn().mockRejectedValue(new Error('timeout of 30000ms exceeded'));
    const { manager, repository } = setup([row('a')], send);
    await manager.dispatchDue(new Date());
    expect(repository.markFailed).toHaveBeenCalledWith(['a'], expect.stringContaining('다시 보내지 않았습니다'));
    expect(repository.failPending).not.toHaveBeenCalled();
  });

  it('번호가 없는 행은 NHN 에 넘기지 않는다', async () => {
    const send = jest.fn().mockResolvedValue({
      requestId: 'req-1',
      results: [{ recipientGroupingKey: 'a', resultCode: 0, resultMessage: '' }],
    });
    const { manager, repository } = setup([row('a'), row('b', null)], send);
    await manager.dispatchDue(new Date());
    expect(send.mock.calls[0][0].recipients).toHaveLength(1);
    expect(repository.markFailed).toHaveBeenCalledWith(['b'], expect.stringContaining('수신 번호'));
  });

  it('보낼 것이 없으면 NHN 을 부르지 않는다', async () => {
    const send = jest.fn();
    const { manager } = setup([], send);
    await manager.dispatchDue(new Date());
    expect(send).not.toHaveBeenCalled();
  });
});
