import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * `@Public()` 만 붙고 키/서명 검증이 없는 **쓰기** 라우트는 공개 ALB 에 무인증 API 를 여는 것이다.
 * 2026-08 인가 감사에서 이렇게 열려 있던 게 3건이었다 (`docs/api-authz-audit-2026-08.md` P0):
 *
 * - ugc `POST /reviews/eligibilities` — 바디의 `userId` 로 리뷰 자격 발급 → 리뷰 → 포인트 적립.
 * - membership `POST /membership/benefits/internal/{record,cancel}` — 임의 사용자 혜택 기록 조작.
 *
 * 셋 다 "데코레이터를 빠뜨렸다"가 원인이고 **무증상**이었다. 그래서 개별 라우트가 아니라 규칙으로
 * 못을 박는다. 두 앱은 내부 호출을 전부 키 가드 뒤에 두므로 이 목록은 비어 있어야 정상이다.
 *
 * 새 항목을 허용해야 한다면 `ALLOWED` 에 **이유와 함께** 추가한다. 그 추가 자체가 리뷰 대상이다.
 */
const AUDIT = join(__dirname, 'route-authz-audit.js');

/** 무인증 쓰기가 정당한 라우트 (서명 검증 등 자체 방어가 있는 경우). `"VERB /route": '이유'` */
const ALLOWED: Record<string, string> = {};

