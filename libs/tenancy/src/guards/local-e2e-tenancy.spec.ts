import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTenantGateMode } from '../tenancy-settings';
import { parseTenantList } from '../tenant-list';
// 가드 스펙이라 scripts 를 import 한다(라이브러리 코드는 scripts 에 기대지 않는다) — 만들기 스크립트가 쓰는 글자와 정본을 대조한다.
import { addTenantToEnv } from '../../../../scripts/tenancy/create-tenant/tenant-list-env';

/**
 * 로컬 E2E 의 테넌트 설정 정본(`scripts/local/e2e-env-map.sh`)이 «앱이 실제로 받아 주는 값»인지,
 * 그리고 kind=nest 앱의 템플릿이 같은 값을 들고 있는지 본다. 정본이 틀리면 bootstrap 이 그 값을
 * 모든 .env 에 넣고 start-all 에서 11개 앱이 한꺼번에 기동을 거부한다.
 */
const REPO = join(__dirname, '..', '..', '..', '..');
const map = readFileSync(join(REPO, 'scripts/local/e2e-env-map.sh'), 'utf8');

function shellValue(name: string): string {
  const m = new RegExp(`^${name}='([^']*)'$`, 'm').exec(map);
  if (!m) throw new Error(`e2e-env-map.sh 에 ${name}='…' 가 없다`);
  return m[1];
}

const nestRows = [...map.matchAll(/^\s+"([^"|]+)\|([^|]+)\|([^|]+)\|[^|]+\|[^|]+\|nest\|/gm)].map((m) => ({
  name: m[1],
  template: m[3],
}));

describe('로컬 E2E 테넌트 설정', () => {
  const list = shellValue('E2E_TENANT_LIST');
  const mode = shellValue('E2E_TENANT_GATE_MODE');

  it('정본 목록·모드가 파서를 통과한다', () => {
    expect(parseTenantList(list).entries.length).toBeGreaterThanOrEqual(1);
    expect(parseTenantGateMode(mode)).toBe(mode);
  });

  it('앱 설정 T 는 목록에 있고, T 를 받는 앱의 템플릿이 같은 값을 든다', () => {
    const served = shellValue('E2E_SERVED_TENANT_ID');
    expect(parseTenantList(list).find(served)).toBeDefined();

    const apps = shellValue('E2E_SERVED_TENANT_APPS').split(' ');
    // 직접 발행·outbox 의 봉투 테넌트가 T 인 발행 앱과, T 의 데이터를 답하는 user-service.
    expect(apps).toEqual(
      expect.arrayContaining(['user-service', 'channel-adapter', 'membership', 'ugc-service', 'wallet']),
    );
    const missing = nestRows
      .filter((r) => apps.includes(r.name) && r.template !== '-')
      .filter(
        (r) => !readFileSync(join(REPO, 'env-templates', r.template), 'utf8').includes(`SERVED_TENANT_ID=${served}`),
      )
      .map((r) => r.template);
    expect(missing).toEqual([]);
  });

  it('core 는 T 를 받지 않는다 — «메시지마다» 앱이고 outbox 테넌트는 접속 DB 로 정한다', () => {
    expect(shellValue('E2E_SERVED_TENANT_APPS').split(' ')).not.toContain('core');
  });

  it('«테넌트 2 를 넣은 뒤» 정본 = 만들기 스크립트가 넣기 전 정본에 테넌트 2 칸들로 써내는 글자 그대로', () => {
    // preflight·bootstrap 은 이 값을 글자로 비교한다 — 스크립트의 직렬화와 한 글자라도 다르면 만든 뒤 «정본과 다르다»가 뜬다.
    const entry = {
      id: shellValue('E2E_TENANT2_ID'),
      slug: shellValue('E2E_TENANT2_SLUG'),
      coreDb: shellValue('E2E_TENANT2_CORE_DB'),
      publicBucket: shellValue('E2E_TENANT2_PUBLIC_BUCKET'),
      privateBucket: shellValue('E2E_TENANT2_PRIVATE_BUCKET'),
    };
    const written = addTenantToEnv(`TENANT_LIST='${list}'\n`, entry);

    expect(written).toBe(`TENANT_LIST='${shellValue('E2E_TENANT_LIST_WITH_TENANT2')}'\n`);
    expect(parseTenantList(shellValue('E2E_TENANT_LIST_WITH_TENANT2')).find(entry.id)).toEqual(entry);
    expect(entry.coreDb).toBe(`core_${entry.slug}`);
  });

  it('kind=nest 행을 찾았다 — 못 찾으면 아래 대조가 아무것도 안 잰다', () => {
    expect(nestRows.length).toBeGreaterThanOrEqual(11);
  });

  it('템플릿이 있는 kind=nest 앱은 템플릿에 같은 값을 든다', () => {
    const mismatched = nestRows
      .filter((r) => r.template !== '-')
      .filter((r) => {
        const body = readFileSync(join(REPO, 'env-templates', r.template), 'utf8');
        return !body.includes(`TENANT_LIST='${list}'`) || !body.includes(`TENANT_GATE_MODE=${mode}`);
      })
      .map((r) => r.template);
    expect(mismatched).toEqual([]);
  });
});
