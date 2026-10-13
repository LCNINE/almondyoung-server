import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROLE_LITERAL_BASELINE } from './role-name-checks.baseline';
import { countRoleLiterals, nonLiteralCheckpointCalls } from './role-name-scan';

/**
 * 코드는 역할 이름이 아니라 권한만 본다(ADR-0045). 역할 이름 문자열은 기준 목록의 파일·개수만큼만 남아 있고,
 * 옛 판정을 걷어 낼 때 목록을 줄인다. 새 역할 이름 판정이 생기면(같은 파일 안이어도) 개수가 늘어 여기서 걸린다.
 * 판정 지점 이름(지표 라벨)이 리터럴인지도 함께 본다.
 */
const ROOT = join(__dirname, '..', '..');
const INCLUDED = /^(apps|libs)\/[^/]+\/src\/.*\.tsx?$/;
const EXCLUDED = /\.spec\.tsx?$|\.d\.ts$|__support__|fixtures|^apps\/(medusa|wallet-web)\//;

/** 추적 중인 파일과 아직 추가하지 않은 새 파일(무시 목록 제외) 모두. */
const sources = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'apps', 'libs'], {
  cwd: ROOT,
  encoding: 'utf8',
})
  .split('\n')
  .filter((file) => INCLUDED.test(file) && !EXCLUDED.test(file));

const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

const counts = new Map<string, number>();
for (const file of sources) {
  const count = countRoleLiterals(read(file), file);
  if (count > 0) counts.set(file, count);
}

describe('역할 이름 판정', () => {
  it('검사가 실제로 무언가를 찾는다 — 빈 결과는 검사가 깨졌다는 뜻이다', () => {
    expect(sources.length).toBeGreaterThan(1000);
    expect(counts.get('libs/authorization/src/guards/scope.guard.ts')).toBeGreaterThan(0);
  });

  it('역할 이름 문자열이 기준 목록 밖에서 생기거나 기준보다 늘지 않는다', () => {
    const grown = [...counts]
      .filter(([file, count]) => count > (ROLE_LITERAL_BASELINE[file]?.count ?? 0))
      .map(([file, count]) => `${file}: ${count} (기준 ${ROLE_LITERAL_BASELINE[file]?.count ?? 0})`);
    expect(grown).toEqual([]);
  });

  it('줄어든 파일은 기준도 같이 줄인다 — 래칫은 조이는 방향으로만 움직인다', () => {
    const stale = Object.entries(ROLE_LITERAL_BASELINE)
      .filter(([file, { count }]) => (counts.get(file) ?? 0) < count)
      .map(([file, { count }]) => `${file}: ${counts.get(file) ?? 0} (기준 ${count})`);
    expect(stale).toEqual([]);
  });

  it('판정 지점 이름은 리터럴이다(여러 줄 호출 포함)', () => {
    const offenders = sources.flatMap((file) => nonLiteralCheckpointCalls(read(file), file).map((line) => `${file}:${line}`));
    expect(offenders).toEqual([]);
  });
});
