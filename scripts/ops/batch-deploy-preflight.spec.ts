import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getServiceRegistry } from '../seeding/lib/service-registry';
import {
  BuildMachineFacts,
  BuildMachineFinding,
  buildMachineFindings,
  classifyMigration,
  coreVersionMismatch,
  IMAGE_BUILD_PEAK_BYTES,
  deployTagName,
  EcsServiceSnapshot,
  judgeDeployment,
  migrationsOutDir,
  migrationStatus,
  parseJournal,
  PendingMigration,
  rolloutProblems,
  uncheckedDeployLines,
  unlistedCoreDatabases,
} from './batch-deploy-preflight.lib';

const ROOT = resolve(__dirname, '../..');
const repoSql = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('classifyMigration', () => {
  it('drizzle 가 만든 실제 contract 마이그(#1063 PR 4)는 contract — lock_timeout·DROP CONSTRAINT·DROP INDEX 는 섞임으로 세지 않는다', () => {
    const cls = classifyMigration(repoSql('apps/core/drizzle/20261014162912_drop-legacy-line-matching-columns.sql'));
    expect(cls.kind).toBe('contract');
    expect(cls.contract).toEqual(expect.arrayContaining(['DROP TABLE', 'DROP COLUMN']));
  });

  it('contract 마이그가 남은 칸에 인덱스를 다시 걸어도 섞임이 아니다(#724 PR-C 실제 파일)', () => {
    expect(classifyMigration(repoSql('apps/core/drizzle/20260826113617_purchase-order-contract-phase.sql')).kind).toBe(
      'contract',
    );
  });

  it('새 칸·새 표·enum 값·기본값 있는 NOT NULL 칸은 expand', () => {
    const sql = [
      'CREATE TABLE "event"."event_dead_letters" ("id" uuid PRIMARY KEY NOT NULL);',
      'ALTER TABLE "refunds" ADD COLUMN "kind" "refund_kind";',
      'ALTER TABLE "refunds" ADD COLUMN "execution" "refund_execution" DEFAULT \'AUTO\' NOT NULL;',
      'ALTER TYPE "public"."order_status" ADD VALUE \'settling\';',
    ].join('--> statement-breakpoint\n');
    expect(classifyMigration(sql).kind).toBe('expand');
  });

  it('유니크 인덱스·유니크 제약은 expand — 새 코드의 ON CONFLICT 가 기댄다', () => {
    expect(classifyMigration('CREATE UNIQUE INDEX "uq_a" ON "a" ("b");').kind).toBe('expand');
    expect(classifyMigration('ALTER TABLE "a" ADD CONSTRAINT "uq_a_b" UNIQUE("b");').kind).toBe('expand');
  });

  it('한 파일에서 칸을 더하고 지우면 mixed — drizzle 가 rename 을 DROP + ADD 로 만든 모양이다', () => {
    const cls = classifyMigration(
      'ALTER TABLE "a" ADD COLUMN "new_name" text;--> statement-breakpoint\nALTER TABLE "a" DROP COLUMN "old_name";',
    );
    expect(cls.kind).toBe('mixed');
  });

  it('유니크 제약을 부분 유니크 인덱스로 바꾸면 mixed — 옛 코드의 ON CONFLICT 가 깨진다(실제 파일)', () => {
    expect(classifyMigration(repoSql('apps/core/drizzle/20260630155417_shipments-active-unique.sql')).kind).toBe(
      'mixed',
    );
  });

  it('기존 표에 기본값 없는 NOT NULL 칸을 붙이면 한 걸음으로 안전한 순서가 없다', () => {
    expect(classifyMigration('ALTER TABLE "a" ADD COLUMN "b" text NOT NULL;').kind).toBe('mixed');
  });

  it.each([
    ['SET NOT NULL', 'ALTER TABLE "a" ALTER COLUMN "b" SET NOT NULL;'],
    ['타입 변경', 'ALTER TABLE "a" ALTER COLUMN "b" SET DATA TYPE integer;'],
    ['RENAME COLUMN', 'ALTER TABLE "a" RENAME COLUMN "b" TO "c";'],
    ['COLUMN 없는 RENAME', 'ALTER TABLE "a" RENAME "b" TO "c";'],
    ['COLUMN 없는 DROP', 'ALTER TABLE "a" DROP "b";'],
    ['SET SCHEMA', 'ALTER TABLE "a" SET SCHEMA "archive";'],
    ['DROP SEQUENCE', 'DROP SEQUENCE "a_seq";'],
    ['DROP SCHEMA', 'DROP SCHEMA "legacy" CASCADE;'],
    ['다시 만들지 않는 DROP VIEW', 'DROP VIEW "public"."stock_summary_view";'],
    ["문자열 '--' 뒤의 DROP", 'UPDATE "a" SET "b" = \'--\'; ALTER TABLE "a" DROP COLUMN "c";'],
  ])('%s 는 contract', (_label, sql) => {
    expect(classifyMigration(sql).kind).toBe('contract');
  });

  it('같은 이름으로 다시 만드는 뷰는 파괴가 아니다', () => {
    const sql =
      'DROP VIEW "stock_summary_view";--> statement-breakpoint\nCREATE VIEW "public"."stock_summary_view" AS (select 1);';
    expect(classifyMigration(sql).kind).toBe('neutral');
  });

  it('주석 속 단어는 세지 않는다', () => {
    const cls = classifyMigration(
      '-- 다음 배치에서 DROP TABLE 한다\n/* RENAME TO 금지 */\nCREATE TABLE "a" ("b" text);',
    );
    expect(cls).toEqual({ kind: 'expand', contract: [], expand: ['CREATE TABLE'] });
  });

  it('데이터만 고치거나 NOT NULL 을 푸는 마이그는 neutral', () => {
    expect(classifyMigration('UPDATE "a" SET "b" = 1 WHERE "b" IS NULL;').kind).toBe('neutral');
    expect(classifyMigration('ALTER TABLE "a" ALTER COLUMN "b" DROP NOT NULL;').kind).toBe('neutral');
  });
});

