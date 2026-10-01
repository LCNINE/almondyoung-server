import { ConfigService } from '@nestjs/config';
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
      new ConfigService({}),
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

  it('STOREFRONT_URL 이 있으면 수신자마다 다른 추적 링크로 바꾸고 원래 주소를 남긴다', async () => {
    const repository = { createCampaign: jest.fn() };
    const reader = {
      resolveAudience: jest.fn().mockResolvedValue({
        recipients: [
          { userId: 'a', username: '가', phoneNumber: '010-1234-5678' },
          { userId: 'b', username: '나', phoneNumber: '010-2222-3333' },
        ],
        excluded: 0,
        duplicates: 0,
      }),
    };
    const manager = new SmsCampaignManager(
      repository as unknown as SmsGateRepository,
      reader as unknown as SmsCampaignReader,
      new ConfigService({ STOREFRONT_URL: 'https://almondyoung.com' }),
    );

    await manager.create(
      { name: 't', category: 'INFORMATIONAL', content: '세일 https://almondyoung.com/kr/best', includeMembers: true },
      'staff',
    );

    const [campaign, rows, links] = repository.createCampaign.mock.calls[0];
    expect(campaign.content.SMS.body).toBe('세일 https://almondyoung.com/kr/best');
    expect(links).toHaveLength(2);
    expect(new Set(links.map((l: { code: string }) => l.code)).size).toBe(2);
    rows.forEach((row: { notificationId: string; renderedContent: { body: string } }, i: number) => {
      expect(links[i]).toMatchObject({ notificationId: row.notificationId, url: 'https://almondyoung.com/kr/best' });
      expect(row.renderedContent.body).toBe(`세일 https://almondyoung.com/r/${links[i].code}`);
    });
  });
});
