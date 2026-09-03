import { classifyLookupMatches } from './classify-lookup-matches';

type User = { id: string; loginId?: string; email?: string; username?: string; nickname?: string; phoneNumber?: string };
const ids = (u: User) => [u.loginId, u.email, u.username, u.nickname];
const phone = (u: User) => u.phoneNumber;

describe('classifyLookupMatches', () => {
  it('0건이면 not_found 다', () => {
    expect(classifyLookupMatches('bob', [], ids, phone)).toEqual({ kind: 'not_found' });
  });

  it('정확히 일치하는 1건이면 resolved 다', () => {
    const match = { id: 'u1', loginId: 'bob', email: 'bob@example.com' };
    expect(classifyLookupMatches('bob', [match], ids, phone)).toEqual({ kind: 'resolved', match });
  });

  it('이메일로도 정확 일치를 인정한다', () => {
    const match = { id: 'u1', loginId: 'bob', email: 'bob@example.com' };
    expect(classifyLookupMatches('bob@example.com', [match], ids, phone)).toEqual({
      kind: 'resolved',
      match,
    });
  });

  it('대소문자·앞뒤 공백은 무시한다', () => {
    const match = { id: 'u1', loginId: 'Bob', email: 'BOB@Example.com' };
    expect(classifyLookupMatches('  bob@example.COM  ', [match], ids, phone)).toEqual({
      kind: 'resolved',
      match,
    });
  });

  // 🔴 이 스펙이 이 파일의 이유다. user-service 의 `q` 는 ilike 부분일치라, 「1건이면 그 사람」
  // 으로 읽으면 오타 하나가 **남의 계정에 쿠폰을 발급한다**.
  it('부분일치뿐이면 not_found 다 — 유일한 히트여도 발급하지 않는다', () => {
    const bobby = { id: 'u2', loginId: 'bobby', email: 'bobby@example.com' };
    expect(classifyLookupMatches('bob', [bobby], ids, phone)).toEqual({ kind: 'not_found' });
  });

  it('부분일치가 섞여 있어도 정확 일치 1건이면 그것을 고른다', () => {
    const bob = { id: 'u1', loginId: 'bob', email: 'bob@example.com' };
    const bobby = { id: 'u2', loginId: 'bobby', email: 'bobby@example.com' };
    expect(classifyLookupMatches('bob', [bobby, bob], ids, phone)).toEqual({ kind: 'resolved', match: bob });
  });

  it('정확 일치가 둘 이상이면 ambiguous 다', () => {
    const a = { id: 'u1', loginId: 'bob', email: 'a@example.com' };
    const b = { id: 'u2', loginId: 'other', email: 'bob' };
    expect(classifyLookupMatches('bob', [a, b], ids, phone)).toEqual({ kind: 'ambiguous' });
  });

  it('부분일치가 여럿이어도 정확 일치가 없으면 not_found 다 — ambiguous 가 아니다', () => {
    // 「두 명 이상 일치합니다」라고 안내하면 관리자는 좁혀 쓰면 된다고 읽는다. 그런데 실제로는
    // 그 입력에 해당하는 사람이 아예 없으므로 「찾을 수 없습니다」가 맞다.
    expect(
      classifyLookupMatches('bob', [{ id: 'u1', loginId: 'bobby' }, { id: 'u2', loginId: 'bobcat' }], ids, phone),
    ).toEqual({ kind: 'not_found' });
  });

  it('빈 입력은 not_found 다 — 무엇과도 «정확히» 같지 않다', () => {
    expect(classifyLookupMatches('   ', [{ id: 'u1', loginId: 'bob' }], ids, phone)).toEqual({
      kind: 'not_found',
    });
  });

  // 🔴 서버 `q` 는 username·nickname·전화번호까지 훑는다. 이 축들이 정확일치 목록에서 빠지면
  // 서버가 정확히 한 명을 찾아 줬는데도 「회원을 찾을 수 없습니다」가 된다.
  it('username 으로도 정확 일치를 인정한다', () => {
    const match = { id: 'u1', loginId: 'a1', email: 'a@x.com', username: '김철수' };
    expect(classifyLookupMatches('김철수', [match], ids, phone)).toEqual({ kind: 'resolved', match });
  });

  it('nickname 으로도 정확 일치를 인정한다', () => {
    const match = { id: 'u1', loginId: 'a1', email: 'a@x.com', nickname: '철수야' };
    expect(classifyLookupMatches('철수야', [match], ids, phone)).toEqual({ kind: 'resolved', match });
  });

  it('전화번호는 하이픈을 무시하고 비교한다', () => {
    const match = { id: 'u1', loginId: 'a1', phoneNumber: '01012345678' };
    expect(classifyLookupMatches('010-1234-5678', [match], ids, phone)).toEqual({ kind: 'resolved', match });
  });

  it('저장값이 +82 표기여도 010 입력과 일치한다', () => {
    const match = { id: 'u1', loginId: 'a1', phoneNumber: '+821012345678' };
    expect(classifyLookupMatches('010-1234-5678', [match], ids, phone)).toEqual({ kind: 'resolved', match });
  });

  it('짧은 숫자 입력은 전화번호로 보지 않는다 — 우연한 일치 방지', () => {
    const match = { id: 'u1', loginId: 'a1', phoneNumber: '01012345678' };
    expect(classifyLookupMatches('1234', [match], ids, phone)).toEqual({ kind: 'not_found' });
  });

  it('phoneOf 를 안 넘기면 전화번호 축은 그냥 비활성이다', () => {
    const match = { id: 'u1', loginId: 'a1', phoneNumber: '01012345678' };
    expect(classifyLookupMatches('010-1234-5678', [match], ids)).toEqual({ kind: 'not_found' });
  });
});
