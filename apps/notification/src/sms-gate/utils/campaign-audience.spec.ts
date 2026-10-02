import { AudienceGroupRow, AudienceMember, mergeCampaignAudience } from './campaign-audience';

const member = (userId: string, phoneNumber: string, marketingConsent = true): AudienceMember => ({
  userId,
  username: userId,
  phoneNumber,
  marketingConsent,
});
const row = (id: string, groupId: string, phone: string): AudienceGroupRow => ({ id, groupId, name: id, phone });

describe('mergeCampaignAudience', () => {
  it('회원과 여러 그룹을 합치고 같은 번호는 먼저 나온 한 명만 남긴다', () => {
    const { recipients, duplicates, excluded } = mergeCampaignAudience({
      members: [member('u1', '010-1111-1111')],
      includeMembers: true,
      groupRows: [row('r1', 'g1', '+821011111111'), row('r2', 'g1', '01022222222'), row('r3', 'g2', '010-2222-2222')],
      marketing: false,
      optedOut: new Set(),
    });
    expect(recipients.map((r) => r.userId)).toEqual(['u1', 'group:r2']);
    expect(recipients[1].recipientGroupId).toBe('g1');
    expect(duplicates).toBe(2);
    expect(excluded).toBe(0);
  });

  it('광고면 수신거부 번호와 동의 안 한 회원의 번호를 그룹에서도 뺀다', () => {
    const { recipients, excluded } = mergeCampaignAudience({
      members: [member('u1', '01011111111', false), member('u2', '01033333333')],
      includeMembers: false,
      groupRows: [row('r1', 'g1', '010-1111-1111'), row('r2', 'g1', '01022222222'), row('r3', 'g1', '01033333333')],
      marketing: true,
      optedOut: new Set(['+821022222222']),
    });
    expect(recipients.map((r) => r.userId)).toEqual(['group:r3']);
    expect(excluded).toBe(2);
  });

  it('정보 문자는 수신거부·동의와 무관하게 보낸다', () => {
    const { recipients } = mergeCampaignAudience({
      members: [member('u1', '01011111111', false)],
      includeMembers: true,
      groupRows: [row('r1', 'g1', '01022222222')],
      marketing: false,
      optedOut: new Set(['+821022222222']),
    });
    expect(recipients).toHaveLength(2);
  });
});
