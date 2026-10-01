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

describe('SmsCampaignManager.continueWith', () => {
  const pending = [
    { userId: 'a', payload: { phoneNumber: '010-1234-5678', username: '가' }, metadata: { sentBy: 'staff' } },
    {
      userId: 'group:r1',
      payload: { phoneNumber: '+821099998888', username: '아몬드네일' },
      metadata: { sentBy: 'staff', recipientGroupId: 'g1' },
    },
  ];

  const setup = (original: object | undefined) => {
    const repository = {
      findCampaign: jest.fn().mockResolvedValue(original),
      continueCampaign: jest.fn(
        async (_from: string, _to: string, build: (rows: typeof pending) => { rows: unknown[] }) => {
          const built = build(pending);
          repository.built = built;
          return built.rows.length;
        },
      ),
      built: undefined as unknown,
    };
    const manager = new SmsCampaignManager(
      repository as unknown as SmsGateRepository,
      {} as SmsCampaignReader,
      new ConfigService({ STOREFRONT_URL: 'https://almondyoung.com' }),
    );
    return { repository, manager };
  };

  it('안 나간 명단으로 고친 내용의 새 발송을 만들고, 분류와 그룹 id 는 원래 것을 따른다', async () => {
    const { repository, manager } = setup({
      campaignId: 'old',
      status: 'PROCESSING',
      category: 'MARKETING',
      sendAt: null,
      metadata: { provider: 'sms-gate', recipients: 5 },
    });

    const result = await manager.continueWith(
      'old',
      { name: '가을 세일(수정)', content: '{{이름}}님 https://almondyoung.com/kr/sale' },
      'staff2',
    );

    expect(result.recipients).toBe(2);
    expect(repository.continueCampaign.mock.calls[0][0]).toBe('old');
    const { campaign, rows, links } = repository.built as {
      campaign: { campaignId: string; category: string; metadata: object; sendAt: Date | null };
      rows: { campaignId: string; renderedContent: { body: string }; metadata: object }[];
      links: { campaignId: string }[];
    };
    expect(campaign.campaignId).toBe(result.campaignId);
    expect(campaign.metadata).toMatchObject({ provider: 'sms-gate', recipients: 2, continuedFrom: 'old' });
    expect(campaign.sendAt).toBeNull();
    expect(rows[0].renderedContent.body).toMatch(/^\(광고\) 가님 https:\/\/almondyoung\.com\/r\/[A-Za-z0-9_-]{8}\n/);
    expect(rows[1].metadata).toEqual({ sentBy: 'staff2', recipientGroupId: 'g1' });
    expect(links.every((l) => l.campaignId === result.campaignId)).toBe(true);
  });

  it('원래 예약이 아직 안 왔으면 그 시각을 이어받는다', async () => {
    const sendAt = new Date(Date.now() + 60 * 60 * 1000);
    const { repository, manager } = setup({ status: 'SCHEDULED', category: 'INFORMATIONAL', sendAt, metadata: {} });
    await manager.continueWith('old', { name: 'n', content: 'c' }, 'staff');
    expect((repository.built as { campaign: { sendAt: Date } }).campaign.sendAt).toEqual(sendAt);
  });

  it('중지한 발송은 거절한다', async () => {
    const { manager } = setup({ status: 'CANCELLED', category: 'INFORMATIONAL', sendAt: null, metadata: {} });
    await expect(manager.continueWith('old', { name: 'n', content: 'c' }, 'staff')).rejects.toThrow('중지한 발송');
  });
});
