/**
 * `cron-once-guard.spec.ts` 가 쓰는 순수 판정. 파일 목록을 받아 위반을 돌려준다 — 파일 시스템·git
 * 은 스펙 쪽에 있다. 픽스처로 규칙을 고정하고, 저장소 전수는 같은 함수를 한 번 더 부른다.
 */
export const OVERLAP_SAFE_MARKER = '// cron-overlap-safe:';

export interface SourceFile {
  path: string;
  content: string;
}

export type GuardRule = 'raw-cron-without-marker' | 'duplicate-name' | 'module-missing' | 'cron-outside-tenant-loop';

export interface GuardViolation {
  path: string;
  line: number;
  rule: GuardRule;
  detail: string;
}

const RAW_CRON = /^\s*@Cron\(/;
const CRON_ONCE_START = /@CronOnce\(/;
const NAME_IN_OPTIONS = /name:\s*'([^']+)'/;
/** 러너를 거치지 않고 직접 도는 스케줄 — 테넌트 루프를 스스로 열어야 한다. */
const SELF_SCHEDULED = /^\s*@(Cron|Interval|Timeout)\(/;
const TENANT_LOOP = /\bforEachDatabase\(/;

/**
 * 테넌트마다 DB 가 따로인 core 와, core 가 싣는 공용 lib. 다른 앱은 DB 가 하나라 `forEachDatabase` 가 한 번 도는 것과 같다.
 * core 의 DB 는 테넌트 맥락으로만 고를 수 있어, 요청 밖에서 도는 메서드가 루프를 안 열면 ② 에서 매 주기 «맥락 없음»으로 실패한다.
 */
const inTenantRoutedTree = (path: string): boolean => path.startsWith('apps/core/src/') || path.startsWith('libs/');

/**
 * 데코레이터 아래 메서드의 본문(여는 `{` 부터 짝이 맞는 `}` 까지). 문자열 안의 괄호는 가리지 않는 줄 단위 근사다 —
 * 틀려도 본문이 길어지거나 짧아질 뿐이고, 짧아지면 위반으로 나와 사람이 본다.
 */
function methodBodyAfter(lines: string[], decoratorIndex: number): string {
  let depth = 0;
  let opened = false;
  const body: string[] = [];
  for (let i = decoratorIndex + 1; i < lines.length; i++) {
    const text = lines[i];
    if (!opened && /^\s*@/.test(text)) continue; // 다른 데코레이터
    for (const ch of text) {
      if (ch === '{') {
        depth++;
        opened = true;
      } else if (ch === '}') depth--;
    }
    if (opened) body.push(text);
    if (opened && depth <= 0) break;
  }
  return body.join('\n');
}

const appOf = (path: string): string | undefined => /^((apps|libs)\/[^/]+)\/src\//.exec(path)?.[1];
const isSpec = (path: string) => path.endsWith('.spec.ts');

export function findGuardViolations(files: SourceFile[]): GuardViolation[] {
  const violations: GuardViolation[] = [];
  const namesByApp = new Map<string, Map<string, string>>(); // app → name → first path
  const appsUsingCronOnce = new Set<string>();
  const appsImportingModule = new Set<string>();

  for (const { path, content } of files) {
    const app = appOf(path);
    if (!app || isSpec(path)) continue;
    const lines = content.split('\n');

    if (/\bCronOnceModule\b/.test(content)) appsImportingModule.add(app);

    lines.forEach((text, i) => {
      if (RAW_CRON.test(text)) {
        const prev = lines[i - 1]?.trim() ?? '';
        if (!prev.startsWith(OVERLAP_SAFE_MARKER)) {
          violations.push({
            path,
            line: i + 1,
            rule: 'raw-cron-without-marker',
            detail: `@Cron without '${OVERLAP_SAFE_MARKER}' on the previous line — use @CronOnce (ADR-0036)`,
          });
        }
      }
      if (inTenantRoutedTree(path) && SELF_SCHEDULED.test(text) && !TENANT_LOOP.test(methodBodyAfter(lines, i))) {
        violations.push({
          path,
          line: i + 1,
          rule: 'cron-outside-tenant-loop',
          detail:
            'scheduled method must reach the DB through DbService.forEachDatabase(...) in its own body — ' +
            'core picks a tenant DB only inside that loop (multi-tenant 13). Prefer @CronOnce, which loops for you.',
        });
      }
      if (CRON_ONCE_START.test(text)) {
        appsUsingCronOnce.add(app);
        // 옵션 객체가 여러 줄일 수 있어 데코레이터 시작부터 다섯 줄 안에서 name 을 찾는다.
        const window = lines.slice(i, i + 5).join('\n');
        const name = NAME_IN_OPTIONS.exec(window)?.[1];
        if (!name) return;
        const seen = namesByApp.get(app) ?? new Map<string, string>();
        namesByApp.set(app, seen);
        const first = seen.get(name);
        if (first) {
          violations.push({
            path,
            line: i + 1,
            rule: 'duplicate-name',
            detail: `@CronOnce name '${name}' already used in ${first}`,
          });
        } else {
          seen.set(name, path);
        }
      }
    });
  }

  for (const app of appsUsingCronOnce) {
    if (!appsImportingModule.has(app)) {
      violations.push({
        path: app,
        line: 0,
        rule: 'module-missing',
        detail: `${app} uses @CronOnce but never imports CronOnceModule — its crons would silently never run`,
      });
    }
  }
  return violations;
}
