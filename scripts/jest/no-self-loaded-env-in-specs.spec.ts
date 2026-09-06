import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * 스펙 파일은 자기 `.env` 를 스스로 읽으면 안 된다 (#793).
 *
 * 이 레포의 통합 스펙은 `const DATABASE_URL = process.env.DATABASE_URL` 로 **바깥 환경**을
 * 읽고, 없으면 `describeIfDb` 로 스스로 건너뛴다. 그래서 맨 `npx jest` 는 초록이고, 실제
 * 실행은 `REQUIRE_*_DB=1 dotenv -e apps/<svc>/.env -- jest --runInBand …` 같은 전용
 * 명령이 담당한다 (CLAUDE.md 「검증 게이트」).
 *
 * 스펙 안에서 `dotenv.config()` 를 부르면 그 규약이 뒤집힌다 — **파일이 스스로 게이트에
 * 들어온다.** 그 결과가 #793 이었다: `apps/membership/.env` 를 가진 사람(= 로컬 개발
 * 세팅을 한 사람 전원)에게만 통합 스펙 2개가 켜지고, 둘이 같은 물리 DB 의 `tiers` 를 두고
 * 병렬 워커에서 경쟁해 `npx jest` 가 **항상** 21건 빨갰다. CI 는 `.env` 가 없어 조용했으니
 * 게이트가 이걸 못 잡았고, 개발자는 「원래 빨간 것들」로 학습했다.
 *
 * ⚠️ 이 성질은 **아무 테스트도 실패하지 않는 방식으로** 깨진다 — 새로 넣은 `dotenv.config()`
 * 는 그 자체로는 초록이고, 부작용은 「남의 스펙이 가끔 빨개진다」로만 나타난다. 그래서
 * 감시자가 따로 필요하다 (`scripts/jest/tz-is-utc.spec.ts` 와 같은 이유).
 *
 * 정말 예외가 필요하면 여기에 이유와 함께 허용 항목을 만들 것. 지금은 없다 —
 * 「.env 가 필요한 스펙」의 정답은 예외가 아니라 **전용 npm 스크립트**다.
 */
const REPO = join(__dirname, '..', '..');

/**
 * `dotenv.config(` 호출과 부작용 import (`import 'dotenv/config'`) 를 함께 잡는다.
 * 맨 `dotenv` 문자열로 잡으면 **주석에 dotenv 를 언급한 스펙**까지 걸린다 — 실제로
 * `bulk-session-draft.integration.spec.ts` 의 주석이 실행 방법으로 `dotenv -e` 를 안내한다.
 * 그 안내는 옳은 형태(바깥에서 주입)이므로 걸리면 안 된다.
 */
const PATTERN = String.raw`(dotenv\.config\(|['"]dotenv/config['"])`;

/**
 * 이 파일 자신은 스캔에서 뺀다 — 아래 정밀도 테스트가 금지 패턴을 **문자열로** 들고 있어서
 * 빼지 않으면 가드가 스스로에게 걸린다. 구멍은 이 한 파일뿐이고, 그 이유가 여기 적혀 있다.
 */
const SELF = ':(exclude)scripts/jest/no-self-loaded-env-in-specs.spec.ts';

/** `git grep` 은 매치가 없으면 exit code 1 로 끝난다 — 그건 "위반 0" 이지 오류가 아니다. */
function grepSpecs(pattern: string): string[] {
  try {
    const out = execFileSync('git', ['grep', '-nE', pattern, '--', '*.spec.ts', SELF], {
      cwd: REPO,
      encoding: 'utf8',
    });
    return out.split('\n').filter(Boolean);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 1) return [];
    throw error;
  }
}

describe('스펙은 자기 .env 를 스스로 읽지 않는다 (#793)', () => {
  it('`dotenv.config()` 를 부르는 스펙 파일이 없다', () => {
    const hits = grepSpecs(PATTERN);

    expect(hits).toEqual([]);
  });

  it('정규식이 주석 속 `dotenv -e` 안내는 잡지 않는다 (이 가드가 지키려는 정밀도)', () => {
    const comment = ' * 고정하지 않고 `dotenv -e apps/core/.env` 를 태우는데, 메인 체크아웃의 그 파일은';

    expect(new RegExp(PATTERN).test(comment)).toBe(false);
    expect(new RegExp(PATTERN).test("dotenv.config({ path: '../../.env' });")).toBe(true);
    expect(new RegExp(PATTERN).test("import 'dotenv/config';")).toBe(true);
  });
});
