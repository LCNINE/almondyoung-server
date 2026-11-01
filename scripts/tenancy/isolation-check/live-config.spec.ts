import { parseIsolationCheckSecret, parseSecretList, stageServiceUrl } from './live-config';

describe('parseSecretList — `sst secret list` 출력', () => {
  it('Name=value 줄을 읽고 머리글·빈 줄은 무시한다', () => {
    const out = '# lcnine-services/live\nAdminWebOidcClientSecret=abc\n\nIsolationCheck={"a":1}\n';
    const map = parseSecretList(out);
    expect(map.get('AdminWebOidcClientSecret')).toBe('abc');
    expect(map.get('IsolationCheck')).toBe('{"a":1}');
  });

  it('값 안의 = 는 값의 일부다', () => {
    expect(parseSecretList('K=a=b==').get('K')).toBe('a=b==');
  });
});

describe('parseIsolationCheckSecret — 점검 계정 Secret', () => {
  const valid = {
    tenantOne: { loginId: 'c1', password: 'p1' },
    tenantTwo: { id: '2', loginId: 'c2', password: 'p2', adminRedirectUri: 'https://t2.example/auth/callback' },
    customer: { loginId: 'c3', password: 'p3', redirectUri: 'https://shop.example/kr/callback/oidc' },
  };

  it('완전한 값을 받는다', () => {
    expect(parseIsolationCheckSecret(JSON.stringify(valid)).tenantTwo.id).toBe('2');
  });

  it('칸이 빠지면 무엇이 빠졌는지와 넣는 명령을 말한다(기본값은 없다)', () => {
    const partial: Partial<typeof valid> = { ...valid };
    delete partial.customer;
    expect(() => parseIsolationCheckSecret(JSON.stringify(partial))).toThrow(
      /customer[\s\S]*sst secret set IsolationCheck/,
    );
  });

  it('JSON 이 아니면 거절한다', () => {
    expect(() => parseIsolationCheckSecret('nope')).toThrow(/JSON/);
  });
});

describe('stageServiceUrl — 인프라의 domain() 규칙과 같다', () => {
  it('live 는 <slug>.almondyoung.com', () => {
    expect(stageServiceUrl('live', 'core')).toBe('https://core.almondyoung.com');
  });

  it('그 밖의 stage 는 <slug>.dev.lcnine-dev.com', () => {
    expect(stageServiceUrl('dev', 'wallet')).toBe('https://wallet.dev.lcnine-dev.com');
  });
});
