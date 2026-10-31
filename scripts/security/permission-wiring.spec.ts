import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { TENANT_HEADER } from '@app/tenancy';

/**
 * 권한 판정 가드·가림 인터셉터의 «등록 순서»가 규칙대로인지(APP_GUARD·APP_INTERCEPTOR 는 루트 모듈 providers 순서대로 돈다).
 */
const ROOT = join(__dirname, '..', '..');
const ROOT_MODULES: Record<string, string> = {
  core: 'apps/core/src/app.module.ts',
  notification: 'apps/notification/src/notification.module.ts',
  'channel-adapter': 'apps/channel-adapter/src/adapter.module.ts',
  'user-service': 'apps/user-service/src/app.module.ts',
  membership: 'apps/membership/src/app.module.ts',
  'file-service': 'apps/file-service/src/file-service.module.ts',
  'ugc-service': 'apps/ugc-service/src/ugc-service.module.ts',
  ai: 'apps/ai/src/ai.module.ts',
  wallet: 'apps/wallet/src/wallet.module.ts',
  analytics: 'apps/analytics/src/analytics.module.ts',
  search: 'apps/search/src/search.module.ts',
};
/** 인증 가드가 컨트롤러 단위인 앱 — 강제 가드도 그 자리(JwtAuthGuard 바로 뒤)에 건다. */
const CONTROLLER_LEVEL_AUTH = new Set(['analytics', 'search']);

/** providers 배열에서 `{ provide: APP_GUARD|APP_INTERCEPTOR, useClass: X }` 를 순서대로. */
function enhancers(file: string): { token: string; useClass: string }[] {
  const src = ts.createSourceFile(file, readFileSync(join(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true);
  const out: { token: string; useClass: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const prop = (name: string) =>
        node.properties
          .find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === name)
          ?.initializer.getText();
      const token = prop('provide');
      const useClass = prop('useClass');
      if ((token === 'APP_GUARD' || token === 'APP_INTERCEPTOR') && useClass) out.push({ token, useClass });
    }
    node.forEachChild(visit);
  };
  src.forEachChild(visit);
  return out;
}

