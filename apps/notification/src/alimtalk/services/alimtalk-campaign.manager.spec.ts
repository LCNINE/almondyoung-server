import { BadRequestError } from '@app/shared';
import { ALIMTALK_CAMPAIGN_PROVIDER_ID } from '../alimtalk.constants';
import { CreateAlimtalkCampaignDto } from '../dto';
import { AlimtalkCampaignManager } from './alimtalk-campaign.manager';
import { AlimtalkCampaignReader } from './alimtalk-campaign.reader';

const template = {
  templateCode: 'NOTICE_1',
  templateName: '안내',
  templateContent: '#{name}님, #{date}에 점검합니다',
  buttons: [],
  status: 'TSC03',
  variables: ['name', 'date'],
  linkedEvents: [],
};

const dto = (over: Partial<CreateAlimtalkCampaignDto> = {}): CreateAlimtalkCampaignDto => ({
  campaignId: '8d6f0f5e-6f0a-4b8e-9d7c-1a2b3c4d5e6f',
  name: '점검 안내',
  templateCode: 'NOTICE_1',
  members: 'MEMBERSHIP',
  groupIds: [],
  manual: [{ phone: '01011112222', name: '직접' }],
  variables: [
    { name: 'name', source: 'RECIPIENT_NAME' },
    { name: 'date', source: 'FIXED', value: '10월 1일' },
  ],
  confirmInformational: true,
  ...over,
});

function setup(options: { existing?: object; groups?: { id: string; name: string; source: string | null }[] } = {}) {
  const repository = {
    findCampaign: jest.fn().mockResolvedValue(options.existing),
    createCampaign: jest.fn().mockResolvedValue(true),
    findRecipientGroupsByIds: jest.fn().mockResolvedValue(options.groups ?? []),
    findGroupRecipients: jest.fn().mockResolvedValue([]),
  };
  const templateReader = { getApproved: jest.fn().mockResolvedValue(template) };
  const contacts = {
    findSmsAudience: jest.fn().mockResolvedValue([
      { userId: 'm1', username: '멤버', phoneNumber: '01033334444', marketingConsent: false },
      { userId: 'x1', username: '일반', phoneNumber: '01055556666', marketingConsent: true },
    ]),
  };
  const membership = {
    activeUserIds: jest.fn().mockResolvedValue(new Set(['m1'])),
    arrearsUserIds: jest.fn().mockResolvedValue(new Set(['x1'])),
  };
  const reader = new AlimtalkCampaignReader(
    repository as never,
    templateReader as never,
    {} as never,
    contacts as never,
    membership as never,
  );
  const manager = new AlimtalkCampaignManager(repository as never, reader, templateReader as never);
  return { manager, repository, contacts, membership };
}

describe('AlimtalkCampaignManager.create', () => {
  it('멤버십 회원만 고르면 활성 멤버십 명단에 있는 회원만 넣는다 (정보성이라 마케팅 동의로 거르지 않는다)', async () => {
    const { manager, repository } = setup();
    const result = await manager.create(dto(), 'admin-1');

    expect(result).toEqual({ campaignId: dto().campaignId, recipients: 2, created: true });
    const [campaign, rows] = repository.createCampaign.mock.calls[0];
    expect(rows.map((r: { userId: string }) => r.userId)).toEqual(['m1', 'manual:+821011112222']);
    expect(rows[0]).toMatchObject({
      channel: 'KAKAO',
      category: 'INFORMATIONAL',
      providerId: ALIMTALK_CAMPAIGN_PROVIDER_ID,
      status: 'PENDING',
      renderedContent: { body: '멤버님, 10월 1일에 점검합니다' },
      metadata: { sentBy: 'admin-1', templateCode: 'NOTICE_1', templateParameters: { name: '멤버', date: '10월 1일' } },
    });
    expect(campaign.metadata).toMatchObject({ provider: 'alimtalk', templateCode: 'NOTICE_1', recipients: 2 });
  });

  it('같은 campaignId 로 다시 오면 명단을 다시 만들지 않고 처음 결과를 돌려준다', async () => {
    const { manager, repository, contacts } = setup({
      existing: { campaignId: dto().campaignId, metadata: { recipients: 5 } },
    });
    const result = await manager.create(dto(), 'admin-1');
    expect(result).toEqual({ campaignId: dto().campaignId, recipients: 5, created: false });
    expect(contacts.findSmsAudience).not.toHaveBeenCalled();
    expect(repository.createCampaign).not.toHaveBeenCalled();
  });

  it('크롤링한 업소 그룹이 섞이면 만들지 않는다', async () => {
    const groupId = '11111111-1111-4111-8111-111111111111';
    const { manager, repository } = setup({ groups: [{ id: groupId, name: '네일샵', source: 'supabase' }] });
    await expect(manager.create(dto({ groupIds: [groupId] }), 'admin-1')).rejects.toBeInstanceOf(BadRequestError);
    expect(repository.createCampaign).not.toHaveBeenCalled();
  });

  it('값을 정하지 않은 변수가 있으면 만들지 않는다', async () => {
    const { manager, repository } = setup();
    await expect(
      manager.create(dto({ variables: [{ name: 'name', source: 'RECIPIENT_NAME' }] }), 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(repository.createCampaign).not.toHaveBeenCalled();
  });

  it('받는 사람을 하나도 고르지 않으면 만들지 않는다', async () => {
    const { manager } = setup();
    await expect(manager.create(dto({ members: 'NONE', manual: [] }), 'admin-1')).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  it('회원 전체면 멤버십 명단을 부르지 않는다', async () => {
    const { manager, repository, membership } = setup();
    await manager.create(dto({ members: 'ALL', manual: [] }), 'admin-1');
    expect(membership.activeUserIds).not.toHaveBeenCalled();
    expect(repository.createCampaign.mock.calls[0][1]).toHaveLength(2);
  });

  it('미납 회원만 고르면 미납 명단에 있는 회원만 넣고 멤버십 명단은 부르지 않는다', async () => {
    const { manager, repository, membership } = setup();
    await manager.create(dto({ members: 'ARREARS', manual: [] }), 'admin-1');
    expect(membership.activeUserIds).not.toHaveBeenCalled();
    const [campaign, rows] = repository.createCampaign.mock.calls[0];
    expect(rows.map((r: { userId: string }) => r.userId)).toEqual(['x1']);
    expect(campaign.metadata).toMatchObject({ members: 'ARREARS', recipients: 1 });
  });

  it('지난 시각으로 예약하면 막는다', async () => {
    const { manager } = setup();
    await expect(manager.create(dto({ sendAt: '2020-01-01T00:00:00Z' }), 'admin-1')).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });
});
