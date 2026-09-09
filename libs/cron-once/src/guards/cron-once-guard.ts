/**
 * `cron-once-guard.spec.ts` 가 쓰는 순수 판정. 파일 목록을 받아 위반을 돌려준다 — 파일 시스템·git
 * 은 스펙 쪽에 있다. 픽스처로 규칙을 고정하고, 저장소 전수는 같은 함수를 한 번 더 부른다.
 */
export const OVERLAP_SAFE_MARKER = '// cron-overlap-safe:';

export interface SourceFile {
  path: string;
  content: string;
}

export type GuardRule = 'raw-cron-without-marker' | 'duplicate-name' | 'module-missing';

export interface GuardViolation {
  path: string;
  line: number;
  rule: GuardRule;
  detail: string;
}

const RAW_CRON = /^\s*@Cron\(/;
const CRON_ONCE_START = /@CronOnce\(/;
const NAME_IN_OPTIONS = /name:\s*'([^']+)'/;

const appOf = (path: string): string | undefined => /^(apps\/[^/]+)\/src\//.exec(path)?.[1];
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
          violations.push({ path, line: i + 1, rule: 'raw-cron-without-marker', detail: `@Cron without '${OVERLAP_SAFE_MARKER}' on the previous line — use @CronOnce (ADR-0036)` });
        }
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
          violations.push({ path, line: i + 1, rule: 'duplicate-name', detail: `@CronOnce name '${name}' already used in ${first}` });
        } else {
          seen.set(name, path);
        }
      }
    });
  }

  for (const app of appsUsingCronOnce) {
    if (!appsImportingModule.has(app)) {
      violations.push({ path: app, line: 0, rule: 'module-missing', detail: `${app} uses @CronOnce but never imports CronOnceModule — its crons would silently never run` });
    }
  }
  return violations;
}