describe('권한 판정 배선', () => {
  for (const [app, file] of Object.entries(ROOT_MODULES)) {
    describe(app, () => {
      const list = enhancers(file);
      const guards = list.filter((e) => e.token === 'APP_GUARD').map((e) => e.useClass);

      // 판정 기록은 권한 가드가 판정한 자리에서 남긴다 — 옛 비교 관찰 장치를 다시 걸지 않는다.
      it('옛 그림자 관찰 장치를 걸지 않는다', () => {
        expect(list.map((e) => e.useClass)).not.toEqual(
          expect.arrayContaining([expect.stringMatching(/^AuthzObserverGuard$|^AuthzShadowInterceptor$/)]),
        );
      });

      if (CONTROLLER_LEVEL_AUTH.has(app)) {
        it('강제 가드는 전역이 아니다(컨트롤러 인증 뒤에 건다)', () => {
          expect(guards).not.toContain('PermissionGuard');
        });
      } else {
        it('강제 가드가 전역 가드 맨 뒤다', () => {
          expect(guards[guards.length - 1]).toBe('PermissionGuard');
        });
      }

      it('PermissionModule 을 등록한다', () => {
        expect(readFileSync(join(ROOT, file), 'utf8')).toMatch(/PermissionModule\.forRoot\(\{\s*service: '/);
      });
    });
  }

  it('analytics·search 에서 JwtAuthGuard 를 거는 곳마다 바로 뒤에 PermissionGuard 가 있다', () => {
    const files = execSync('grep -rl "UseGuards(JwtAuthGuard" apps/analytics/src apps/search/src --include=*.ts', {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter((f) => f && !f.endsWith('.spec.ts'));
    const offenders = files.flatMap((f) =>
      [...readFileSync(join(ROOT, f), 'utf8').matchAll(/@UseGuards\(([^)]*)\)/g)]
        .map((m) => m[1].split(',').map((s) => s.trim()))
        .filter((list) => list[0] === 'JwtAuthGuard' && list[1] !== 'PermissionGuard')
        .map((list) => `${f}: @UseGuards(${list.join(', ')})`),
    );
    expect(offenders).toEqual([]);
  });

  /**
   * providers 배열에서 `...piiMaskingProviders(` 펼침이 다른 전역 인터셉터보다 앞인지 — 응답 처리에선 앞에 둔 것이 바깥이라,
   * 감싸기·멱등 재생 같은 응답 인터셉터가 만든 최종 본문을 가린다.
   */
  function piiMaskingIsOutermost(file: string): boolean {
    const src = ts.createSourceFile(file, readFileSync(join(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true);
    let outermost = false;
    const visit = (node: ts.Node): void => {
      if (ts.isArrayLiteralExpression(node)) {
        const elements = [...node.elements];
        const pii = elements.findIndex(
          (e) => ts.isSpreadElement(e) && e.expression.getText().startsWith('piiMaskingProviders('),
        );
        if (pii >= 0) {
          const firstInterceptor = elements.findIndex((e) => /provide:\s*APP_INTERCEPTOR\b/.test(e.getText()));
          outermost = firstInterceptor === -1 || pii < firstInterceptor;
        }
      }
      node.forEachChild(visit);
    };
    src.forEachChild(visit);
    return outermost;
  }

  const appsDeclaringPii = (): string[] => {
    const out = execSync('grep -rl "@PiiResponse(" apps --include=*.ts || true', { cwd: ROOT, encoding: 'utf8' });
    const apps = out
      .trim()
      .split('\n')
      .filter((f) => f && !f.endsWith('.spec.ts'))
      .map((f) => f.split('/')[1]);
    return [...new Set(apps)].sort();
  };

  it('개인정보 응답을 선언한 앱은 가림 인터셉터를 전역 인터셉터 맨 앞에 둔다', () => {
    const declaring = appsDeclaringPii();
    expect(declaring.length).toBeGreaterThan(0);
    const missing = declaring.filter((app) => !ROOT_MODULES[app] || !piiMaskingIsOutermost(ROOT_MODULES[app]));
    expect(missing).toEqual([]);
  });
});

/**
 * 공유 서비스 문 배선. 1단계의 공유 서비스 일곱 개는 «T 만 섬김»이고, 나머지는 토큰 테넌트별이다 —
 * 이 목록 자체가 ADR 의 결정이라 손으로 적는다. 공유 서비스 하나를 테넌트 2 에게 열 때 여기서 빼는 것이 그 전환의 표지다.
 */
describe('공유 서비스 문 배선', () => {
  const SERVED_TENANT_APPS = [
    'analytics',
    'channel-adapter',
    'membership',
    'notification',
    'search',
    'ugc-service',
    'wallet',
  ];
  const tracked = (pattern: string): string[] =>
    execSync(`git ls-files -- ${pattern}`, { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
  const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
  const declared = (app: string) =>
    /PermissionModule\.forRoot\(\{[^}]*\btenancy:\s*'(served-tenant|per-token)'/.exec(read(ROOT_MODULES[app]))?.[1];

  it('일곱 앱이 «T 만 섬김», 나머지는 «토큰 테넌트별»을 선언한다', () => {
    const byMode = (mode: string) =>
      Object.keys(ROOT_MODULES)
        .filter((app) => declared(app) === mode)
        .sort();
    expect(byMode('served-tenant')).toEqual(SERVED_TENANT_APPS);
    expect(byMode('per-token')).toEqual(['ai', 'core', 'file-service', 'user-service']);
  });

  // T 가 env 에 없으면 «T 만 섬김» 앱은 뜨지 않는다. SST 쪽(`servedTenantEnv`)은 `tenancy-wiring.spec.ts` 가 소비 앱 전부에 대해 본다.
  it('일곱 앱은 로컬 정본에서 T 를 받는다', () => {
    const map = read('scripts/local/e2e-env-map.sh');
    const local = (/^E2E_SERVED_TENANT_APPS='([^']*)'$/m.exec(map)?.[1] ?? '').split(' ');
    expect(SERVED_TENANT_APPS.filter((app) => !local.includes(app))).toEqual([]);
  });

  /**
   * 서비스 고유 내부 키로 받는 컨트롤러(키 env 를 읽거나 앱 내부 인증 데코레이터를 쓰는 곳)는 서비스 키 입구 표식을 단다 —
   * 빠지면 그 라우트는 `@Public` 으로 보여 테넌트 헤더 없이 열린다.
   */
  it('«T 만 섬김» 앱의 서비스 키 입구는 전부 표식을 단다', () => {
    const decorators = SERVED_TENANT_APPS.flatMap((app) => tracked(`apps/${app}/src`)).filter((f) =>
      /export const \w+InternalAuth = \(\)/.test(read(f)),
    );
    expect(decorators.length).toBeGreaterThanOrEqual(2); // membership·ugc-service
    expect(decorators.filter((f) => !/ServiceKeyRoute\(\)/.test(read(f)))).toEqual([]);

    const receivers = SERVED_TENANT_APPS.flatMap((app) => tracked(`apps/${app}/src`)).filter((f) => {
      const src = read(f);
      return /@Controller\(/.test(src) && /['"`][A-Z_]+_INTERNAL_KEY['"`]/.test(src);
    });
    expect(receivers.length).toBeGreaterThanOrEqual(5); // search 1 + channel-adapter 4
    expect(receivers.filter((f) => !/@ServiceKeyRoute\(\)/.test(read(f)))).toEqual([]);
  });

  // 권한 가드가 전역이 아닌 앱에선 표식만으론 문이 안 돈다 — 그 라우트에 PermissionGuard 가 걸려 있어야 한다.
  it('컨트롤러 인증 앱의 서비스 키 입구는 PermissionGuard 를 건다', () => {
    const offenders = [...CONTROLLER_LEVEL_AUTH]
      .flatMap((app) => tracked(`apps/${app}/src`))
      .filter((f) => /@ServiceKeyRoute\(\)/.test(read(f)) && !/UseGuards\([^)]*PermissionGuard/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  /**
   * 내부 키로 다른 서비스를 부르는 곳은 테넌트 헤더를 싣는다(공용 `OutboundTenant`). 받는 쪽 문은 헤더가 없으면 ① 에서 세고
   * ② 에서 거절하므로, 빠뜨린 호출자는 ② 배포에서 깨진다. 받는 쪽(컨트롤러·가드·키 이름 주입)은 대상이 아니다.
   */
  it('내부 키 호출자는 테넌트 헤더를 싣는다', () => {
    // 권한 사본은 모든 테넌트에 공통인 역할 정의라 테넌트가 없다. 테넌트 상태는 모든 테넌트의 상태를 한 번에 받는다.
    const GLOBAL_CALLS = [
      'libs/authorization/src/services/http-role-permission.source.ts',
      'apps/core/src/platform/tenancy/http-tenant-status.source.ts',
    ];
    // ai 는 토큰 테넌트별 앱이고 맥락(CLS)이 없다 — 호출 테넌트를 요청 테넌트·수거 루프의 테넌트로 직접 싣는다.
    const PER_REQUEST = ['apps/ai/src/'];
    const NON_NEST = ['apps/medusa/', 'apps/admin-web/'];
    const callers = [...tracked('apps/*/src'), ...tracked('libs/*/src')].filter((f) => {
      const src = read(f);
      const usesKey = /(get<string>\(|process\.env\.)\s*'?[A-Z_]+_INTERNAL_KEY/.test(src);
      const receiver = /@Controller\(|implements CanActivate|INTERNAL_KEY_ENV/.test(src);
      return usesKey && /Bearer \$\{/.test(src) && !receiver;
    });
    expect(callers.length).toBeGreaterThanOrEqual(10);
    const missing = callers
      .filter((f) => !GLOBAL_CALLS.includes(f) && !PER_REQUEST.some((prefix) => f.startsWith(prefix)))
      .filter((f) => !NON_NEST.some((prefix) => f.startsWith(prefix)))
      .filter((f) => !/outboundTenant\.headers\(\)/.test(read(f)));
    expect(missing).toEqual([]);

    const ai = callers.filter((f) => PER_REQUEST.some((prefix) => f.startsWith(prefix)));
    expect(ai.length).toBeGreaterThanOrEqual(2); // 고아 수거 + 근태 검토
    expect(ai.filter((f) => !/\[TENANT_HEADER\]:/.test(read(f)))).toEqual([]);

    // Medusa 는 한 테넌트만 섬기는 앱이라 앱 설정 T 를 싣는다(`servedTenantHeaders`). 루트 libs 를 못 가져와 공용 클라이언트가
    // 닿지 않으므로 호출부마다 본다.
    const medusaMissing = callers
      .filter((f) => f.startsWith('apps/medusa/'))
      .filter((f) => !/servedTenantHeaders\(\)/.test(read(f)));
    expect(medusaMissing).toEqual([]);

    // admin-web 은 여러 테넌트를 섬기므로 T 를 그냥 싣지 않는다 — 토큰 테넌트를 판정한 결과(`admitServerCredentialTenant` 의
    // `tenantHeaders`)를 싣는다. 판정 없이 서버 자격증명을 쓰는 라우트는 admin-web 의 server-credential-routes.spec 이 막는다.
    const adminWeb = callers.filter((f) => f.startsWith('apps/admin-web/'));
    expect(adminWeb.length).toBeGreaterThanOrEqual(1);
    expect(adminWeb.filter((f) => !/\.\.\.\w+\.tenantHeaders\b/.test(read(f)))).toEqual([]);
  });

  // T 가 없으면 두 앱은 헤더를 싣지 않고(기본 테넌트로 채우지 않는다) 배포 ② 에서 깨진다.
  it('Nest 밖 한 테넌트 앱(Medusa·쇼핑몰)은 SST·로컬에서 T 를 받는다', () => {
    const services = read('deployments/lcnine/services/infra/services.ts');
    expect(services.match(/SERVED_TENANT_ID: servedTenantEnv\.SERVED_TENANT_ID,/g) ?? []).toHaveLength(2);
    // 앞 표지에서 다음 표지까지 — 표지가 없어지면 엉뚱한 구간을 보지 않고 빨갛다.
    const block = (from: string, to: string) => {
      const start = services.indexOf(from);
      const end = services.indexOf(to, start);
      expect(start >= 0 && end >= 0).toBe(true);
      return services.slice(start, end);
    };
    expect(block('const medusaEnv = {', 'const medusaCommon')).toContain(
      'SERVED_TENANT_ID: servedTenantEnv.SERVED_TENANT_ID,',
    );
    expect(block("new sst.aws.Nextjs('Storefront'", "new sst.aws.Nextjs('WalletWeb'")).toContain(
      'SERVED_TENANT_ID: servedTenantEnv.SERVED_TENANT_ID,',
    );

    const map = read('scripts/local/e2e-env-map.sh');
    expect(/^E2E_FIXED_TENANT_CALLERS='([^']*)'$/m.exec(map)?.[1]?.split(' ').sort()).toEqual(['medusa', 'storefront']);
  });

  // 없으면 admin-web 의 서버 자격증명 라우트(Medusa 프록시·channel-dispatch)가 503 이다 — 판정 설정에 기본값이 없다.
  it('admin-web 은 서버 자격증명 라우트의 T·전환 모드를 SST·로컬에서 받는다', () => {
    const code = read('apps/admin-web/src/lib/auth/server-credential-tenant.ts');
    expect(code).toContain('env.SERVER_CREDENTIAL_TENANT_ID');
    expect(code).toContain('env.TENANT_GATE_MODE');

    const services = read('deployments/lcnine/services/infra/services.ts');
    const start = services.indexOf("new sst.aws.Nextjs('AdminWeb'");
    const end = services.indexOf('new sst.aws.Nextjs(', start + 1);
    expect(start >= 0 && end > start).toBe(true);
    const adminWeb = services.slice(start, end);
    expect(adminWeb).toContain('SERVER_CREDENTIAL_TENANT_ID: servedTenantEnv.SERVED_TENANT_ID,');
    expect(adminWeb).toContain('TENANT_GATE_MODE: tenancyEnv.TENANT_GATE_MODE,');

    const map = read('scripts/local/e2e-env-map.sh');
    const shell = (name: string) => new RegExp(`^${name}='([^']*)'$`, 'm').exec(map)?.[1];
    expect(shell('E2E_SERVER_CREDENTIAL_GATE_APPS')).toBe('admin-web');
    const template = read('env-templates/.env.admin-web.local.example');
    expect(template).toContain(`SERVER_CREDENTIAL_TENANT_ID=${shell('E2E_SERVED_TENANT_ID')}\n`);
    expect(template).toContain(`TENANT_GATE_MODE=${shell('E2E_TENANT_GATE_MODE')}\n`);
  });

  // 세 트리는 루트 libs 를 못 가져와 헤더 이름을 사본으로 둔다.
  it('Medusa·쇼핑몰·admin-web 의 테넌트 헤더 이름은 @app/tenancy 와 같다', () => {
    const medusa = /export const TENANT_HEADER = '([^']+)'/.exec(
      read('apps/medusa/src/utils/served-tenant-headers.ts'),
    )?.[1];
    expect(medusa).toBe(TENANT_HEADER);
    const storefront = /\{ "([^"]+)": tenant \}/.exec(
      read('web/almondyoung-storefront/src/lib/config/backend.ts'),
    )?.[1];
    expect(storefront).toBe(TENANT_HEADER);
    const adminWeb = /export const TENANT_HEADER = '([^']+)'/.exec(
      read('apps/admin-web/src/lib/auth/server-credential-tenant.ts'),
    )?.[1];
    expect(adminWeb).toBe(TENANT_HEADER);
  });
});