interface AuditRow {
  app: string;
  verb: string;
  route: string;
  file: string;
  line: number;
  isPublic: boolean;
  inertScope: boolean;
  authz: string | null;
}

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const runAudit = (...apps: string[]): AuditRow[] => {
  const stdout = execFileSync('node', [AUDIT, '--json', ...apps], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(stdout) as AuditRow[];
};

describe('라우트 인가 감사', () => {
  it('membership·ugc 에 키 검증 없는 @Public 쓰기 라우트가 없다', () => {
    const offenders = runAudit('membership', 'ugc-service')
      .filter((r) => r.isPublic && WRITE.has(r.verb))
      .filter((r) => !(`${r.verb} ${r.route}` in ALLOWED))
      .map((r) => `${r.verb} ${r.route} (${r.file}:${r.line})`);

    expect(offenders).toEqual([]);
  });

  // `@RequireScopes` 는 메타데이터일 뿐이라 `ScopeGuard` 가 안 붙으면 아무것도 막지 못한다.
  // 감사 도구의 [A] 항목과 같은 검사 — 전 앱 기준으로 0 이어야 한다.
  it('스코프 메타데이터가 무력화된 라우트가 없다', () => {
    const inert = runAudit()
      .filter((r) => r.inertScope)
      .map((r) => `${r.app} ${r.verb} ${r.route} (${r.file}:${r.line})`);

    expect(inert).toEqual([]);
  });
});

/**
 * `libs/` 는 이 감사의 사각지대였다. `scanApp` 이 `apps/${app}/src` 만 훑으므로, 라이브러리에서
 * 여러 앱에 실려 나가는 컨트롤러는 한 번도 검사된 적이 없다. 2026-08 "라우트 전수 감사"가
 * `/events/trace/*` 무인증 노출 3건을 5개 앱에서 놓친 이유가 이것이다 (#705).
 *
 * 근본 원인은 **공용 라이브러리가 인증 정책을 정하고 있는 것** 자체다. 앱마다 전역 가드가 달라
 * (AdminRealmGuard 기본차단 / ScopeGuard 무표시통과 / WalletAuthGuard API키요구) lib 이 고른
 * 표기 하나가 세 갈래를 동시에 만족시킬 수 없다. 그래서 규칙은 "libs 에 컨트롤러를 두지 않는다"다.
 *
 * 예외를 허용해야 한다면 `LIBS_CONTROLLERS_ALLOWED` 에 **이유와 함께** 추가한다. 그 추가 자체가
 * 리뷰 대상이다.
 */
const LIBS_CONTROLLERS_ALLOWED: Record<string, string> = {
  'libs/authorization/src/api/role-scope.controller.ts':
    'RoleScopeApiModule 을 import 하는 앱이 0개라 실제로 서빙되지 않는다. 등록되더라도 클래스 레벨 ' +
    '@UseGuards(JwtAuthGuard, MasterRoleGuard) 가 master 전용으로 막는다.',
};

interface LibsControllerRow {
  file: string;
  controller: string;
  line: number;
  routes: number;
}

const runLibsAudit = (): LibsControllerRow[] => {
  const stdout = execFileSync('node', [AUDIT, '--libs', '--json'], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout) as LibsControllerRow[];
};

describe('라이브러리 컨트롤러', () => {
  it('libs 에 앱 인가 배선 밖의 @Controller 가 없다', () => {
    const offenders = runLibsAudit()
      .filter((c) => !(c.file in LIBS_CONTROLLERS_ALLOWED))
      .map((c) => `${c.controller} (${c.file}:${c.line}, 라우트 ${c.routes}개)`);

    expect(offenders).toEqual([]);
  });
});

/**
 * 감사 도구는 인증 면제를 `@Public()` 이라는 **데코레이터 이름**으로만 찾고 있었다. 같은 일을 하는
 * raw `@SetMetadata('isPublic', true)` 는 보지 못해, 그런 표기를 쓴 라우트를 리포트에서 통째로
 * 잘못 분류했다 — `apps/` 안에 있는데도 놓쳤다는 뜻이라, libs 스캔만 고쳐서는 같은 종류의 사고를
 * 다시 놓친다 (#705).
 *
 * 픽스처로 health 를 쓰는 건 공개인 게 자명하고 오래 안 움직이는 라우트라서다. 검사하는 건 라우트
 * 자체가 아니라 **탐지 규칙**이다. 이 라우트가 옮겨지거나 표기가 바뀌면 테스트가 깨지고, 그때
 * 규칙을 다시 확인하면 된다.
 */
describe('인증 면제 표기 인식', () => {
  it("raw @SetMetadata('isPublic') 도 공개로 집계한다", () => {
    const health = runAudit('wallet').find((r) => r.verb === 'GET' && r.route === '/v1/health');

    expect(health).toBeDefined();
    expect(health?.isPublic).toBe(true);
  });
});

/**
 * `/events/trace/*` 는 라이브러리 컨트롤러 하나가 5개 앱에 실려 나가면서 전부 무인증으로
 * 열려 있었다 (#705). 컨트롤러를 앱 소유로 옮기면서 닫았고, 이 테스트가 그 상태를 못 박는다.
 *
 * 앱마다 통과 조건이 다르다:
 *   channel-adapter · notification — 전역 `AdminRealmGuard` 가 표시 없는 라우트를 직원 전용으로
 *                                   기본 차단한다. 그래서 데코레이터가 **없는 게** 정답이다.
 *   membership · user-service      — 전역 `ScopeGuard` 는 표시가 없으면 통과시킨다. 인가 표시가
 *                                   반드시 있어야 한다.
 *   wallet                         — 전역 `WalletAuthGuard` 는 표시가 없으면 API 키를 요구한다.
 *                                   어드민 브라우저는 쿠키를 보내므로 `@WalletAdminAuth()` 가 필요하다.
 */
const TRACE_APPS = ['channel-adapter', 'notification', 'membership', 'user-service', 'wallet'] as const;
const TRACE_ROUTES_PER_APP = 3;

/** 전역 가드가 기본 차단인 앱 — 인가 데코레이터 없이도 직원 전용이다. */
const DEFAULT_DENY_APPS = new Set<string>(['channel-adapter', 'notification']);

describe('/events/trace/* 인가', () => {
  const traceRows = () => runAudit(...TRACE_APPS).filter((r) => r.route.startsWith('/events/trace'));

  it('5개 앱 모두가 자기 컨트롤러로 라우트를 선언한다', () => {
    const byApp = TRACE_APPS.map((app) => `${app}=${traceRows().filter((r) => r.app === app).length}`);

    expect(byApp).toEqual(TRACE_APPS.map((app) => `${app}=${TRACE_ROUTES_PER_APP}`));
  });

  it('어느 앱에서도 인증 면제가 아니다', () => {
    const publicRoutes = traceRows()
      .filter((r) => r.isPublic)
      .map((r) => `${r.app} ${r.verb} ${r.route} (${r.file}:${r.line})`);

    expect(publicRoutes).toEqual([]);
  });

  it('기본 차단이 아닌 앱에는 인가 표시가 붙어 있다', () => {
    const unmarked = traceRows()
      .filter((r) => !DEFAULT_DENY_APPS.has(r.app) && !r.authz)
      .map((r) => `${r.app} ${r.verb} ${r.route} (${r.file}:${r.line})`);

    expect(unmarked).toEqual([]);
  });
});
