import { mergeAlimtalkAudience } from './alimtalk-audience';

describe('mergeAlimtalkAudience', () => {
  it('회원 → 그룹 → 직접 입력 순으로 합치고 같은 번호는 먼저 나온 한 명만 남긴다', () => {
    const result = mergeAlimtalkAudience({
      members: [{ userId: 'u1', username: '회원', phoneNumber: '010-1111-2222' }],
      groupRows: [
        { id: 'r1', groupId: 'g1', name: '그룹중복', phone: '+821011112222' },
        { id: 'r2', groupId: 'g1', name: '그룹', phone: '+821033334444' },
      ],
      manual: [{ phone: '01033334444' }, { phone: '01055556666', name: ' 직접 ' }],
    });
    expect(result.recipients).toEqual([
      { userId: 'u1', phoneNumber: '010-1111-2222', name: '회원' },
      { userId: 'group:r2', phoneNumber: '+821033334444', name: '그룹', recipientGroupId: 'g1' },
      { userId: 'manual:+821055556666', phoneNumber: '01055556666', name: '직접' },
    ]);
    expect(result.duplicates).toBe(2);
    expect(result.invalid).toBe(0);
  });

  it('휴대폰이 아닌 번호(유선·안심번호·빈 값)는 뺀다', () => {
    const result = mergeAlimtalkAudience({
      members: [
        { userId: 'u1', username: 'a', phoneNumber: '02-123-4567' },
        { userId: 'u2', username: 'b', phoneNumber: '' },
      ],
      groupRows: [],
      manual: [{ phone: '0507-1234-5678' }],
    });
    expect(result.recipients).toEqual([]);
    expect(result.invalid).toBe(3);
  });

  it('직접 입력에 이름이 없으면 번호 뒤 4자리로 부른다', () => {
    const result = mergeAlimtalkAudience({ members: [], groupRows: [], manual: [{ phone: '010-9999-1234' }] });
    expect(result.recipients[0].name).toBe('1234');
  });
});
