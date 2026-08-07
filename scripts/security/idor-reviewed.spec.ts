import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const AUDIT = join(__dirname, 'route-authz-audit.js');

interface AuditRow {
  app: string;
  verb: string;
  route: string;
  file: string;
  line: number;
  idorTarget: boolean;
}

const runAudit = (): AuditRow[] =>
  JSON.parse(execFileSync('node', [AUDIT, '--json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })) as AuditRow[];

/** 판정 명단의 키. `<app> <VERB> <route>` — app 이 빠지면 안 된다 (아래 테스트가 이유를 설명한다). */
const keyOf = (r: AuditRow): string => `${r.app} ${r.verb} ${r.route}`;

describe('IDOR 검사 대상 집합', () => {
  it('감사 스크립트가 idorTarget 을 내보낸다', () => {
    const targets = runAudit().filter((r) => r.idorTarget);
    expect(targets).toHaveLength(95);
  });

  // search 와 analytics 가 둘 다 `GET /health` 다. `<VERB> <route>` 로 키를 만들면
  // 95건이 94개로 뭉개지고 스냅샷이 한 건을 조용히 잃는다.
  it('키에 app 이 들어가야 충돌하지 않는다', () => {
    const targets = runAudit().filter((r) => r.idorTarget);
    expect(new Set(targets.map(keyOf)).size).toBe(95);
    expect(new Set(targets.map((r) => `${r.verb} ${r.route}`)).size).toBe(94);
  });
});
