import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTenantGateMode } from '../tenancy-settings';
import { parseTenantList } from '../tenant-list';

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
