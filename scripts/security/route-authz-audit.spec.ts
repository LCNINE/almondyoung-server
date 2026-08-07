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
