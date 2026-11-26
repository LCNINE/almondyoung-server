import { assertAudienceLoaded, classifyRecipients, normalizeListPhone } from './recipients';

describe('normalizeListPhone', () => {
  it.each(['010-0000-1111', '01000001111', '+821000001111', ' 010 0000 1111 ', '1000001111'])(
    '%p 는 +821000001111 이다',
    (raw) => {
      expect(normalizeListPhone(raw)).toBe('+821000001111');
    },
  );

  it.each(['', 'abc', '02-123-4567'])('%p 는 형식 오류다', (raw) => {
    expect(normalizeListPhone(raw)).toBeNull();
  });
});

describe('classifyRecipients', () => {
  it('형식·중복·수신거부·동의·회원 여부로 가른다', () => {
    const result = classifyRecipients({
      listPhones: [
        '010-0000-0001',
        '010-0000-0002',
        '010-0000-0003',
        '010-0000-0004',
        '010-0000-0005',
        '010-0000-0001',
        'bad',
      ],
      members: [
        { userId: 'u1', username: '가', phoneNumber: '010-0000-0001', marketingConsent: true, active: true },
        { userId: 'u2', username: '나', phoneNumber: '01000000002', marketingConsent: false, active: true },
        { userId: 'u3', username: '다', phoneNumber: '010-0000-0003', marketingConsent: true, active: true },
        { userId: 'u4', username: '라', phoneNumber: '+821000000003', marketingConsent: false, active: true },
      ],
      optedOut: new Set(['+821000000004']),
    });

    expect(result.recipients).toEqual([
      { phone: '+821000000001', userId: 'u1', username: '가' },
      { phone: '+821000000003', userId: null, username: null },
      { phone: '+821000000005', userId: null, username: null },
    ]);
    expect(result.counts).toEqual({
      listed: 7,
      invalid: 1,
      duplicateInList: 1,
      optedOut: 1,
      consentWithdrawn: 1,
      matchedOne: 1,
      matchedMany: 1,
      nonMember: 1,
      inactiveMember: 0,
      send: 3,
    });
  });

  it('한 번호의 계정이 여럿이고 아무도 동의하지 않았으면 뺀다', () => {
    const result = classifyRecipients({
      listPhones: ['010-0000-0003'],
      members: [
        { userId: 'u3', username: '다', phoneNumber: '010-0000-0003', marketingConsent: false, active: true },
        { userId: 'u4', username: '라', phoneNumber: '010-0000-0003', marketingConsent: false, active: true },
      ],
      optedOut: new Set(),
    });

    expect(result.recipients).toEqual([]);
    expect(result.counts.consentWithdrawn).toBe(1);
    expect(result.counts.send).toBe(0);
  });
});

describe('휴면·탈퇴 계정', () => {
  it('번호의 계정이 휴면·탈퇴뿐이면 비회원으로 보내지 않고 뺀다', () => {
    const result = classifyRecipients({
      listPhones: ['010-0000-0007'],
      members: [{ userId: 'u7', username: '사', phoneNumber: '010-0000-0007', marketingConsent: true, active: false }],
      optedOut: new Set(),
    });

    expect(result.recipients).toEqual([]);
    expect(result.counts.inactiveMember).toBe(1);
    expect(result.counts.nonMember).toBe(0);
  });

  it('활성 계정이 함께 있으면 활성 계정만 보고 판정한다', () => {
    const result = classifyRecipients({
      listPhones: ['010-0000-0008'],
      members: [
        { userId: 'u8', username: '아', phoneNumber: '010-0000-0008', marketingConsent: true, active: true },
        { userId: 'u9', username: '자', phoneNumber: '010-0000-0008', marketingConsent: false, active: false },
      ],
      optedOut: new Set(),
    });

    expect(result.recipients).toEqual([{ phone: '+821000000008', userId: 'u8', username: '아' }]);
    expect(result.counts.matchedOne).toBe(1);
  });
});

describe('assertAudienceLoaded', () => {
  it('테넌트에서 번호 있는 계정을 하나도 못 읽었으면 멈춘다 — 틀린 --tenant 면 모두가 비회원이 되어 동의 거르기가 꺼진다', () => {
    expect(() => assertAudienceLoaded([], 'acme')).toThrow('acme');
  });

  it('한 명이라도 있으면 지나간다', () => {
    expect(() =>
      assertAudienceLoaded([{ userId: 'u1', username: '가', phoneNumber: '010-0000-0001', marketingConsent: true, active: true }], 'acme'),
    ).not.toThrow();
  });
});
