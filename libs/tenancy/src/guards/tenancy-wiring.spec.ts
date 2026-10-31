import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { consumerTenancyOf, findTenancyWiringViolations, requiresTenancy } from './tenancy-wiring';

/**
 * 테넌트 목록을 «받아야 하는» 앱의 게이트.
 *
 * 받아야 하는 앱 = Kafka 를 소비하는 앱(`main.ts` 가 `EventsModule.startConsumer` 를 부른다) + 테넌트 축이
 * 있는 file-service. 이 앱들의 루트 모듈(`NestFactory.create` 에 넘기는 모듈)은 `TenancyModule` 을 import 한다.
 * 빠지면 그 앱의 문이 목록을 못 읽는다 — 이벤트 문이라면 남의 테넌트 이벤트를 걸러 낼 기준이 없다.
 * 소비 앱 목록은 손으로 적지 않고 main.ts 에서 도출한다(새 소비 앱이 저절로 걸린다).
 */
const file = (path: string, content: string) => ({ path, content });
const consumerMain = (rootModule: string, from: string) =>
  `import { ${rootModule} } from '${from}';\n` +
  `const app = await NestFactory.create<NestFastifyApplication>(\n  ${rootModule},\n);\n` +
  `await EventsModule.startConsumer(app, { groupId: 'g', tenancy: 'served-tenant' });`;

describe('findTenancyWiringViolations (픽스처)', () => {
  it('소비 앱의 루트 모듈이 TenancyModule 을 import 하면 통과', () => {
    const v = findTenancyWiringViolations([
      file('apps/foo/src/main.ts', consumerMain('FooModule', './foo.module')),
      file(
        'apps/foo/src/foo.module.ts',
        `import { TenancyModule } from '@app/tenancy';\n@Module({ imports: [TenancyModule] })`,
      ),
    ]);
    expect(v).toEqual([]);
  });

  it('소비 앱의 루트 모듈에 TenancyModule 이 없으면 위반', () => {
    const v = findTenancyWiringViolations([
      file('apps/foo/src/main.ts', consumerMain('FooModule', './foo.module')),
      file('apps/foo/src/foo.module.ts', `@Module({ imports: [] })`),
    ]);
    expect(v).toEqual([expect.objectContaining({ app: 'foo', rule: 'tenancy-module-missing' })]);
  });

  it('소비하지 않는 앱은 검사하지 않는다', () => {
    const v = findTenancyWiringViolations([
      file('apps/bar/src/main.ts', `const app = await NestFactory.create(BarModule);`),
      file('apps/bar/src/bar.module.ts', `@Module({})`),
    ]);
    expect(v).toEqual([]);
  });

  it('file-service 는 소비하지 않아도 검사한다 — 파일 버킷을 목록에서 고른다', () => {
    const v = findTenancyWiringViolations([
      file(
        'apps/file-service/src/main.ts',
        `import { FileServiceModule } from './file-service.module';\nNestFactory.create(FileServiceModule);`,
      ),
      file('apps/file-service/src/file-service.module.ts', `@Module({})`),
    ]);
    expect(v).toEqual([expect.objectContaining({ app: 'file-service', rule: 'tenancy-module-missing' })]);
  });

  it('소비 앱이 테넌트 모드를 선언하지 않으면 위반', () => {
    const v = findTenancyWiringViolations([
      file(
        'apps/foo/src/main.ts',
        `import { FooModule } from './foo.module';\nNestFactory.create(FooModule);\n` +
          `await EventsModule.startConsumer(app, { groupId: 'g' });`,
      ),
      file('apps/foo/src/foo.module.ts', `@Module({ imports: [TenancyModule] })`),
    ]);
    expect(v).toEqual([expect.objectContaining({ app: 'foo', rule: 'consumer-tenancy-missing' })]);
  });

  it('선언된 모드를 main.ts 에서 읽는다', () => {
    expect(consumerTenancyOf(file('apps/foo/src/main.ts', consumerMain('FooModule', './foo.module')))).toBe(
      'served-tenant',
    );
    expect(
      consumerTenancyOf(file('apps/bar/src/main.ts', `EventsModule.startConsumer(app, { tenancy: 'per-message' })`)),
    ).toBe('per-message');
    // 호출 밖(주석 등)의 글자는 선언이 아니다
    expect(
      consumerTenancyOf(
        file(
          'apps/qux/src/main.ts',
          `// tenancy: 'per-message'\nawait EventsModule.startConsumer(app, { groupId: 'g' });`,
        ),
      ),
    ).toBeUndefined();
    expect(consumerTenancyOf(file('apps/baz/src/main.ts', `NestFactory.create(BazModule);`))).toBeUndefined();
  });

  it('루트 모듈 파일을 못 찾으면 위반 — 조용히 통과시키지 않는다', () => {
    const v = findTenancyWiringViolations([
      file('apps/foo/src/main.ts', consumerMain('FooModule', './nowhere.module')),
    ]);
    expect(v).toEqual([expect.objectContaining({ app: 'foo', rule: 'root-module-unresolved' })]);
  });
});

