import { StepRefused } from '../runner';
import { deployTodo, prepareSlotSecrets, prepareTenantListSecret, suspendTodo } from './human-stops';

/**
 * 사람 손 멈춤 지점 — «무엇을, 어느 Secret 에, 어떤 명령으로». 값은 git 밖 0600 파일에 쓰고 출력에는 그 파일 경로만
 * 싣는다(`sst secret load <파일>`). 터미널 스크롤백·붙여 넣은 이슈에 테넌트 도메인·ARN 이 남지 않게.
 */
const admin = {
  domain: 'admin.acme.test',
  certArn: 'arn:aws:acm:us-east-1:000000000000:certificate/example-a',
  zoneId: 'ZACME1',
};
const auth = {
  domain: 'login.acme.test',
  certArn: 'arn:aws:acm:us-east-1:000000000000:certificate/example-b',
  zoneId: 'ZACME1',
};
const values = [admin.domain, admin.certArn, auth.domain, auth.certArn, admin.zoneId];

describe('칸 Secret 멈춤 (18 의 칸 켜기 ①)', () => {
  const prepared = prepareSlotSecrets({ stage: 'live', slot: 3, admin, auth, dir: '/private/plans' });
  const todo = prepared.todo.join('\n');

  it('두 앱에 셋씩 — AdminWeb 은 services, AuthWeb 은 auth', () => {
    const services = prepared.files.find((f) => f.path.includes('services'));
    const authFile = prepared.files.find((f) => f.path.includes('auth'));
    expect(services?.content).toBe(
      [
        'AdminWebTenantSlot3Domain=admin.acme.test',
        `AdminWebTenantSlot3CertArn=${admin.certArn}`,
        'AdminWebTenantSlot3ZoneId=ZACME1',
        '',
      ].join('\n'),
    );
    expect(authFile?.content).toBe(
      [
        'AuthWebTenantSlot3Domain=login.acme.test',
        `AuthWebTenantSlot3CertArn=${auth.certArn}`,
        'AuthWebTenantSlot3ZoneId=ZACME1',
        '',
      ].join('\n'),
    );
    expect(todo).toContain(`cd deployments/lcnine/services && npx sst secret load '${services?.path}' --stage live`);
    expect(todo).toContain(`cd deployments/lcnine/auth && npx sst secret load '${authFile?.path}' --stage live`);
    for (const name of [
      'AdminWebTenantSlot3Domain',
      'AdminWebTenantSlot3CertArn',
      'AdminWebTenantSlot3ZoneId',
      'AuthWebTenantSlot3ZoneId',
    ]) {
      expect(todo).toContain(name);
    }
  });

  it('출력에 값이 없다', () => {
    for (const v of values) expect(todo).not.toContain(v);
  });

  it('칸 켜기 세 걸음을 순서대로 싣는다 — ① 지금, ② 표 커밋·③ 배포는 그 뒤', () => {
    const [one, two, three] = ['①', '② ', '③ '].map((m) => todo.indexOf(m));
    expect(one).toBeGreaterThanOrEqual(0);
    expect([one < two, two < three]).toEqual([true, true]);
  });

  it('파일 경로는 따옴표로 감싼다 — 공백 있는 경로에서 rm 이 엉뚱한 것을 지우지 않게', () => {
    const spaced = prepareSlotSecrets({ stage: 'live', slot: 3, admin, auth, dir: '/my plans' });
    expect(spaced.todo.join('\n')).toContain(
      `secret load '/my plans/tenant-slot-3.services.secrets.env' --stage live && rm '/my plans/`,
    );
  });

  it('표 커밋(②)은 아직이라고 못 박는다 — ② 가 먼저 들어가면 그 뒤 live 배포가 전부 멈춘다', () => {
    expect(todo).toMatch(/TENANT_DOMAIN_SLOTS.*아직/);
  });
});

describe('목록 Secret 멈춤', () => {
  const tenantOne = { id: '1', slug: 'one', coreDb: 'core', publicBucket: 'one-files', privateBucket: 'one-files' };
  const entry = {
    id: '2',
    slug: 'acme',
    coreDb: 'core_acme',
    publicBucket: 'acme-public-x1',
    privateBucket: 'acme-private-x1',
  };

  it('지금 목록 + 이 테넌트를 파일에 쓰고, 출력엔 auth 의 TenantList 와 명령만', () => {
    const prepared = prepareTenantListSecret({ stage: 'live', current: JSON.stringify([tenantOne]), entry, dir: '/p' });

    expect(prepared.files).toHaveLength(1);
    expect(prepared.files[0].content).toBe(`TenantList=${JSON.stringify([tenantOne, entry])}\n`);
    const todo = prepared.todo.join('\n');
    expect(todo).toContain(
      `cd deployments/lcnine/auth && npx sst secret load '${prepared.files[0].path}' --stage live`,
    );
    expect(todo).toContain('TenantList');
    for (const v of ['acme-public-x1', 'core_acme']) expect(todo).not.toContain(v);
  });

  it('같은 id 가 다른 값으로 이미 있으면 덮지 않는다', () => {
    expect(() =>
      prepareTenantListSecret({
        stage: 'live',
        current: JSON.stringify([tenantOne, { ...entry, slug: 'other' }]),
        entry,
        dir: '/p',
      }),
    ).toThrow(StepRefused);
  });
});

describe('배포 멈춤 (18 의 칸 켜기 ②·③)', () => {
  it('② 표 커밋 → ③ 배포(auth → services) 순서이고, 18 의 첫 배포 실측을 함께 싣는다', () => {
    const todo = deployTodo({ stage: 'live', slot: 3, tableHasSlot: false }).join('\n');

    const commit = todo.indexOf('TENANT_DOMAIN_SLOTS');
    const preflight = todo.indexOf('deploy:preflight');
    const authDeploy = todo.indexOf('cd deployments/lcnine/auth && npx sst deploy --stage live');
    const servicesDeploy = todo.indexOf('cd deployments/lcnine/services && npx sst deploy --stage live');
    expect(commit).toBeGreaterThanOrEqual(0);
    expect([commit < preflight, preflight < authDeploy, authDeploy < servicesDeploy]).toEqual([true, true, true]);
    expect(todo).toContain('live: [3]');
    expect(todo).toMatch(/sst diff/);
    expect(todo).toMatch(/AdminWebCdn/);
  });

  it('표에 이미 번호가 있으면 ② 는 «됐다»로 적는다', () => {
    expect(deployTodo({ stage: 'live', slot: 3, tableHasSlot: true }).join('\n')).toMatch(/② .*이미/);
  });
});

it('정지 명령은 계획 경로와 --suspend 를 싣는다', () => {
  expect(suspendTodo({ stage: 'live', planPath: '/p/acme.json' })).toBe(
    'npm run tenant:create -- --stage live --plan /p/acme.json --suspend',
  );
});
