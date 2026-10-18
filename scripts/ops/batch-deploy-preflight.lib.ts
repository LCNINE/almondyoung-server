import { z } from 'zod';

/**
 * 배치 배포 점검의 판정부 — 입력은 이미 읽어 온 사실(마이그 SQL·journal·이슈 본문·ECS 상태)이고 출력은 판정이다.
 * DB·git·gh·aws 를 부르는 껍데기는 `batch-deploy-preflight.ts` 에 있다.
 */

/** ADR-0005 §5 의 destructive 변경 — 옛 코드가 새 schema 를 만나면 깨진다. 그래서 `deploy → migrate` 다 */
const CONTRACT_PATTERNS: ReadonlyArray<readonly [label: string, pattern: RegExp]> = [
  ['DROP TABLE', /\bDROP\s+TABLE\b/i],
  ['DROP COLUMN', /\bDROP\s+COLUMN\b/i],
  ['DROP TYPE', /\bDROP\s+TYPE\b/i],
  ['RENAME', /\bRENAME\s+(TO|COLUMN|CONSTRAINT|VALUE)\b/i],
  ['SET NOT NULL', /\bSET\s+NOT\s+NULL\b/i],
  ['컬럼 타입 변경', /\bALTER\s+COLUMN\s+"?[^"\s]+"?\s+(SET\s+DATA\s+)?TYPE\b/i],
];

/**
 * 새 코드가 새 schema 를 기대한다 — 옛 코드는 무시하므로 `migrate → deploy` 다.
 * 평범한 인덱스와 CHECK·FK 는 넣지 않는다: contract 마이그도 남은 칸에 인덱스를 다시 걸고(#724 PR-C) 좁힌 타입에 CHECK 를 단다.
 * 유니크는 넣는다 — 새 코드의 `ON CONFLICT` 가 기댈 수 있다.
 */
const EXPAND_PATTERNS: ReadonlyArray<readonly [label: string, pattern: RegExp]> = [
  ['CREATE TABLE', /\bCREATE\s+TABLE\b/i],
  ['ADD COLUMN', /\bADD\s+COLUMN\b/i],
  ['유니크 인덱스', /\bCREATE\s+UNIQUE\s+INDEX\b/i],
  ['유니크 제약', /\bADD\s+CONSTRAINT\s+"?[^"\s]+"?\s+UNIQUE\b/i],
  ['enum 값 추가', /\bALTER\s+TYPE\b[^;]*\bADD\s+VALUE\b/i],
  ['CREATE SCHEMA·SEQUENCE·VIEW', /\bCREATE\s+(SCHEMA|SEQUENCE|(OR\s+REPLACE\s+)?VIEW)\b/i],
];

/** 둘 다 아닌 것(SET LOCAL·인덱스·CHECK·FK·DROP NOT NULL·데이터 UPDATE 등)만 있으면 `neutral` — 순서를 강제하지 않는다 */
export const MIGRATION_KINDS = ['expand', 'contract', 'mixed', 'neutral'] as const;
export type MigrationKind = (typeof MIGRATION_KINDS)[number];

export interface MigrationClass {
  kind: MigrationKind;
  contract: string[];
  expand: string[];
}

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, ' ');
}

function matched(sql: string, patterns: ReadonlyArray<readonly [string, RegExp]>): string[] {
  return patterns.filter(([, pattern]) => pattern.test(sql)).map(([label]) => label);
}

export function classifyMigration(sql: string): MigrationClass {
  const body = stripComments(sql);
  const contract = matched(body, CONTRACT_PATTERNS);
  const expand = matched(body, EXPAND_PATTERNS);
  const kind: MigrationKind =
    contract.length && expand.length ? 'mixed' : contract.length ? 'contract' : expand.length ? 'expand' : 'neutral';
  return { kind, contract, expand };
}

/** drizzle.config.ts 를 import 하면 그 파일이 dotenv 로 로컬 .env 를 읽어 들인다 — 본문에서 `out` 한 줄만 읽는다 */
export function migrationsOutDir(drizzleConfigSource: string): string {
  const out = /\bout:\s*['"]([^'"]+)['"]/.exec(drizzleConfigSource)?.[1];
  if (!out) throw new Error('drizzle config 에서 out 을 찾지 못했다');
  return out;
}

const journalSchema = z.object({
  entries: z.array(z.object({ idx: z.number(), when: z.number(), tag: z.string() })),
});

export type JournalEntry = z.infer<typeof journalSchema>['entries'][number];

/** `<out>/meta/_journal.json` 본문 → 항목. 마이그 SQL 파일 이름은 `<out>/<tag>.sql` 이다 */
export function parseJournal(source: string): JournalEntry[] {
  return journalSchema.parse(JSON.parse(source)).entries;
}

/**
 * drizzle migrator 와 같은 규칙: 적용 이력의 가장 늦은 `created_at` 보다 `when` 이 큰 항목만 적용한다.
 * 이력이 없으면(null) 전부 대기다. 이력보다 이른데 빠진 항목은 drizzle 도 영영 적용하지 않으므로 대기로 세지 않는다.
 */
