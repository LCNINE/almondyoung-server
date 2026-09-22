import { UserContactClient } from '@app/shared';
import { SmsGateRepository } from '../repositories/sms-gate.repository';
import { SmsConversationManager } from './sms-conversation.manager';
import { SmsMessageManager } from './sms-message.manager';

describe('SmsConversationManager.reply', () => {
  const setup = (matched: { userId: string; username: string }[]) => {
    const repository = {
      findInbound: jest.fn().mockResolvedValue([{ userId: 'old-owner', deviceId: 'phone-a' }]),
    };
    const messageManager = { send: jest.fn().mockResolvedValue({ queued: [], skipped: [] }) };
    const contacts = { findActiveContactsByPhone: jest.fn().mockResolvedValue(matched) };
    const manager = new SmsConversationManager(
      repository as unknown as SmsGateRepository,
      messageManager as unknown as SmsMessageManager,
      contacts as unknown as UserContactClient,
    );
    return { manager, messageManager };
  };

  it('받은 뒤 번호를 바꾼 회원에게는 보내지 않고, 지금 그 번호를 쓰는 회원에게 받은 폰으로 보낸다', async () => {
    const { manager, messageManager } = setup([{ userId: 'current-owner', username: '새 주인' }]);

    await manager.reply({ phoneNumber: '010-1234-5678', content: '답장' }, 'staff');

    expect(messageManager.send).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['current-owner'], deviceId: 'phone-a', category: 'INFORMATIONAL' }),
      'staff',
    );
  });

  it('발송폰을 고르면 받은 폰 대신 그 폰으로 보낸다', async () => {
    const { manager, messageManager } = setup([{ userId: 'current-owner', username: '새 주인' }]);

    await manager.reply({ phoneNumber: '010-1234-5678', content: '답장', deviceId: 'phone-b' }, 'staff');

    expect(messageManager.send).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'phone-b' }), 'staff');
  });

  it('지금 그 번호를 쓰는 회원이 없으면 거절한다', async () => {
    const { manager, messageManager } = setup([]);

    await expect(manager.reply({ phoneNumber: '010-1234-5678', content: '답장' }, 'staff')).rejects.toThrow(
      '이 번호를 쓰는 회원이 없어 답장할 수 없습니다',
    );
    expect(messageManager.send).not.toHaveBeenCalled();
  });
});
