import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findTenantSlotProtectionViolations, tenantSlotSitesIn } from './tenant-slot-protection';

/**
 * 테넌트 도메인 칸을 받는 사이트(admin-web·auth-web)는 `protection` 이 `none` 이어야 한다.
 *
 * 칸의 CloudFront 배포는 SST 사이트 배포의 요청 함수를 빌려 쓰고, 그 함수가 고른 서버·이미지 함수 URL 로 간다.
 * `oac` 류로 바꾸면 SST 가 함수 URL 권한을 «자기 배포 ARN» 하나로 좁혀 테넌트 배포가 403 을 받는다
 * (서버 함수 권한은 손으로 더할 수 있어도 이미지 최적화 함수는 `nodes` 에 없다). 근거: 비공개 멀티테넌트 리서치 25 §2 E.
 */
const file = (path: string, content: string) => ({ path, content });
const site = (name: string, body: string) =>
  `const s = new sst.aws.Nextjs('${name}', {\n  path: '../x',\n${body}\n  environment: { A: 'b' },\n});\n` +
  `attachTenantDomainSlots('${name}', s);`;

describe('findTenantSlotProtectionViolations (픽스처)', () => {
  it('protection 을 주지 않으면(기본값 none) 통과', () => {
    expect(findTenantSlotProtectionViolations([file('a.ts', site('AdminWeb', ''))])).toEqual([]);
  });

  it("protection: 'none' 이면 통과", () => {
    expect(findTenantSlotProtectionViolations([file('a.ts', site('AdminWeb', "  protection: 'none',"))])).toEqual([]);
  });

  it('protection 이 none 이 아니면 위반', () => {
    expect(findTenantSlotProtectionViolations([file('a.ts', site('AuthWeb', "  protection: 'oac',"))])).toEqual([
      expect.objectContaining({ site: 'AuthWeb', rule: 'protection-not-none' }),
    ]);
    expect(
      findTenantSlotProtectionViolations([
        file('a.ts', site('AuthWeb', "  protection: { mode: 'oac-with-edge-signing' },")),
      ]),
    ).toEqual([expect.objectContaining({ site: 'AuthWeb', rule: 'protection-not-none' })]);
  });

  it('주석 속 글자는 선언이 아니다', () => {
    expect(
      findTenantSlotProtectionViolations([file('a.ts', site('AdminWeb', "  // protection: 'oac' 로 바꾸지 말 것"))]),
    ).toEqual([]);
  });

  it('URL 의 // 는 주석으로 보지 않는다 — 그 뒤의 protection 도 본다', () => {
    expect(
      findTenantSlotProtectionViolations([
        file('a.ts', site('AdminWeb', "  server: { url: 'https://x' }, protection: 'oac',")),
      ]),
    ).toEqual([expect.objectContaining({ site: 'AdminWeb', rule: 'protection-not-none' })]);
  });

  it('칸을 받는 사이트의 Nextjs 선언을 못 찾으면 위반 — 판정을 못 한 것을 통과로 치지 않는다', () => {
    expect(
      findTenantSlotProtectionViolations([file('a.ts', "attachTenantDomainSlots('AdminWeb', adminWeb);")]),
    ).toEqual([expect.objectContaining({ site: 'AdminWeb', rule: 'site-declaration-not-found' })]);
  });

  it('칸을 받지 않는 사이트는 보지 않는다', () => {
    expect(
      findTenantSlotProtectionViolations([
        file('a.ts', "new sst.aws.Nextjs('Storefront', {\n  protection: 'oac',\n});"),
      ]),
    ).toEqual([]);
  });
});

describe('실제 인프라', () => {
  const REPO = join(__dirname, '..', '..');
  const INFRA = ['deployments/lcnine/services/infra/services.ts', 'deployments/lcnine/auth/infra/services.ts'];
  const files = INFRA.map((p) => file(p, readFileSync(join(REPO, p), 'utf8')));

  it('admin-web·auth-web 이 칸을 받는다 — 게이트가 볼 대상이 조용히 사라지지 않게', () => {
    expect(files.flatMap((f) => tenantSlotSitesIn(f.content)).sort()).toEqual(['AdminWeb', 'AuthWeb']);
  });

  it('칸을 받는 사이트의 protection 은 none 이다', () => {
    expect(findTenantSlotProtectionViolations(files)).toEqual([]);
  });
});
