import { z } from 'zod';

/**
 * 배치 배포 점검의 판정부 — 입력은 이미 읽어 온 사실(마이그 SQL·journal·이슈 본문·ECS 상태)이고 출력은 판정이다.
 * DB·git·gh·aws 를 부르는 껍데기는 `batch-deploy-preflight.ts` 에 있다.
 */

interface Rule {
  label: string;
  test: (sql: string) => boolean;
}

const re = (label: string, pattern: RegExp): Rule => ({ label, test: (sql) => pattern.test(sql) });

/** 기존 표에 붙이는 NOT NULL 칸은 옛 코드의 INSERT 를 깨고, 그 칸을 쓰는 새 코드는 마이그 전에 깨진다 — 한 걸음으로는 안전한 순서가 없다 */
function addsRequiredColumn(sql: string): boolean {
  return [...sql.matchAll(/\bADD\s+COLUMN\b([^;]*)/gi)]
    .flatMap((m) => m[1].split(/,(?=\s*ADD\b)/i))
    .some((clause) => /\bNOT\s+NULL\b/i.test(clause) && !/\b(DEFAULT|GENERATED)\b/i.test(clause));
}

const VIEW_NAME = String.raw`(?:IF\s+(?:NOT\s+)?EXISTS\s+)?((?:"?\w+"?\.)?"?\w+"?)`;

function viewNames(sql: string, verb: RegExp): Set<string> {
  const pattern = new RegExp(String.raw`${verb.source}\s+(?:MATERIALIZED\s+)?VIEW\s+${VIEW_NAME}`, 'gi');
  return new Set([...sql.matchAll(pattern)].map((m) => m[1].replace(/"/g, '').replace(/^public\./i, '')));
}

/** 뷰는 컬럼을 바꾸려면 DROP 후 CREATE 로 다시 만든다 — 같은 이름을 다시 만들면 파괴도 추가도 아니다 */
function viewDelta(sql: string): { dropped: string[]; created: string[] } {
  const dropped = viewNames(sql, /\bDROP/);
  const created = viewNames(sql, /\bCREATE(?:\s+OR\s+REPLACE)?/);
  return {
    dropped: [...dropped].filter((name) => !created.has(name)),
    created: [...created].filter((name) => !dropped.has(name)),
  };
}

/** ADR-0005 §5 의 destructive 변경 — 옛 코드가 새 schema 를 만나면 깨진다. 그래서 `deploy → migrate` 다 */
const CONTRACT_RULES: readonly Rule[] = [
  re('DROP TABLE', /\bDROP\s+TABLE\b/i),
  re(
    'DROP COLUMN',
    /\bDROP\s+COLUMN\b|\bALTER\s+TABLE\b[^;]*\bDROP\s+(?!CONSTRAINT\b|COLUMN\b|NOT\s+NULL\b|DEFAULT\b|IDENTITY\b|EXPRESSION\b)["\w]/i,
  ),
  re('DROP TYPE', /\bDROP\s+TYPE\b/i),
  re('DROP SCHEMA·SEQUENCE', /\bDROP\s+(SCHEMA|SEQUENCE)\b/i),
  { label: 'DROP VIEW', test: (sql) => viewDelta(sql).dropped.length > 0 },
  re('RENAME', /\bRENAME\b/i),
  re('SET SCHEMA', /\bSET\s+SCHEMA\b/i),
  re('SET NOT NULL', /\bSET\s+NOT\s+NULL\b/i),
  re('컬럼 타입 변경', /\bALTER\s+COLUMN\s+"?[^"\s]+"?\s+(SET\s+DATA\s+)?TYPE\b/i),
  // 옛 코드의 `ON CONFLICT (칸)` 이 기대는 유니크다. 이름으로만 알아본다(drizzle `<표>_<칸>_unique`, 손으로 지은 `uq_`·`unique_`)
  re('유니크 제거', /\bDROP\s+(?:CONSTRAINT|INDEX)\s+(?:IF\s+EXISTS\s+)?"?(?:uq_|unique_|\w+_unique\b)/i),
  { label: '기본값 없는 NOT NULL 칸 추가', test: addsRequiredColumn },
];

/**
 * 새 코드가 새 schema 를 기대한다 — 옛 코드는 무시하므로 `migrate → deploy` 다.
 * 평범한 인덱스와 CHECK·FK 는 넣지 않는다: contract 마이그도 남은 칸에 인덱스를 다시 걸고(#724 PR-C) 좁힌 타입에 CHECK 를 단다.
 * 유니크는 넣는다 — 새 코드의 `ON CONFLICT` 가 기댈 수 있다.
 */
const EXPAND_RULES: readonly Rule[] = [
  re('CREATE TABLE', /\bCREATE\s+TABLE\b/i),
  re('ADD COLUMN', /\bADD\s+COLUMN\b/i),
  re('유니크 인덱스', /\bCREATE\s+UNIQUE\s+INDEX\b/i),
  re('유니크 제약', /\bADD\s+CONSTRAINT\s+"?[^"\s]+"?\s+UNIQUE\b/i),
  re('enum 값 추가', /\bALTER\s+TYPE\b[^;]*\bADD\s+VALUE\b/i),
  re('CREATE SCHEMA·SEQUENCE', /\bCREATE\s+(SCHEMA|SEQUENCE)\b/i),
  { label: 'CREATE VIEW', test: (sql) => viewDelta(sql).created.length > 0 },
];

/** 둘 다 아닌 것(SET LOCAL·인덱스·CHECK·FK·DROP NOT NULL·데이터 UPDATE 등)만 있으면 `neutral` — 순서를 강제하지 않는다 */
export const MIGRATION_KINDS = ['expand', 'contract', 'mixed', 'neutral'] as const;
export type MigrationKind = (typeof MIGRATION_KINDS)[number];

export interface MigrationClass {
  kind: MigrationKind;
  contract: string[];
  expand: string[];
}

/** 주석만 지운다. 문자열 안의 `--` 는 주석이 아니다 — 지우면 같은 줄 뒤의 DROP 까지 사라진다 */
function stripComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "'") {
      const end = sql.indexOf("'", i + 1);
      const stop = end < 0 ? sql.length : end + 1;
      out += sql.slice(i, stop);
      i = stop;
    } else if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end;
      out += ' ';
    } else if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += ' ';
    } else {
      out += sql[i];
      i += 1;
    }
  }
  return out;
}

