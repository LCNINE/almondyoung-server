import { PERMISSION_CATALOG } from '@permission-catalog';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { canAccess, resolveScreenAccess } from './screen-access';

/**
 * 모든 화면은 경로 권한표로 판정된다(ADR-0048). 페이지가 자기 경로를 `RouteGuard screen` 으로
 * 선언하고, 그 경로가 표에 있어야 한다. 역할 이름(`requireRole`)은 남지 않는다.
 */
const APP = join(__dirname, '..', '..', 'app');

function pages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) pages(p, out);
    else if (name === 'page.tsx') out.push(p);
  }
  return out;
}

const routeOf = (file: string) =>
  '/' +
  relative(APP, join(file, '..'))
    .split(sep)
    .filter((seg) => seg && !/^\(.*\)$/.test(seg))
    .join('/');

/** 하위 페이지가 클라이언트 컴포넌트라 레이아웃이 가드하는 경로. */
const LAYOUT_GUARDED: Record<string, string> = {
  '/mobile': 'mobile/layout.tsx',
  '/customer-window/[id]': 'customer-window/[id]/layout.tsx',
  '/attendance': 'attendance/layout.tsx',
  '/company/attendance': '(admin)/company/attendance/layout.tsx',
};
/** redirect() 만 하는 페이지 — 도착 화면이 판정한다. */
const REDIRECT_ONLY = new Set(['/mall/marketing/campaigns', '/statistics']);

const all = pages(APP).map((file) => ({ file, route: routeOf(file), source: readFileSync(file, 'utf8') }));
/** `<RouteGuard` 와 `screen=` 사이 줄바꿈·공백을 허용한다(prettier 가 속성을 다음 줄로 내린다). */
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const declares = (source: string, route: string) => new RegExp(`<RouteGuard\\s+screen="${escape(route)}"`).test(source);
const guardedBy = (route: string) => Object.keys(LAYOUT_GUARDED).find((prefix) => route === prefix || route.startsWith(prefix + '/'));

describe('화면 권한 게이트', () => {
  it('검사가 실제로 페이지를 찾는다 — 빈 결과는 검사가 깨졌다는 뜻이다', () => {
    expect(all.length).toBeGreaterThan(100);
  });

  it('모든 화면 경로가 권한표로 판정된다', () => {
    expect(all.filter((p) => resolveScreenAccess(p.route) === undefined).map((p) => p.route)).toEqual([]);
  });

  it('권한이 필요한 화면은 자기 경로로 RouteGuard 를 단다', () => {
    const offenders = all
      .filter((p) => resolveScreenAccess(p.route)?.kind === 'permission')
      .filter((p) => !guardedBy(p.route) && !REDIRECT_ONLY.has(p.route))
      .filter((p) => !declares(p.source, p.route))
      .map((p) => p.route);
    expect(offenders).toEqual([]);
  });

  it('레이아웃 가드는 그 경로를 선언한다', () => {
    for (const [route, layout] of Object.entries(LAYOUT_GUARDED)) {
      expect(declares(readFileSync(join(APP, layout), 'utf8'), route)).toBe(true);
    }
  });

  it('역할 이름으로 화면을 막지 않는다', () => {
    expect(all.filter((p) => p.source.includes('requireRole')).map((p) => p.route)).toEqual([]);
  });
});

// 오늘 admin 의 권한 = 카탈로그의 첫 등록 부여(로컬·라이브 첫 배포의 DB 와 같다). master = 시스템 전용 뺀 전체.
const ADMIN = new Set(PERMISSION_CATALOG.filter((p) => p.grantOnFirstRegistration.some((r) => r === 'admin')).map((p) => p.key));
const MASTER = new Set(PERMISSION_CATALOG.filter((p) => !p.systemOnly).map((p) => p.key));
/** 오늘 master 만 들어가던 화면(옛 `requireRole={['master']}`). */
const MASTER_ONLY_TODAY = new Set([
  '/users',
  '/users/[id]',
  '/users/roles',
  '/users/roles/[id]',
  '/company/integrations/oauth-clients',
  // 새 화면이지만 같은 성격 — 개인정보 접속기록 조회 권한은 첫 부여가 없다(master 만).
  '/users/pii-access-log',
  '/company/attendance/review',
  '/company/attendance/worksites',
  '/attendance/review',
  // 아래 셋은 옛날에 admin 도 들어와 화면 안의 «마스터만» 문구를 보던 곳이다 — 이제 들어오기 전에 막는다(승인된 변화).
  '/company/attendance/statistics',
  '/attendance/statistics',
  '/attendance/worksites',
  // 새 화면 — 급여 권한은 첫 부여가 없다(master 만).
  '/company/attendance/wage',
  '/company/attendance/wage/decisions',
  '/company/attendance/wage/workers',
  '/company/attendance/wage/workers/[userId]',
  '/company/attendance/wage/settings',
]);

describe('admin·master 화면 결과 불변(승인된 변화 제외)', () => {
  const allowed = (route: string, held: ReadonlySet<string>) => {
    const access = resolveScreenAccess(route);
    return access !== undefined && canAccess(access, held);
  };

  it('master 는 모든 화면에 들어간다', () => {
    expect(all.filter((p) => !allowed(p.route, MASTER)).map((p) => p.route)).toEqual([]);
  });

  it('admin 은 master 전용이던 화면 말고 전부 들어간다', () => {
    const changed = all.filter((p) => allowed(p.route, ADMIN) === MASTER_ONLY_TODAY.has(p.route)).map((p) => p.route);
    expect(changed).toEqual([]);
  });
});