describe('저장소 전수', () => {
  it('목록을 받아야 하는 앱은 전부 TenancyModule 을 import 한다', () => {
    const REPO = join(__dirname, '..', '..', '..', '..');
    const paths = execFileSync('git', ['ls-files', '--', 'apps/'], { cwd: REPO, encoding: 'utf8' })
      .split('\n')
      .filter((p) => /^apps\/[^/]+\/src\/[^/]+\.ts$/.test(p));
    const files = paths.map((p) => ({ path: p, content: readFileSync(join(REPO, p), 'utf8') }));
    // 도출이 비면 게이트가 아무것도 안 잰다 — 오늘 소비 앱 10 + file-service.
    expect(files.filter((f) => f.path.endsWith('/main.ts') && requiresTenancy(f)).length).toBeGreaterThanOrEqual(11);
    expect(findTenancyWiringViolations(files)).toEqual([]);
  });

  it('SST 가 그 앱들에 목록·모드를 넣는다 — 모듈만 붙이고 env 가 없으면 배포한 태스크가 뜨지 않는다', () => {
    const REPO = join(__dirname, '..', '..', '..', '..');
    const read = (p: string) => readFileSync(join(REPO, p), 'utf8');
    const apps = execFileSync('git', ['ls-files', '--', 'apps/*/src/main.ts'], { cwd: REPO, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map((p) => ({ path: p, content: read(p) }))
      .filter((f) => requiresTenancy(f))
      .map((f) => f.path.split('/')[1]);

    // user-service 는 lcnine-auth, 나머지는 lcnine-services 가 띄운다. 값의 SoT 는 auth 앱 하나다.
    const auth = read('deployments/lcnine/auth/infra/services.ts');
    expect(auth).toMatch(/TENANT_LIST: tenantList\.value/);
    expect(auth).toMatch(/TENANT_GATE_MODE: tenantGateMode/);
    // user-service 의 앱 설정 T(고객·근태·옛 내부 토큰). 빠지면 user-service 가 뜨지 않는다.
    expect(auth).toMatch(/SERVED_TENANT_ID: servedTenantId\.value/);
    const services = read('deployments/lcnine/services/infra/services.ts');
    const spreads = services.match(/\.\.\.tenancyEnv,/g) ?? [];
    expect(spreads).toHaveLength(apps.filter((a) => a !== 'user-service').length);
  });
});

describe('소비 앱의 테넌트 모드', () => {
  const REPO = join(__dirname, '..', '..', '..', '..');
  const read = (p: string) => readFileSync(join(REPO, p), 'utf8');
  const consumers = execFileSync('git', ['ls-files', '--', 'apps/*/src/main.ts'], { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((p) => ({ path: p, content: read(p) }))
    .filter((f) => f.content.includes('EventsModule.startConsumer'))
    .map((f) => ({ app: f.path.split('/')[1], tenancy: consumerTenancyOf(f) }));
  const served = consumers.filter((c) => c.tenancy === 'served-tenant').map((c) => c.app);

  it('core·user-service 는 «메시지마다», 나머지 소비 앱은 «T 만 섬김» 이다', () => {
    expect(consumers.length).toBeGreaterThanOrEqual(10);
    expect(
      consumers
        .filter((c) => c.tenancy === 'per-message')
        .map((c) => c.app)
        .sort(),
    ).toEqual(['core', 'user-service']);
    expect(consumers.filter((c) => c.tenancy === undefined)).toEqual([]);
  });

  // T 가 없으면 «T 만 섬김» 앱은 뜨지 않는다. services 배포의 소비 앱은 auth 의 ServedTenantId 를 SSM 으로 받는다.
  it('SST 가 «T 만 섬김» 앱에 T 를 넣는다', () => {
    const services = read('deployments/lcnine/services/infra/services.ts');
    expect(services.match(/\.\.\.servedTenantEnv,/g) ?? []).toHaveLength(served.length);
  });

  it('로컬 E2E 정본이 «T 만 섬김» 앱에 T 를 넣는다', () => {
    const map = read('scripts/local/e2e-env-map.sh');
    const apps = (/^E2E_SERVED_TENANT_APPS='([^']*)'$/m.exec(map)?.[1] ?? '').split(' ');
    expect(served.filter((a) => !apps.includes(a))).toEqual([]);
  });
});
