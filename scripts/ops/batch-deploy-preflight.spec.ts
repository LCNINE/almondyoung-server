import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getServiceRegistry } from '../seeding/lib/service-registry';
import {
  classifyMigration,
  deployTagName,
  EcsServiceSnapshot,
  judgeDeployment,
  migrationsOutDir,
  parseJournal,
  pendingEntries,
  PendingMigration,
  rolloutProblems,
  uncheckedDeployLines,
} from './batch-deploy-preflight.lib';

const ROOT = resolve(__dirname, '../..');

describe('classifyMigration', () => {
  it('drizzle 가 만든 실제 contract 마이그(#1063 PR 4)는 contract — lock_timeout·DROP CONSTRAINT·DROP INDEX 는 섞임으로 세지 않는다', () => {
    const sql = readFileSync(
      join(ROOT, 'apps/core/drizzle/20261014162912_drop-legacy-line-matching-columns.sql'),
      'utf8',
    );
    expect(classifyMigration(sql)).toEqual({ kind: 'contract', contract: ['DROP TABLE', 'DROP COLUMN'], expand: [] });
  });

  it('새 칸·새 표는 expand', () => {
    const sql = [
      'CREATE TABLE "event"."event_dead_letters" ("id" uuid PRIMARY KEY NOT NULL);',
      'ALTER TABLE "refunds" ADD COLUMN "kind" "refund_kind";',
      'ALTER TYPE "public"."order_status" ADD VALUE \'settling\';',
    ].join('--> statement-breakpoint\n');
    expect(classifyMigration(sql).kind).toBe('expand');
  });

  it('한 파일에서 칸을 더하고 지우면 mixed — drizzle 가 rename 을 DROP + ADD 로 만든 모양이다', () => {
    const sql =
      'ALTER TABLE "a" ADD COLUMN "new_name" text;--> statement-breakpoint\nALTER TABLE "a" DROP COLUMN "old_name";';
    expect(classifyMigration(sql)).toEqual({ kind: 'mixed', contract: ['DROP COLUMN'], expand: ['ADD COLUMN'] });
  });

  it.each([
    ['SET NOT NULL', 'ALTER TABLE "a" ALTER COLUMN "b" SET NOT NULL;'],
    ['컬럼 타입 변경', 'ALTER TABLE "a" ALTER COLUMN "b" SET DATA TYPE integer;'],
    ['RENAME', 'ALTER TABLE "a" RENAME COLUMN "b" TO "c";'],
  ])('%s 는 contract', (label, sql) => {
    expect(classifyMigration(sql)).toEqual({ kind: 'contract', contract: [label], expand: [] });
  });

  it('주석 속 단어는 세지 않는다', () => {
    const sql = '-- 다음 배치에서 DROP TABLE 한다\n/* RENAME TO 금지 */\nCREATE TABLE "a" ("b" text);';
    expect(classifyMigration(sql)).toEqual({ kind: 'expand', contract: [], expand: ['CREATE TABLE'] });
  });

  it('contract 마이그가 남은 칸에 인덱스를 다시 걸어도 섞임이 아니다(#724 PR-C 실제 파일)', () => {
    const sql = readFileSync(join(ROOT, 'apps/core/drizzle/20260826113617_purchase-order-contract-phase.sql'), 'utf8');
    expect(classifyMigration(sql).kind).toBe('contract');
  });

  it('유니크 인덱스·유니크 제약은 expand — 새 코드의 ON CONFLICT 가 기댄다', () => {
    expect(classifyMigration('CREATE UNIQUE INDEX "uq_a" ON "a" ("b");').kind).toBe('expand');
    expect(classifyMigration('ALTER TABLE "a" ADD CONSTRAINT "uq_a_b" UNIQUE("b");').kind).toBe('expand');
  });

  it('데이터만 고치는 마이그는 neutral', () => {
    expect(classifyMigration('UPDATE "a" SET "b" = 1 WHERE "b" IS NULL;').kind).toBe('neutral');
  });
});

describe('pendingEntries', () => {
  const entries = [
    { idx: 0, when: 100, tag: 'a' },
    { idx: 1, when: 200, tag: 'b' },
    { idx: 2, when: 300, tag: 'c' },
  ];

  it('적용 이력보다 늦은 항목만 대기다', () => {
    expect(pendingEntries(entries, 200).map((e) => e.tag)).toEqual(['c']);
    expect(pendingEntries(entries, 300)).toEqual([]);
  });

  it('이력이 없으면 전부 대기다', () => {
    expect(pendingEntries(entries, null).map((e) => e.tag)).toEqual(['a', 'b', 'c']);
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

  it('절이 없으면 빈 목록', () => {
    expect(uncheckedDeployLines('## 표\n- [ ] 배포')).toEqual([]);
  });
});

describe('rolloutProblems', () => {
  const td = (rev: number) => `arn:aws:ecs:ap-northeast-2:1:task-definition/lcnine-services-live-Cluster-Core:${rev}`;
  const svc = (patch: Partial<EcsServiceSnapshot>): EcsServiceSnapshot => ({
    cluster: 'lcnine-services-live-Cluster',
    service: 'Core',
    running: td(254),
    latest: td(254),
    rolloutStates: ['COMPLETED'],
    ...patch,
  });

  it('최신 리비전으로 COMPLETED 면 문제 없음', () => {
    expect(rolloutProblems([svc({})])).toEqual([]);
  });

  it('새 리비전을 등록해 놓고 옛 리비전이 돌면 롤백이다(2026-10-15)', () => {
    expect(rolloutProblems([svc({ running: td(248), latest: td(249) })])).toEqual([
      'lcnine-services-live-Cluster/Core: 최신 리비전(lcnine-services-live-Cluster-Core:249)이 아니라 lcnine-services-live-Cluster-Core:248 이 돈다 — 롤백됐다',
    ]);
  });

  it('배포가 둘 이상이거나 COMPLETED 가 아니면 아직 끝나지 않았다', () => {
    expect(rolloutProblems([svc({ rolloutStates: ['IN_PROGRESS', 'COMPLETED'] })])).toHaveLength(1);
    expect(rolloutProblems([svc({ rolloutStates: ['FAILED'] })])).toHaveLength(1);
  });

  it('서비스를 하나도 못 찾으면 통과시키지 않는다', () => {
    expect(rolloutProblems([])).toHaveLength(1);
  });
});

describe('deployTagName', () => {
  it('KST 분 단위로 찍는다 — UTC 자정 전이 KST 다음 날이 된다', () => {
    expect(deployTagName('live', new Date('2026-10-18T06:30:00Z'))).toBe('deploy/live/20261018-1530');
    expect(deployTagName('live', new Date('2026-10-17T15:05:00Z'))).toBe('deploy/live/20261018-0005');
  });
});

describe('배포마다 drizzle 서비스의 journal 을 찾을 수 있다', () => {
  const services = ['lcnine-services', 'lcnine-auth'].flatMap((d) =>
    getServiceRegistry(d, 'live').filter((s) => s.drizzleConfig),
  );

  it.each(services.map((s) => [s.name, s.drizzleConfig ?? ''] as const))('%s', (_name, config) => {
    const dir = join(ROOT, migrationsOutDir(readFileSync(join(ROOT, config), 'utf8')));
    const entries = parseJournal(readFileSync(join(dir, 'meta/_journal.json'), 'utf8'));
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.filter((e) => !existsSync(join(dir, `${e.tag}.sql`)))).toEqual([]);
  });
});