export function pendingEntries(entries: readonly JournalEntry[], lastAppliedAt: number | null): JournalEntry[] {
  return entries.filter((entry) => lastAppliedAt === null || entry.when > lastAppliedAt);
}

export interface PendingMigration extends MigrationClass {
  service: string;
  tag: string;
}

export type DeploymentVerdict =
  | { kind: 'none' }
  | { kind: 'expand' }
  | { kind: 'contract' }
  | { kind: 'mixed'; reason: string };

/**
 * 한 배포(SST 앱 하나)의 대기 마이그를 한 순서로 돌릴 수 있는가. expand 는 `migrate → deploy`, contract 는 `deploy → migrate` 라
 * 둘이 섞이면 어느 순서로도 한쪽이 깨진다 — contract 를 다음 배치로 미뤄야 한다.
 */
export function judgeDeployment(pending: readonly PendingMigration[]): DeploymentVerdict {
  const mixedFiles = pending.filter((m) => m.kind === 'mixed');
  if (mixedFiles.length) {
    return {
      kind: 'mixed',
      reason: `한 파일에 expand 와 contract 가 함께 있다 — ${mixedFiles
        .map((m) => `${m.service}/${m.tag}(+${m.expand.join('·')} −${m.contract.join('·')})`)
        .join(
          ', ',
        )}. 어느 순서로 돌려도 한쪽이 깨질 수 있고, ADD+DROP 이면 drizzle 가 rename 을 그렇게 만든 것이라 데이터가 사라진다`,
    };
  }
  const contract = pending.filter((m) => m.kind === 'contract');
  const expand = pending.filter((m) => m.kind === 'expand');
  if (contract.length && expand.length) {
    return {
      kind: 'mixed',
      reason: `expand(${expand.map((m) => `${m.service}/${m.tag}`).join(', ')}) 와 contract(${contract.map((m) => `${m.service}/${m.tag}`).join(', ')}) 가 한 배치에 있다 — contract 를 다음 배치로 미룬다`,
    };
  }
  if (contract.length) return { kind: 'contract' };
  if (pending.length) return { kind: 'expand' };
  return { kind: 'none' };
}

/**
 * 추적 이슈 «## 남은 운영 작업» 절의 체크 안 된 줄 중 제목(첫 « — » 앞)에 «배포»가 든 것.
 * 제목만 돌려준다 — 줄 전체는 수백 자라 목록으로 읽히지 않는다.
 */
export function uncheckedDeployLines(issueBody: string): string[] {
  const section = /^## 남은 운영 작업\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(issueBody);
  if (!section) return [];
  return section[1]
    .split('\n')
    .filter((line) => line.startsWith('- [ ] '))
    .map((line) => line.slice('- [ ] '.length).split(' — ')[0].trim())
    .filter((title) => title.includes('배포'));
}

export interface EcsServiceSnapshot {
  cluster: string;
  service: string;
  /** 서비스가 지금 돌리는 태스크 정의 ARN */
  running: string;
  /** 그 패밀리의 가장 최근 ACTIVE 리비전 ARN */
  latest: string;
  rolloutStates: string[];
}

/**
 * 배포가 «정말 라이브인가». 회로 차단기 롤백은 새 리비전을 등록해 둔 채 서비스를 옛 리비전으로 되돌린다(2026-10-15) —
 * 롤아웃 상태만 보면 COMPLETED 라 «돌고 있는 것 = 가장 최근 리비전»까지 봐야 잡힌다.
 */
export function rolloutProblems(services: readonly EcsServiceSnapshot[]): string[] {
  if (!services.length) return ['ECS 서비스를 하나도 찾지 못했다 — 스테이지·클러스터 이름을 확인한다'];
  return services.flatMap((s) => {
    const where = `${s.cluster}/${s.service}`;
    if (s.rolloutStates.length !== 1) return [`${where}: 배포가 ${s.rolloutStates.length}개 진행 중이다`];
    if (s.rolloutStates[0] !== 'COMPLETED') return [`${where}: 롤아웃이 ${s.rolloutStates[0]} 이다`];
    if (s.running !== s.latest) {
      return [`${where}: 최신 리비전(${revisionOf(s.latest)})이 아니라 ${revisionOf(s.running)} 이 돈다 — 롤백됐다`];
    }
    return [];
  });
}

function revisionOf(taskDefinitionArn: string): string {
  return taskDefinitionArn.split('/').pop() ?? taskDefinitionArn;
}

/** 배포 태그 이름. 사람이 KST 로 기억하므로 KST 로 찍는다(분 단위 — 한 배포가 한 시간이라 겹치지 않는다) */
export function deployTagName(stage: string, at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `deploy/${stage}/${part('year')}${part('month')}${part('day')}-${part('hour')}${part('minute')}`;
}
