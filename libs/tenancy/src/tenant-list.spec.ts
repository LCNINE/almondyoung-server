import { parseTenantList } from './tenant-list';

const tenant1 = {
  id: '1',
  slug: 'almondyoung',
  coreDb: 'core',
  publicBucket: 'almondyoung-demo',
  privateBucket: 'almondyoung-demo',
};
// 가짜 값이다 — 공개 레포라 실제 테넌트 2 의 slug·버킷은 어디에도 적지 않는다.
const tenant2 = {
  id: '2',
  slug: 'acme',
  coreDb: 'core_acme',
  publicBucket: 'acme-pub-x1',
  privateBucket: 'acme-prv-x1',
};

function captureError(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    if (e instanceof Error) return e;
  }
  throw new Error('던지지 않았다');
}

describe('parseTenantList', () => {
  it('테넌트 1 항목(coreDb=core, 두 버킷 almondyoung-demo)은 통과한다', () => {
    const list = parseTenantList(JSON.stringify([tenant1]));
    expect(list.entries).toEqual([tenant1]);
    expect(list.find('1')).toEqual(tenant1);
  });

  it('id 가 겹치면 거절한다', () => {
    const dup = { ...tenant2, id: '1' };
    expect(() => parseTenantList(JSON.stringify([tenant1, dup]))).toThrow(/id «1» 가 2번/);
  });

  it('slug 가 겹치면 거절한다', () => {
    const dup = { ...tenant2, slug: 'almondyoung' };
    expect(() => parseTenantList(JSON.stringify([tenant1, dup]))).toThrow(/slug 가 테넌트 «1», «2» 에서 겹친다/);
  });

  it.each(['id', 'slug', 'coreDb', 'publicBucket', 'privateBucket'])('칸 %s 가 빠지면 거절한다', (key) => {
    const rest = Object.fromEntries(Object.entries(tenant2).filter(([k]) => k !== key));
    expect(() => parseTenantList(JSON.stringify([tenant1, rest]))).toThrow(new RegExp(`\\[1\\] ${key} 가 없다`));
  });

  it('칸이 빈 문자열이거나 문자열이 아니면 거절한다 — id 1 과 "1" 은 다른 값이다', () => {
    expect(() => parseTenantList(JSON.stringify([{ ...tenant1, id: 1 }]))).toThrow(/\[0\] id 가 없다/);
    expect(() => parseTenantList(JSON.stringify([{ ...tenant1, slug: '' }]))).toThrow(/\[0\] slug 가 없다/);
  });

  it('모르는 칸은 거절한다 — 이름·로고·도메인은 목록이 아니라 user-service 테넌트 행에 있다', () => {
    expect(() => parseTenantList(JSON.stringify([{ ...tenant1, domain: 'x.example' }]))).toThrow(
      /\[0\] 모르는 칸 domain/,
    );
  });

  it('값이 없거나 JSON 이 아니거나 빈 배열이면 거절한다', () => {
    expect(() => parseTenantList(undefined)).toThrow(/TENANT_LIST 가 없다/);
    expect(() => parseTenantList('  ')).toThrow(/TENANT_LIST 가 없다/);
    expect(() => parseTenantList('[{')).toThrow(/JSON 이 아니다/);
    expect(() => parseTenantList('{}')).toThrow(/배열이어야 한다/);
    expect(() => parseTenantList('[]')).toThrow(/테넌트가 하나도 없다/);
  });

  it('테넌트 1 과 1 이 아닌 테넌트가 함께 있는 목록은 통과한다', () => {
    expect(parseTenantList(JSON.stringify([tenant1, tenant2])).entries).toHaveLength(2);
  });

  it('1 이 아닌 테넌트의 publicBucket = privateBucket 은 거절한다', () => {
    const shared = { ...tenant2, privateBucket: tenant2.publicBucket };
    expect(() => parseTenantList(JSON.stringify([tenant1, shared]))).toThrow(/공용 버킷.*«1», «2»/);
  });

  it('두 테넌트가 같은 core DB 를 가리키면 거절한다', () => {
    const same = { ...tenant2, coreDb: 'core' };
    expect(() => parseTenantList(JSON.stringify([tenant1, same]))).toThrow(/coreDb 가 테넌트 «1», «2» 에서 겹친다/);
  });

  it('두 테넌트가 버킷 하나를 나눠 쓰면 거절한다', () => {
    const borrowed = { ...tenant2, publicBucket: 'almondyoung-demo' };
    expect(() => parseTenantList(JSON.stringify([tenant1, borrowed]))).toThrow(
      /버킷 하나를 테넌트 «1», «2» 가 함께 쓴다/,
    );
  });

  it('DB 이름·버킷 이름·slug·id 로 쓸 수 없는 글자는 거절한다', () => {
    const bad = {
      id: '2 2',
      slug: 'Acme',
      coreDb: 'core"; drop',
      publicBucket: 'Acme_Pub',
      privateBucket: 'acme-prv-x1',
    };
    const err = captureError(() => parseTenantList(JSON.stringify([tenant1, bad])));
    expect(err.message).toMatch(/\[1\] id /);
    expect(err.message).toMatch(/\[1\] slug /);
    expect(err.message).toMatch(/\[1\] coreDb /);
    expect(err.message).toMatch(/\[1\] publicBucket /);
    expect(err.message).not.toMatch(/\[1\] privateBucket /);
  });

  it('겹침을 알릴 때 slug·DB·버킷 값을 싣지 않는다 — 메시지는 로그로 간다', () => {
    const a = { id: 'a', slug: 'zeta', coreDb: 'db_zeta', publicBucket: 'zeta-bkt', privateBucket: 'zeta-bkt' };
    const b = { ...a, id: 'b' };
    const err = captureError(() => parseTenantList(JSON.stringify([a, b])));

    expect(err.message).toMatch(/«a», «b»/);
    for (const value of ['zeta', 'db_zeta', 'zeta-bkt']) {
      expect(err.message).not.toContain(value);
    }
  });

  it('JSON 이 아닐 때 원문을 메시지에 싣지 않는다 — 목록은 비공개 Secret 이다', () => {
    const err = captureError(() => parseTenantList('[{"slug":"secret-slug"'));
    expect(err.message).not.toContain('secret-slug');
  });
});
