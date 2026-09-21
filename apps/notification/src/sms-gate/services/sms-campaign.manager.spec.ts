import { UserContactClient } from '@app/shared';
import { SmsGateRepository } from '../repositories/sms-gate.repository';
import { SmsCampaignManager } from './sms-campaign.manager';

describe('SmsCampaignManager.create', () => {
  it('표기만 다른 같은 번호는 한 통만 보낸다', async () => {
    const repository = { createCampaign: jest.fn() };
    const contacts = {
      findSmsAudience: jest.fn().mockResolvedValue([
        { userId: 'a', username: '가', phoneNumber: '010-1234-5678', marketingConsent: true },
        { userId: 'b', username: '나', phoneNumber: '+821012345678', marketingConsent: true },
        { userId: 'c', username: '다', phoneNumber: '01099998888', marketingConsent: true },
      ]),
    };
    const manager = new SmsCampaignManager(
      repository as unknown as SmsGateRepository,
      contacts as unknown as UserContactClient,
    );

    const result = await manager.create({ name: 't', category: 'INFORMATIONAL', content: '{{이름}}님' }, 'staff');

    expect(result.recipients).toBe(2);
    expect(repository.createCampaign.mock.calls[0][1].map((row: { userId: string }) => row.userId)).toEqual(['a', 'c']);
  });
});
