// 사람 축 (user_service) — 작업자 역할·권한·앱 로그인.
import type { Sql } from '../db';
import type { Report } from '../report';
import { catalogGrantsFor, missingGrants } from '../rules';

export async function checkPeople(tx: Sql, r: Report): Promise<void> {
  r.section('사람 1. 역할 보유자');
  const holders = await tx<{ role: string; holders: number }[]>`
    select r.name as role, count(distinct ur.user_id)::int as holders
    from roles r left join user_roles ur on ur.role_id = r.role_id
      and (ur.expires_at is null or ur.expires_at > now())
    where r.name in ('master','admin','logistics_worker','logistics_manager')
    group by 1 order by 1`;
  r.table(holders);
  const count = (name: string): number => Number(holders.find((h) => h.role === name)?.holders ?? 0);
  const hasRole = (name: string): boolean => holders.some((h) => h.role === name);

  // 역할 «행» 자체가 없으면 부여할 수도 없다. 두 역할은 참조 시드(user-service.seed-step.ts)에만 있다.
  // 🔴 그 시드를 라이브에 그냥 돌리면 안 된다 — 고정 id 관리자 행이 없으면 `admin` 계정을 기본 비밀번호
  // (03-seed-orchestrator.ts 의 공개된 fallback)로 만들고 master 를 붙인다. 그래서 그 행이 있는지 같이 본다.
  const missingRoles = ['logistics_worker', 'logistics_manager'].filter((name) => !hasRole(name));
  if (missingRoles.length) {
    const [seedAdmin] = await tx<{ n: number }[]>`
      select count(*)::int as n from users where id = '019d0004-2001-7000-a000-000000000001'`;
    // logistics_manager 는 11-19 결정으로 첫날 전에 만든다(런북 #1251 §11-2 — 배송 프로필·정체 주문·매칭·수취인 수정을 맡는다).
    // 관리자 화면으로 만들면 안 된다 — 사람이 만든 역할은 이름이 같아도 카탈로그 부여를 받지 않는다(permission-catalog-sync).
    r.bad(
      `역할 행이 없다: ${missingRoles.join(', ')} — 계정에 부여할 수조차 없다`,
      seedAdmin.n
        ? '참조 시드 db:seed:ref --deployment lcnine-auth (고정 관리자 행이 이미 있어 새 계정은 안 생긴다 — 그래도 --yes 없이 계획부터 볼 것). ' +
            '관리자 화면으로 만들지 않는다 — 카탈로그 부여를 못 받는다. 다음 user-service 부팅에 권한이 들어간다(#1248)'
        : '🔴 db:seed:ref 를 그냥 돌리지 말 것 — 고정 관리자 행이 없어 기본 비밀번호 master 계정이 생긴다. ' +
            'ADMIN_INITIAL_PASSWORD 를 강한 값으로 주거나 roles 행만 손으로 넣는다',
    );
  }

  if (count('logistics_worker')) r.ok(`logistics_worker 보유자 ${count('logistics_worker')}명`);
  else
    r.bad(
      'logistics_worker 보유자 0명 — 현장 작업자 계정이 없다',
      '작업자 계정에 logistics_worker 역할 부여 (#1233 축 6)',
    );
  if (count('logistics_manager') || count('master') || count('admin'))
    r.ok('강제출고·handoff·조정을 할 역할(admin/master/logistics_manager) 보유자 있음');
  else
    r.bad(
      'admin·master·logistics_manager 보유자 0명 — 강제출고·결품 처리를 할 사람이 없다',
      '관리자 계정에 admin 부여',
    );

  r.section('사람 2. 물류 역할 권한 — 카탈로그가 주게 적은 것이 라이브에 있나');
  // libs/authorization/src/permissions/permission-catalog.ts 의 grantOnFirstRegistration 이 기대값이다.
  // 부여는 (권한, 역할)마다 한 번뿐이다 — 역할 행이 늦게 생기면 그 뒤 부팅에 받는다(#1248).
  for (const role of ['logistics_worker', 'logistics_manager'] as const) {
    if (!hasRole(role)) continue;
    const expected = catalogGrantsFor(role);
    const granted = await tx<{ permission_key: string }[]>`
      select p.permission_key from iam_role_permissions p join roles r on r.role_id = p.role_id
      where r.name = ${role}`;
    const missing = missingGrants(
      expected,
      granted.map((g) => g.permission_key),
    );
    if (!missing.length) r.ok(`${role} 에 카탈로그 기대 권한 ${expected.length}개 전부 있음`);
    else
      r.bad(
        `${role} 에 빠진 권한: ${missing.join(', ')}`,
        '역할 행이 방금 생겼으면 user-service 가 한 번 더 부팅한 뒤 다시 본다. 아니면 admin-web /users/roles 에서 부여(#1248)',
      );
  }

  r.section('사람 3. warehouse-app OAuth 클라이언트');
  const clients = await tx<{ client_id: string; is_active: boolean }[]>`
    select client_id, client_type, is_active, redirect_uris from oauth_clients where client_id = 'warehouse-app'`;
  r.table(clients);
  if (clients.some((c) => c.is_active)) r.ok('warehouse-app 클라이언트 활성');
  else
    r.bad(
      'warehouse-app OAuth 클라이언트가 없거나 비활성 → 앱 로그인 불가',
      'user-service admin /admin/oauth-clients 로 등록',
    );
}