describe('migrationStatus', () => {
  const entries = [
    { idx: 0, when: 100, tag: 'a' },
    { idx: 1, when: 150, tag: 'b' },
    { idx: 2, when: 200, tag: 'c' },
    { idx: 3, when: 300, tag: 'd' },
  ];
  const tags = (list: { tag: string }[]) => list.map((e) => e.tag);

  it('가장 늦은 적용 이력보다 늦은 항목이 대기다', () => {
    const status = migrationStatus(entries, [100, 150, 200]);
    expect(tags(status.pending)).toEqual(['d']);
    expect(status.skipped).toEqual([]);
  });

  it('이력보다 이른데 적용되지 않은 항목은 대기가 아니라 «건너뜀»이다 — drizzle 가 영영 적용하지 않는다', () => {
    const status = migrationStatus(entries, [100, 200]);
    expect(tags(status.skipped)).toEqual(['b']);
    expect(tags(status.pending)).toEqual(['d']);
  });

  it('이력이 없으면 전부 대기다', () => {
    expect(tags(migrationStatus(entries, []).pending)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('judgeDeployment', () => {
  const m = (kind: PendingMigration['kind'], tag: string = kind): PendingMigration => ({
    service: 'core',
    tag,
    kind,
    contract: [],
    expand: [],
  });

  it('대기 마이그 종류로 순서를 정한다', () => {
    expect(judgeDeployment([])).toEqual({ kind: 'none' });
    expect(judgeDeployment([m('expand'), m('neutral')])).toEqual({ kind: 'expand' });
    expect(judgeDeployment([m('contract'), m('neutral')])).toEqual({ kind: 'contract' });
  });

  it('expand 와 contract 가 한 배치에 있으면 mixed — 어느 쪽인지 이름을 댄다', () => {
    const verdict = judgeDeployment([m('expand', 'add-x'), m('contract', 'drop-y')]);
    expect(verdict.kind).toBe('mixed');
    expect(verdict.kind === 'mixed' && verdict.reason).toContain('core/drop-y');
  });

  it('한 파일 안의 섞임도 mixed 다', () => {
    expect(judgeDeployment([m('mixed', 'rename-z')]).kind).toBe('mixed');
  });
});

describe('uncheckedDeployLines', () => {
  const body = [
    '## 표',
    '- [ ] 표 안의 배포 줄처럼 보이는 것',
    '',
    '## 남은 운영 작업',
    '',
    '배포는 여러 행의 PR 을 모아 한 번에 한다.',
    '',
    '- [x] 1번 행 배포 — 끝났다',
    '- [ ] 13번 행 브라우저 스모크 — 배포 뒤에 본다',
    '- [ ] 35번 행 창고 앱 배포 — 별도 배포',
    '- [ ] 30·25번 배포 전 대상 건수 확인',
    '',
    '## 관찰 모드 규칙',
    '- [ ] 99번 행 배포 — 다른 절',
  ].join('\n');

  it('그 절의 체크 안 된 줄 중 제목에 «배포»가 든 것만, 제목만 돌려준다', () => {
    expect(uncheckedDeployLines(body)).toEqual(['35번 행 창고 앱 배포', '30·25번 배포 전 대상 건수 확인']);
  });

  it('절이 없으면 «없음»이 아니라 null — 머리글이 바뀐 것을 초록으로 읽지 않는다', () => {
    expect(uncheckedDeployLines('## 표\n- [ ] 배포')).toBeNull();
  });
});

describe('rolloutProblems', () => {
  const td = (rev: number) => `arn:aws:ecs:ap-northeast-2:1:task-definition/lcnine-services-live-Cluster-Core:${rev}`;
  const svc = (patch: Partial<EcsServiceSnapshot>): EcsServiceSnapshot => ({
    deployment: 'lcnine-services',
    cluster: 'lcnine-services-live-Cluster',
    service: 'Core',
    running: td(254),
    latest: td(254),
    rolloutStates: ['COMPLETED'],
    ...patch,
  });

  it('최신 리비전으로 COMPLETED 면 문제 없음', () => {
    expect(rolloutProblems([svc({})], ['lcnine-services'])).toEqual([]);
  });

  it('새 리비전을 등록해 놓고 옛 리비전이 돌면 롤백이다(2026-10-15)', () => {
    const [problem] = rolloutProblems([svc({ running: td(248), latest: td(249) })], ['lcnine-services']);
    expect(problem).toContain('Core:249');
    expect(problem).toContain('Core:248');
  });

  it('배포가 둘 이상이거나 COMPLETED 가 아니면 아직 끝나지 않았다', () => {
    expect(rolloutProblems([svc({ rolloutStates: ['IN_PROGRESS', 'COMPLETED'] })], ['lcnine-services'])).toHaveLength(
      1,
    );
    expect(rolloutProblems([svc({ rolloutStates: ['FAILED'] })], ['lcnine-services'])).toHaveLength(1);
  });

  it('배포 하나의 서비스를 하나도 못 찾으면 그 배포는 확인되지 않은 것이다', () => {
    const problems = rolloutProblems([svc({})], ['lcnine-services', 'lcnine-auth']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('lcnine-auth');
  });
});

describe('buildMachineFindings', () => {
  const facts = (over: Partial<BuildMachineFacts>): BuildMachineFacts => ({
    arch: 'x64',
    binfmtEnabled: ['qemu-aarch64'],
    containerConcurrency: '2',
    availableMemoryBytes: 3 * IMAGE_BUILD_PEAK_BYTES,
    stage: 'live',
    ...over,
  });
  const findings = (over: Partial<BuildMachineFacts>) => buildMachineFindings(facts(over));
  const levels = (over: Partial<BuildMachineFacts>) => findings(over).map((f) => f.level);
  const fixOf = (f: BuildMachineFinding) => (f.level === 'ok' ? '' : f.fix);

  it('에뮬레이터가 있고 메모리에 맞는 동시성이면 둘 다 초록', () => {
    expect(levels({})).toEqual(['ok', 'ok']);
  });

  it('x86 에서 qemu-aarch64 가 없으면 막는다 — 재부팅하면 풀린다(2026-10-21)', () => {
    const [binfmt] = findings({ binfmtEnabled: ['python3.12'] });
    expect(binfmt.level).toBe('block');
    expect(fixOf(binfmt)).toContain('tonistiigi/binfmt --install arm64');
  });

  it('arm64 머신은 에뮬레이터를 보지 않는다', () => {
    expect(levels({ arch: 'arm64', binfmtEnabled: [] })[0]).toBe('ok');
  });

  it('binfmt 를 읽지 못하면 초록이 아니라 경고다', () => {
    expect(levels({ binfmtEnabled: null })[0]).toBe('warn');
  });

  it('동시성이 비어 있으면 메모리가 허락하는 수를 넣은 배포 명령을 준다', () => {
    const [, concurrency] = findings({ containerConcurrency: undefined });
    expect(concurrency.level).toBe('warn');
    expect(fixOf(concurrency)).toContain('SST_BUILD_CONCURRENCY_CONTAINER=3 npx sst deploy --stage live');
  });

  it('권하는 동시성은 4 를 넘지 않는다', () => {
    const [, concurrency] = findings({
      containerConcurrency: undefined,
      availableMemoryBytes: 100 * IMAGE_BUILD_PEAK_BYTES,
    });
    expect(fixOf(concurrency)).toContain('SST_BUILD_CONCURRENCY_CONTAINER=4 ');
  });

  it('메모리보다 큰 동시성은 경고하고, 줄인 명령을 준다', () => {
    const [, concurrency] = findings({ containerConcurrency: '4', availableMemoryBytes: 2.5 * IMAGE_BUILD_PEAK_BYTES });
    expect(concurrency.level).toBe('warn');
    expect(fixOf(concurrency)).toContain('SST_BUILD_CONCURRENCY_CONTAINER=2 ');
  });

  it('메모리가 하나 분량도 안 되면 겹치라고 권하지 않는다', () => {
    const [, concurrency] = findings({
      containerConcurrency: undefined,
      availableMemoryBytes: 0.5 * IMAGE_BUILD_PEAK_BYTES,
    });
    expect(concurrency.level).toBe('warn');
    expect(fixOf(concurrency)).toContain('SST_BUILD_CONCURRENCY_CONTAINER=1 ');
  });

  it('SST 가 parseInt 로 읽어 0·NaN 이 되는 값은 막는다', () => {
    expect(levels({ containerConcurrency: 'two' })[1]).toBe('block');
    expect(levels({ containerConcurrency: '0' })[1]).toBe('block');
  });
});

describe('deployTagName', () => {
  it('KST 분 단위로 찍는다 — UTC 자정 전이 KST 다음 날이 된다', () => {
    expect(deployTagName('live', new Date('2026-10-18T06:30:00Z'))).toBe('deploy/live/20261018-1530');
    expect(deployTagName('live', new Date('2026-10-17T15:05:00Z'))).toBe('deploy/live/20261018-0005');
  });
});

describe('저장소의 drizzle 마이그', () => {
  const services = ['lcnine-services', 'lcnine-auth'].flatMap((d) =>
    getServiceRegistry(d, 'live').filter((s) => s.drizzleConfig),
  );
  const dirOf = (config: string) => join(ROOT, migrationsOutDir(repoSql(config)));

  it.each(services.map((s) => [s.name, s.drizzleConfig ?? ''] as const))(
    '%s — journal 의 when 이 순서대로 늘고 SQL 파일이 다 있다(줄어들면 drizzle 가 그 마이그를 영영 건너뛴다)',
    (_name, config) => {
      const entries = parseJournal(readFileSync(join(dirOf(config), 'meta/_journal.json'), 'utf8'));
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.filter((e, i) => i > 0 && e.when <= entries[i - 1].when).map((e) => e.tag)).toEqual([]);
      expect(entries.filter((e) => !existsSync(join(dirOf(config), `${e.tag}.sql`))).map((e) => e.tag)).toEqual([]);
    },
  );

  it('파괴 구문이 든 마이그는 하나도 expand·neutral 로 새지 않는다', () => {
    const destructive = /\bDROP\s+(TABLE|COLUMN|TYPE)\b|\bRENAME\b|\bSET\s+NOT\s+NULL\b/i;
    const leaked = execFileSync('git', ['ls-files', 'apps/*.sql'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((path) => path && !path.startsWith('apps/medusa/'))
      .filter((path) => destructive.test(repoSql(path).replace(/--.*$/gm, '')))
      .filter((path) => ['expand', 'neutral'].includes(classifyMigration(repoSql(path)).kind));
    expect(leaked).toEqual([]);
  });
});

describe('coreVersionMismatch — 전 테넌트 동일 버전이 배포 조건이다', () => {
  it('테넌트 DB 들의 적용 이력이 같으면 없음', () => {
    expect(
      coreVersionMismatch([
        { label: 'core(테넌트 1)', applied: [10, 20, 30] },
        { label: 'core(테넌트 2)', applied: [30, 10, 20] },
      ]),
    ).toBeNull();
  });

  it('테넌트 하나뿐이면 비교할 것이 없다', () => {
    expect(coreVersionMismatch([{ label: 'core(테넌트 1)', applied: [10] }])).toBeNull();
  });

  it('하나라도 다르면 어느 테넌트가 몇 건인지 적는다', () => {
    expect(
      coreVersionMismatch([
        { label: 'core(테넌트 1)', applied: [10, 20, 30] },
        { label: 'core(테넌트 2)', applied: [10, 20] },
      ]),
    ).toBe('테넌트 core DB 사이 마이그 버전이 다르다: core(테넌트 1) 3건 · core(테넌트 2) 2건');
  });

  it('건수가 같아도 다른 마이그면 다르다(한쪽이 건너뛴 경우)', () => {
    expect(
      coreVersionMismatch([
        { label: 'a', applied: [10, 30] },
        { label: 'b', applied: [10, 20] },
      ]),
    ).not.toBeNull();
  });
});

describe('unlistedCoreDatabases — 이름 규칙으로 테넌트를 찾지 않고, 목록 밖 core DB 는 경고만 한다', () => {
  it('목록에 없는 core·core_* 만 고른다', () => {
    expect(
      unlistedCoreDatabases(
        ['postgres', 'core', 'core_two', 'core_old', 'dev_core', 'corex', 'wallet'],
        ['core', 'core_two'],
      ),
    ).toEqual(['core_old']);
  });

  it('기존 core DB 가 목록에 없어도 경고 대상이다', () => {
    expect(unlistedCoreDatabases(['core', 'core_two'], ['core_two'])).toEqual(['core']);
  });
});