export function classifyMigration(sql: string): MigrationClass {
  const body = stripComments(sql);
  const contract = CONTRACT_RULES.filter((r) => r.test(body)).map((r) => r.label);
  const expand = EXPAND_RULES.filter((r) => r.test(body)).map((r) => r.label);
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
 * drizzle migrator 의 규칙(`drizzle-orm/pg-core/dialect.js` migrate): 적용 이력의 가장 늦은 `created_at` 보다 `when` 이 큰 항목만
 * 적용하고, 적용하면 `created_at` 에 그 `when` 을 적는다. 그래서 가장 늦은 이력보다 이른데 이력에 없는 항목은 **영영 적용되지 않는다** —
 * 더 늦게 만든 마이그가 먼저 배포된 뒤에 머지된 PR 의 마이그가 그렇다. 대기가 아니라 «건너뜀»이다.
 */
export function migrationStatus(
  entries: readonly JournalEntry[],
  appliedAt: readonly number[],
): { pending: JournalEntry[]; skipped: JournalEntry[] } {
  const applied = new Set(appliedAt);
  const last = appliedAt.length ? Math.max(...appliedAt) : null;
  return {
    pending: entries.filter((e) => last === null || e.when > last),
    skipped: entries.filter((e) => last !== null && e.when <= last && !applied.has(e.when)),
  };
}

export interface CoreTenantVersion {
  label: string;
  /** 적용 이력의 journal `when` 들 */
  applied: readonly number[];
}

/**
 * 테넌트 core DB 들의 적용 이력이 같은가. 전 테넌트 동일 버전이 배포 조건이다 — 「일부 테넌트만 새 버전」이면
 * expand-contract 규율(한 DB 전제)이 깨진다. 다르면 사람이 읽을 이유, 같으면 null.
 */
export function coreVersionMismatch(versions: readonly CoreTenantVersion[]): string | null {
  const key = (v: CoreTenantVersion) => [...new Set(v.applied)].sort((a, b) => a - b).join(',');
  if (new Set(versions.map(key)).size <= 1) return null;
  return `테넌트 core DB 사이 마이그 버전이 다르다: ${versions.map((v) => `${v.label} ${v.applied.length}건`).join(' · ')}`;
}

const CORE_DATABASE_NAME = /^core(_|$)/;

/**
 * 테넌트 목록에 없는 core 꼴 DB. 이름으로 테넌트를 «찾지» 않으므로 이런 DB 는 도구가 마이그하지 않는다 —
 * 준비 중 테넌트(`--tenant`)나 지우다 만 DB 다. 막지 않고 경고만 한다.
 */
export function unlistedCoreDatabases(databases: readonly string[], listed: readonly string[]): string[] {
  return databases.filter((d) => CORE_DATABASE_NAME.test(d) && !listed.includes(d));
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
 * 추적 이슈 «## 남은 운영 작업» 절의 체크 안 된 줄 중 제목(첫 « — » 앞)에 «배포»가 든 것. 제목만 돌려준다 — 줄 전체는 수백 자다.
 * 절을 못 찾으면 null — 머리글이 바뀐 것을 «남은 배포 없음»으로 읽으면 안 된다.
 */
export function uncheckedDeployLines(issueBody: string): string[] | null {
  const section = /^## 남은 운영 작업\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(issueBody);
  if (!section) return null;
  return section[1]
    .split('\n')
    .filter((line) => line.startsWith('- [ ] '))
    .map((line) => line.slice('- [ ] '.length).split(' — ')[0].trim())
    .filter((title) => title.includes('배포'));
}

export interface EcsServiceSnapshot {
  deployment: string;
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
export function rolloutProblems(services: readonly EcsServiceSnapshot[], deployments: readonly string[]): string[] {
  const missing = deployments
    .filter((d) => !services.some((s) => s.deployment === d))
    .map((d) => `${d}: ECS 서비스를 하나도 찾지 못했다 — 클러스터 이름이 바뀌었으면 이 배포는 확인되지 않은 것이다`);
  return [
    ...missing,
    ...services.flatMap((s) => {
      const where = `${s.cluster}/${s.service}`;
      if (s.rolloutStates.length !== 1) return [`${where}: 배포가 ${s.rolloutStates.length}개 진행 중이다`];
      if (s.rolloutStates[0] !== 'COMPLETED') return [`${where}: 롤아웃이 ${s.rolloutStates[0]} 이다`];
      if (s.running !== s.latest) {
        return [`${where}: 최신 리비전(${revisionOf(s.latest)})이 아니라 ${revisionOf(s.running)} 이 돈다 — 롤백됐다`];
      }
      return [];
    }),
  ];
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

/**
 * 이미지 하나를 빌드할 때의 최악 메모리. 루트 `npm ci` 가 1.8GB(2026-10-24 실측)이고, Dockerfile 의 deps·deps-prod 는
 * 서로 기대지 않아 lockfile 이 바뀐 배치에서는 둘이 동시에 처음부터 돈다. nest build(Core 2.3GB)는 그 뒤라 겹치지 않는다.
 */
export const IMAGE_BUILD_PEAK_BYTES = 3.6e9;
const MAX_CONTAINER_CONCURRENCY = 4;

export interface BuildMachineFacts {
  /** `process.arch` */
  arch: string;
  /** 켜져 있는 binfmt_misc 항목 이름. 읽을 수 없으면(리눅스가 아니면) null */
  binfmtEnabled: readonly string[] | null;
  /** `SST_BUILD_CONCURRENCY_CONTAINER` 원문 */
  containerConcurrency: string | undefined;
  availableMemoryBytes: number;
  stage: string;
}

export type BuildMachineFinding =
  | { level: 'ok'; message: string }
  | { level: 'warn' | 'block'; message: string; fix: string };

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)}GB`;

/**
 * sst deploy 를 띄울 이 머신이 이미지를 빌드할 수 있는가, 빠르게 빌드하는가. 모든 서비스 이미지가 arm64 라
 * x86 머신은 QEMU binfmt 가 있어야 하고(재부팅하면 풀린다 — 2026-10-21), SST 는 컨테이너 빌드를 기본 1개씩만 돌린다.
 * 동시성은 sst 를 띄우기 전 환경변수로만 먹으므로(빌드 세마포어가 모듈 로드 때 만들어진다) 점검은 «이 셸»을 본다.
 */
export function buildMachineFindings(facts: BuildMachineFacts): BuildMachineFinding[] {
  const findings: BuildMachineFinding[] = [];
  if (facts.arch === 'arm64') {
    findings.push({ level: 'ok', message: 'arm64 머신 — 이미지를 에뮬레이션 없이 빌드한다' });
  } else if (facts.binfmtEnabled === null) {
    findings.push({
      level: 'warn',
      message: 'binfmt_misc 를 읽지 못했다 — arm64 이미지를 빌드할 수 있는지 모른다',
      fix: 'docker buildx inspect 의 Platforms 에 linux/arm64 가 있는지 본다',
    });
  } else if (!facts.binfmtEnabled.includes('qemu-aarch64')) {
    findings.push({
      level: 'block',
      message: 'arm64 에뮬레이터(qemu-aarch64)가 등록돼 있지 않다 — 이대로면 이미지 빌드가 exec format error 로 죽는다',
      fix: 'docker run --privileged --rm tonistiigi/binfmt --install arm64 (재부팅하면 다시 해야 한다)',
    });
  } else {
    findings.push({ level: 'ok', message: 'arm64 에뮬레이터 등록됨 — 런타임 의존성 설치만 에뮬레이션으로 돈다' });
  }

  const affordable = Math.max(
    1,
    Math.min(MAX_CONTAINER_CONCURRENCY, Math.floor(facts.availableMemoryBytes / IMAGE_BUILD_PEAK_BYTES)),
  );
  const memory = `가용 메모리 ${gb(facts.availableMemoryBytes)}, 이미지 하나 최악 ${gb(IMAGE_BUILD_PEAK_BYTES)}`;
  const command = (n: number) => `SST_BUILD_CONCURRENCY_CONTAINER=${n} npx sst deploy --stage ${facts.stage}`;
  const raw = facts.containerConcurrency?.trim();
  const requested = raw ? Number(raw) : 1;
  if (!Number.isInteger(requested) || requested < 1) {
    findings.push({
      level: 'block',
      message: `SST_BUILD_CONCURRENCY_CONTAINER=${raw} 는 1 이상의 정수가 아니다`,
      fix: command(affordable),
    });
  } else if (requested > affordable && requested > 1) {
    findings.push({
      level: 'warn',
      message: `컨테이너 빌드 ${requested}개 동시 — ${memory}라 lockfile 이 바뀐 배치면 메모리가 모자랄 수 있다`,
      fix: `로컬 컨테이너·앱을 내리고 다시 점검하거나 ${command(affordable)}`,
    });
  } else if (requested > 1) {
    findings.push({ level: 'ok', message: `컨테이너 빌드 ${requested}개 동시 (${memory})` });
  } else if (affordable > 1) {
    findings.push({
      level: 'warn',
      message: '컨테이너 빌드가 하나씩 돈다(SST 기본값) — 이미지가 차례로 빌드된다',
      fix: `이 셸에서 ${command(affordable)} 로 띄운다 (${memory})`,
    });
  } else {
    findings.push({
      level: 'warn',
      message: `컨테이너 빌드가 하나씩 돈다 — ${memory}라 둘을 겹치면 lockfile 이 바뀐 배치에서 모자랄 수 있다`,
      fix: `로컬 컨테이너·앱을 내리고 다시 점검한다. 그대로면 ${command(1)}`,
    });
  }
  return findings;
}
