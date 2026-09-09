import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findGuardViolations, OVERLAP_SAFE_MARKER } from './cron-once-guard';

/**
 * 크론 «주기당 한 번» 규칙의 게이트 (ADR-0036, #821).
 *
 * 1. `apps/*\/src` 의 `@Cron(` 은 바로 윗줄에 `// cron-overlap-safe:` 마커가 있을 때만 허용한다.
 * 2. `@CronOnce` 의 `name` 은 앱 안에서 유일하다 (부팅에서도 죽지만 게이트가 먼저 잡는다).
 * 3. `@CronOnce` 를 하나라도 쓰는 앱은 `CronOnceModule` 을 import 한다. 모듈이 빠지면 데코레이터
 *    메타데이터가 탐색되지 않아 크론이 **조용히 안 돈다** — 부팅 실패보다 나쁜 실패다.
 *
 * ⚠️ 마지막 it 은 저장소 전체를 읽는다. 새 앱에서 무심코 `@Cron` 을 쓰면 그 앱의 diff 만 보는
 * 리뷰로는 안 걸리지만 여기서는 걸린다.
 */
const file = (path: string, content: string) => ({ path, content });

describe('findGuardViolations (픽스처)', () => {
  const moduleOk = file('apps/foo/src/app.module.ts', `import { CronOnceModule } from '@app/cron-once';\n@Module({ imports: [CronOnceModule] })`);

  it('마커 없는 @Cron 은 위반', () => {
    const v = findGuardViolations([file('apps/foo/src/a.service.ts', `  @Cron('0 3 * * *')\n  async run() {}`)]);
    expect(v).toEqual([expect.objectContaining({ rule: 'raw-cron-without-marker', path: 'apps/foo/src/a.service.ts', line: 1 })]);
  });

  it('바로 윗줄 마커가 있으면 허용', () => {
    const v = findGuardViolations([
      file('apps/foo/src/a.worker.ts', `  ${OVERLAP_SAFE_MARKER} lease CAS\n  @Cron(CronExpression.EVERY_5_SECONDS)\n  async tick() {}`),
    ]);
    expect(v).toEqual([]);
  });

  it('마커가 두 줄 위에 있으면 허용하지 않는다 (바로 윗줄만)', () => {
    const v = findGuardViolations([
      file('apps/foo/src/a.worker.ts', `  ${OVERLAP_SAFE_MARKER} lease CAS\n\n  @Cron('* * * * *')\n  async tick() {}`),
    ]);
    expect(v.map((x) => x.rule)).toEqual(['raw-cron-without-marker']);
  });

  it('같은 앱에서 name 이 겹치면 위반, 다른 앱이면 허용', () => {
    const v = findGuardViolations([
      moduleOk,
      file('apps/foo/src/a.ts', `@CronOnce('0 3 * * *', { name: 'nightly' })`),
      file('apps/foo/src/b.ts', `@CronOnce('0 4 * * *', {\n  name: 'nightly',\n})`),
      file('apps/bar/src/app.module.ts', `CronOnceModule`),
      file('apps/bar/src/c.ts', `@CronOnce('0 5 * * *', { name: 'nightly' })`),
    ]);
    expect(v.map((x) => [x.rule, x.path])).toEqual([['duplicate-name', 'apps/foo/src/b.ts']]);
  });

  it('@CronOnce 를 쓰는데 CronOnceModule import 가 없으면 위반', () => {
    const v = findGuardViolations([file('apps/foo/src/a.ts', `@CronOnce('0 3 * * *', { name: 'x' })`)]);
    expect(v).toEqual([expect.objectContaining({ rule: 'module-missing', path: 'apps/foo' })]);
  });

  it('스펙 파일은 검사하지 않는다', () => {
    const v = findGuardViolations([file('apps/foo/src/a.spec.ts', `@Cron('* * * * *')`)]);
    expect(v).toEqual([]);
  });
});

describe('저장소 전수 (#821)', () => {
  it('apps/*/src 에 위반이 없다', () => {
    const REPO = join(__dirname, '..', '..', '..', '..');
    // `git ls-files -- 'apps/*/src/**/*.ts'` 는 git wildmatch 상 `**` 가 최소 한 디렉토리를
    // 요구해 `src/` 바로 아래 파일(예: `app.module.ts`)을 빼먹는다 — CronOnceModule import 가
    // 대개 거기 있으므로 이 누락은 module-missing 오탐을 만든다. 그래서 `apps/` 전체를 받아
    // 같은 `appOf` 모양의 필터를 TS 쪽에서 적용한다.
    const paths = execFileSync('git', ['ls-files', '--', 'apps/'], { cwd: REPO, encoding: 'utf8' })
      .split('\n')
      .filter((p) => /^apps\/[^/]+\/src\/.*\.ts$/.test(p));
    expect(paths.length).toBeGreaterThan(1000);
    const files = paths.map((p) => ({ path: p, content: readFileSync(join(REPO, p), 'utf8') }));
    expect(findGuardViolations(files)).toEqual([]);
  });
});
