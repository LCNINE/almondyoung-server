import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * user-service 컨트롤러는 둘 중 하나다.
 * - T 데이터(고객·근태·상점…): `@ServedTenantData()` 를 단다 — 토큰 테넌트가 T 가 아니면 403.
 * - 모든 테넌트의 일(계정·로그인·토큰·권한·운영자): 아래 목록에 이유와 함께 적는다.
 * 새 컨트롤러가 어느 쪽도 아니면 빨갛다 — 표시를 잊은 고객 라우트가 테넌트 2 토큰에 답하는 것을 막는다.
 */
const ALL_TENANT_CONTROLLERS: Record<string, string> = {
  'apps/user-service/src/health.controller.ts': '헬스체크',
  'apps/user-service/src/api/events/event-trace.controller.ts': '이벤트 추적(운영)',
  'apps/user-service/src/api/auth/auth.controller.ts': '로그인·세션·비밀번호 — 계정은 전역',
  'apps/user-service/src/api/oauth/oauth.controller.ts': '토큰 발급 — 토큰 테넌트를 정하는 곳',
  'apps/user-service/src/api/well-known/well-known.controller.ts': 'OIDC 메타데이터·JWKS',
  // 섞여 있다: 직원 계정 만들기는 계정(전역), 비밀번호 변경은 고객 계정까지 닿아 라우트에 표시를 단다.
  'apps/user-service/src/api/admin/auth/auth.controller.ts': '직원 계정 만들기 + 라우트 단위 표시',
  'apps/user-service/src/api/admin/oauth-clients/oauth-clients.controller.ts': 'OAuth 클라이언트 — 플랫폼 설정',
  'apps/user-service/src/api/iam/assignments/role-assignment.controller.ts': '역할 부여 — 요청자 테넌트 안에서',
  'apps/user-service/src/api/iam/audit/iam-audit.controller.ts': '권한 변경 이력',
  'apps/user-service/src/api/iam/iam-internal.controller.ts': '역할→권한 사본(서비스 간)',
  'apps/user-service/src/api/iam/me-permissions.controller.ts': '내 권한 — 모든 셸이 부른다',
  'apps/user-service/src/api/iam/pii-access/pii-access-log.controller.ts': '개인정보 접속기록 조회',
  'apps/user-service/src/api/iam/pii-access/pii-access-record.controller.ts': '개인정보 접속기록 적재(서비스 간)',
  'apps/user-service/src/api/iam/pii-access/pii-access.consumer.ts': 'Kafka 소비자(HTTP 아님)',
  'apps/user-service/src/api/iam/roles/role-admin.controller.ts': '역할 정의 — 전역',
  'apps/user-service/src/api/iam/platform/platform.controller.ts': '플랫폼 운영자의 테넌트 관리 — 테넌트 밖의 일',
  'apps/user-service/src/api/iam/platform/tenant-brand.controller.ts': '주소 → 테넌트 브랜드(로그인 전, 토큰 없음)',
  // 섞여 있다: `/users/me`·`/users/roles` 는 계정(관리자 헤더가 부른다), 고객 조회 라우트는 라우트에 표시를 단다.
  'apps/user-service/src/api/users/users.controller.ts': '계정 라우트 + 라우트 단위 표시',
};

const REPO = join(__dirname, '..', '..', '..', '..');

function controllerFiles(): { path: string; content: string }[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'apps/user-service/src'], { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .filter((p) => p.endsWith('.ts') && !p.endsWith('.spec.ts'))
    .map((path) => ({ path, content: readFileSync(join(REPO, path), 'utf8') }))
    .filter((f) => /@Controller\(/.test(f.content));
}

describe('user-service 컨트롤러의 테넌트 분류', () => {
  const files = controllerFiles();

  it('컨트롤러를 찾았다 — 못 찾으면 아래 대조가 아무것도 안 잰다', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('모든 컨트롤러가 «T 데이터» 표시를 달았거나 «모든 테넌트» 목록에 있다', () => {
    const unclassified = files
      .filter((f) => !/@ServedTenantData\(\)/.test(f.content) && !(f.path in ALL_TENANT_CONTROLLERS))
      .map((f) => f.path);
    expect(unclassified).toEqual([]);
  });

  it('«모든 테넌트» 목록의 파일은 실제로 있다 — 지운 컨트롤러가 목록에 남지 않게', () => {
    const paths = new Set(files.map((f) => f.path));
    expect(Object.keys(ALL_TENANT_CONTROLLERS).filter((p) => !paths.has(p))).toEqual([]);
  });

  it('고객·근태 컨트롤러는 T 데이터다', () => {
    const marked = (path: string) => /@ServedTenantData\(\)/.test(files.find((f) => f.path === path)?.content ?? '');
    expect(marked('apps/user-service/src/api/attendance/controllers/attendance.controller.ts')).toBe(true);
    expect(marked('apps/user-service/src/api/admin/users/users.controller.ts')).toBe(true);
    expect(marked('apps/user-service/src/api/users/users.controller.ts')).toBe(true); // find-by-email
    expect(marked('apps/user-service/src/api/admin/auth/auth.controller.ts')).toBe(true); // 고객 비밀번호 변경
  });
});
