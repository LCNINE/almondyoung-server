import { SmsGateRepository } from '../repositories/sms-gate.repository';
import { SmsCampaignManager } from './sms-campaign.manager';
import { SmsCampaignReader } from './sms-campaign.reader';

describe('SmsCampaignManager.create', () => {
  it('확정된 명단대로 행을 만들고, 그룹 행에는 그룹 id 를 남긴다', async () => {
    const repository = { createCampaign: jest.fn() };
    const reader = {
      resolveAudience: jest.fn().mockResolvedValue({
        recipients: [
          { userId: 'a', username: '가', phoneNumber: '010-1234-5678' },
          { userId: 'group:r1', username: '아몬드네일', phoneNumber: '+821099998888', recipientGroupId: 'g1' },
        ],
        excluded: 0,
        duplicates: 1,
      }),
    };
    const manager = new SmsCampaignManager(
      repository as unknown as SmsGateRepository,
      reader as unknown as SmsCampaignReader,
    );

    const dto = {
      name: 't',
      category: 'INFORMATIONAL' as const,
      content: '{{이름}}님',
      includeMembers: true,
      groupIds: ['g1'],
    };
    const result = await manager.create(dto, 'staff');

    expect(reader.resolveAudience).toHaveBeenCalledWith(dto);
    expect(result.recipients).toBe(2);
    const [campaign, rows] = repository.createCampaign.mock.calls[0];
    expect(campaign.metadata).toMatchObject({ includeMembers: true, recipientGroupIds: ['g1'] });
    expect(rows.map((row: { userId: string; metadata: object }) => [row.userId, row.metadata])).toEqual([
      ['a', { sentBy: 'staff' }],
      ['group:r1', { sentBy: 'staff', recipientGroupId: 'g1' }],
    ]);
    expect(rows[1].renderedContent.body).toContain('아몬드네일님');
  });
});
