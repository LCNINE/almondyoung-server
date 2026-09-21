import { UserContactClient } from '@app/shared';
import { SmsGateRepository } from '../repositories/sms-gate.repository';
import { InboundSmsManager } from './inbound-sms.manager';

const received = (message: string) => ({
  event: 'sms:received',
  deviceId: 'phone-a',
  payload: { messageId: 'm1', message, sender: '010-1234-5678', receivedAt: '2026-09-21T05:00:00Z' },
});

describe('InboundSmsManager.handleReceived', () => {
  const setup = (findActiveContactsByPhone: jest.Mock) => {
    const repository = { saveInbound: jest.fn(), enqueue: jest.fn(), hasReplyFor: jest.fn() };
    const contacts = { findActiveContactsByPhone, withdrawMarketingConsentByPhone: jest.fn() };
    const manager = new InboundSmsManager(
      repository as unknown as SmsGateRepository,
      contacts as unknown as UserContactClient,
    );
    return { manager, repository, contacts };
  };

  it('수신거부가 아닌 문자도 E.164 번호와 매칭된 회원으로 저장한다', async () => {
    const { manager, repository, contacts } = setup(
      jest.fn().mockResolvedValue([{ userId: 'u1', username: '홍길동' }]),
    );

    await manager.handleReceived(received('배송 언제 와요?'));

    expect(repository.saveInbound).toHaveBeenCalledWith({
      gatewayMessageId: 'm1',
      phoneNumber: '+821012345678',
      body: '배송 언제 와요?',
      deviceId: 'phone-a',
      userId: 'u1',
      receivedAt: new Date('2026-09-21T05:00:00Z'),
    });
    expect(contacts.withdrawMarketingConsentByPhone).not.toHaveBeenCalled();
  });

  it('회원 매칭이 실패해도 문자는 저장한다', async () => {
    const { manager, repository } = setup(jest.fn().mockRejectedValue(new Error('timeout')));

    await manager.handleReceived(received('문의'));

    expect(repository.saveInbound).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
  });
});
