import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PlatformController } from './platform.controller';

/**
 * 플랫폼 운영자가 다른 테넌트의 «계정»에 닿는 일은 둘뿐이다(ADR-0056): 그 테넌트의 첫 master 만들기, 그 master 의 비밀번호 비상
 * 초기화. 그 밖의 직원·부여는 그 테넌트의 master 가 자기 토큰으로 관리하고, 요청에 테넌트를 실어 «그 테넌트로 일하는» 길은 없다.
 *
 * 운영자 API 의 라우트를 하나 늘리면 아래 표에 «무엇에 닿는가»를 적어야 초록이다 — 계정에 닿는 교차 테넌트 라우트를 셋째로 늘리려면
 * 이 스펙과 ADR 을 함께 바꾼다.
 */
type Reach =
  /** 테넌트 행·도메인·OAuth 클라이언트 주소 — 플랫폼 일, 계정에 닿지 않는다 */
  | 'tenant'
  /** 다른 테넌트의 계정에 닿는다 — 두 일과 그 둘이 다시 돌 때 보는 목록뿐 */
  | 'cross-tenant-account'
  /** 운영자 성질 — 운영자 테넌트의 계정에만 준다 */
  | 'operator';

const PLATFORM_ROUTES: Record<string, Reach> = {
  'GET tenants': 'tenant',
  'GET tenants/:tenantId': 'tenant',
  'POST tenants': 'tenant',
  'PUT tenants/:tenantId/status': 'tenant',
  'DELETE tenants/:tenantId': 'tenant',
  'POST tenants/:tenantId/domains': 'tenant',
  'POST tenants/:tenantId/oauth-clients/:clientId/uris': 'tenant',
  'GET tenants/:tenantId/masters': 'cross-tenant-account',
  'POST tenants/:tenantId/first-master': 'cross-tenant-account',
  'POST tenants/:tenantId/masters/:userId/password': 'cross-tenant-account',
  'PUT operators/:userId': 'operator',
};

function routesOf(controller: { prototype: object }): string[] {
  const proto = controller.prototype;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .flatMap((name) => {
      const handler: unknown = Reflect.get(proto, name);
      if (typeof handler !== 'function') return [];
      const path: unknown = Reflect.getMetadata(PATH_METADATA, handler);
      const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
      if (typeof path !== 'string' || typeof method !== 'number') return [];
      return [`${RequestMethod[method]} ${path}`];
    });
}

const REPO = join(__dirname, '..', '..', '..', '..', '..', '..');

function sourceFiles(): { path: string; content: string }[] {
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'apps/user-service/src'],
    { cwd: REPO, encoding: 'utf8' },
  )
    .split('\n')
    .filter((p) => p.endsWith('.ts') && !p.endsWith('.spec.ts'))
    .map((path) => ({ path, content: readFileSync(join(REPO, path), 'utf8') }));
}

describe('운영자의 교차 테넌트 길은 둘뿐이다 (ADR-0056)', () => {
  const files = sourceFiles();

  it('운영자 API 의 라우트가 모두 «무엇에 닿는가» 표에 있고, 표에 없는 라우트가 없다', () => {
    expect(routesOf(PlatformController).sort()).toEqual(Object.keys(PLATFORM_ROUTES).sort());
  });

  it('다른 테넌트의 계정에 닿는 라우트는 첫 master 만들기·master 비번 비상 초기화(와 그 둘의 재실행 판정 목록)뿐이다', () => {
    const crossTenant = Object.entries(PLATFORM_ROUTES)
      .filter(([, reach]) => reach === 'cross-tenant-account')
      .map(([route]) => route);
    expect(crossTenant).toEqual([
      'GET tenants/:tenantId/masters',
      'POST tenants/:tenantId/first-master',
      'POST tenants/:tenantId/masters/:userId/password',
    ]);
  });

  it('소스를 찾았다 — 못 찾으면 아래 대조가 아무것도 안 잰다', () => {
    expect(files.filter((f) => /@Controller\(/.test(f.content)).length).toBeGreaterThan(30);
  });

  it('경로의 테넌트(`:tenantId`)를 받는 컨트롤러는 운영자 API 뿐이다', () => {
    const takers = files.filter((f) => /@(Param|Query|Body)\(\s*'tenantId'/.test(f.content)).map((f) => f.path);
    expect(takers).toEqual(['apps/user-service/src/api/iam/platform/platform.controller.ts']);
  });

  it('요청 본문·쿼리로 테넌트를 받는 DTO 는 OAuth 클라이언트의 고정 테넌트(플랫폼 설정) 하나다 — «요청 테넌트로 일하기» 없음', () => {
    // 검증 데코레이터가 붙은 `tenantId` 칸 = 요청이 실을 수 있는 칸(응답 DTO 는 검증 데코레이터가 없다).
    const takesTenant = (content: string) =>
      /@(Is\w+|Matches)\([^)]*\)\s*(?:@\w+\([^)]*\)\s*)*tenantId[?!]?\s*:/.test(content);
    const takers = files.filter((f) => f.path.includes('/dto/') && takesTenant(f.content)).map((f) => f.path);
    expect(takers).toEqual(['apps/user-service/src/api/admin/oauth-clients/dto/oauth-clients.dto.ts']);
  });
});
