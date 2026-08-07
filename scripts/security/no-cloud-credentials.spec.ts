import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * 소스에 하드코딩된 DB 접속문자열은 비밀번호까지 함께 커밋된다. 이 레포는 공개 이력이 있고
 * 히스토리 재작성 이후에도 `refs/pull` 과 포크가 원본을 붙들고 있어 회수되지 않는다
 * (`docs/git-history-rewrite-2026-08-07.md`). 그래서 "지운다" 가 아니라 "다시 안 생긴다" 로 건다.
 *
 * 2026-08-08 감사에서 3개 Neon 프로젝트의 크레덴셜이 5곳에 박혀 있었다
 * (`docs/superpowers/specs/2026-08-08-p1-idor-audit-design.md` §8).
 *
 * ⚠️ **왜 pathspec 이 `*.ts` 하나가 아니라 이렇게 넓은가**: 위 3개짜리 감사는 정확히 이
 * 테스트의 `.ts`-only 버전으로 초록불이었다. 그런데 그 초록불이 나던 바로 그 순간
 * `envs/*.example` 10개 파일과 `apps/user-service/README.md` 에 **11개**의 다른 Neon
 * 프로젝트 크레덴셜이 그대로 커밋돼 있었다 — `.ts` 만 보는 스코프는 구조적으로 그걸 볼 수
 * 없었다. `.ts`-only 로 좁혀 쓰지 말 것. 파일 확장자가 아니라 "커밋될 수 있는 텍스트인가"가
 * 기준이다.
 *
 * localhost 계열은 개발 자리표시자라 허용한다. 그 외 호스트는 실재하는 크레덴셜로 본다.
 *
 * ⚠️ **2026-08-08 2차 감사 — 좌표 기반 ALLOWED 의 재발**: 처음 이 테스트는 `ALLOWED` 를
 * `"file:line": "이유"` 로 키를 잡고, 매치된 줄의 **내용은 조회 후 버렸다**. 그 결과
 * `envs/*.example` 10곳과 README 1곳(정확히 지금 자리표시자 `USER:PASSWORD@HOST` 가 앉은
 * 자리)이 좌표만으로 허용돼 있었다 — 그 좌표엔 한때 진짜 Neon 크레덴셜이 있었다. 즉
 * 개발자가 그 줄에 진짜 값을 다시 채워넣어도 좌표가 같으니 테스트는 계속 초록불이었다.
 * 이 파일이 막으려던 사고가 허용 목록 안에서 그대로 재발한 것이다. 그래서 판정 기준을
 * **내용(자리표시자 모양인가)** 으로 옮겼다 — 아래 `isPlaceholderCredentialContent`.
 * `ALLOWED` 좌표 맵은 내용으로 못 덮는 진짜 예외만 남기는 **축소된** 폴백이고, 지금은
 * 그런 예외가 하나도 없어 비어 있다. 새 항목을 추가할 땐 반드시 이유를 적고, 그 좌표가
 * 자리표시자 모양이 아닌 진짜 이유(예: 정규식이 못 잡는 형식)가 있는지부터 의심할 것 —
 * 좌표 예외는 내용 검사를 우회하는 구멍이라는 걸 항상 기억한다.
 */
const REPO = join(__dirname, '..', '..');

/**
 * `git grep -E` 는 POSIX ERE 다. 브래킷 안에서 `\s` 는 공백 클래스가 **아니라** 백슬래시와
 * 문자 `s` 로 해석된다 — `[^'"\s@]` 로 쓰면 비밀번호에 `s` 가 들어간 크레덴셜을 놓치고,
 * 테스트는 초록불을 내면서 크레덴셜을 통과시킨다 (2026-08-08 에 실제로 이 형태로 3/5 만 잡혔다).
 * 공백은 반드시 `[:space:]` 로 쓴다.
 */
const PATTERN = String.raw`(postgres|postgresql|mysql|mongodb|redis)://[A-Za-z0-9_.-]+:[^'"[:space:]@]+@`;

const LOCAL_HOST = /@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/i;

/**
 * `PATTERN` 은 git grep(POSIX ERE) 전용이라 `[:space:]` 를 쓴다. JS `RegExp` 는 그 클래스를
 * 모르니 `\s` 로 옮겨 쓰고, user/password 를 캡처하도록 그룹을 추가한 것이 이 정규식이다.
 * 구조(스킴 목록·문자 클래스)는 `PATTERN` 과 반드시 같아야 한다 — `PATTERN` 을 고치면 이것도
 * 같이 고칠 것.
 */
const CRED_SEGMENT = /(?:postgres|postgresql|mysql|mongodb|redis):\/\/([A-Za-z0-9_.-]+):([^'"\s@]+)@/;

/**
 * user 또는 password 자리에 그대로 들어있으면 "채워 넣으라는 자리표시자" 로 보는 정확한
 * 리터럴. 대소문자를 그대로 비교한다 — 느슨하게 소문자로 내려서 비교하면 `Postgres` 같은
 * 변형까지 허용 범위가 넓어지므로 지금 레포에 실제로 쓰인 형태만 정확히 나열한다.
 */
const PLACEHOLDER_LITERALS = new Set(['postgres', 'user', 'u', 'password', 'p']);

/**
 * `USER`, `PASSWORD`, `PW` 처럼 사람이 "여기 채워라" 라고 표시하는 전형적인 ALL-CAPS 토큰.
 * 진짜 Neon 비밀번호(`npg_` 접두사 + 대소문자가 섞인 12~14자 나머지, 예: `npg_***`)는
 * 소문자로 시작하고 대소문자가 섞여 있어 이 정규식에 걸리지 않는다 — 이 클래스를 느슨하게
 * 만들 때(예: 소문자 허용, 언더스코어 이외 특수문자 허용) 그 보장이 깨진다.
 */
const CAPS_TOKEN = /^[A-Z][A-Z0-9_]*$/;

/** `<pw>`, `<live-host>` 처럼 각괄호로 감싼 자리표시자. 중첩 각괄호는 없다고 가정한다. */
const ANGLE_TOKEN = /^<[^<>]*>$/;

const isPlaceholderSegment = (segment: string): boolean =>
  PLACEHOLDER_LITERALS.has(segment) || CAPS_TOKEN.test(segment) || ANGLE_TOKEN.test(segment);

/**
 * 매치된 줄의 **내용**에서 `scheme://user:password@` 부분을 뽑아, user 와 password 가
 * 둘 다 자리표시자 모양인지 판정한다. 둘 중 하나라도 자리표시자 모양이 아니면(즉 실제 값일
 * 가능성이 있으면) 자리표시자로 보지 않는다 — 이게 이 함수가 fail-closed 인 이유다.
 *
 * `CRED_SEGMENT` 가 아예 매치하지 않는 경우(방어적으로만 가능 — git grep 이 이미 `PATTERN`
 * 으로 매치를 찾아온 상태라 보통 일어나지 않는다)는 "자리표시자 아님" 으로 취급한다:
 * 판정을 못 하면 안전한 쪽(거부)으로 기운다.
 */
export const isPlaceholderCredentialContent = (content: string): boolean => {
  const match = CRED_SEGMENT.exec(content);
  if (!match) return false;
  const [, user, password] = match;
  return isPlaceholderSegment(user) && isPlaceholderSegment(password);
};

/**
 * git grep 출력은 `file:lineNo:content` 형식이고, content 자체에도 콜론이 얼마든지 나온다
 * (접속문자열의 `://` 가 그 예다). 파일 경로와 줄번호에는 콜론이 없다고 보고 앞의 콜론 두
 * 개까지만 구분자로 쓴다 — `line.split(':')` 로 전체를 자르면 content 안의 콜론에서 배열이
 * 계속 쪼개져 뒷부분을 잃는다.
 */
const splitGrepLine = (rawLine: string): { location: string; content: string } => {
  const firstColon = rawLine.indexOf(':');
  const secondColon = rawLine.indexOf(':', firstColon + 1);
  return {
    location: rawLine.slice(0, secondColon),
    content: rawLine.slice(secondColon + 1),
  };
};

/**
 * 내용 기반 검사로 못 덮는 **진짜** 예외만 남기는 폴백. `"<파일>:<줄>": '이유'` 형태이고,
 * 이유는 "왜 자리표시자 모양이 아닌데도 안전한가" 를 설명해야 한다 — 그 설명 자체가 리뷰
 * 대상이다. 지금은 비어 있다: 이전에 여기 있던 20개 항목은 전부 `isPlaceholderCredentialContent`
 * 로 커버되어 제거됐다. 좌표 예외는 내용을 안 보고 통과시키는 구멍이므로, 새 항목을 추가하기
 * 전에 먼저 위 세 상수(`PLACEHOLDER_LITERALS`/`CAPS_TOKEN`/`ANGLE_TOKEN`)로 덮을 수 없는지
 * 확인할 것.
 */
const ALLOWED: Record<string, string> = {};

/**
 * 매치 한 줄이 "진짜 문제(finding)" 인지 판정한다. 순서가 중요하다: localhost 는 개발
 * 자리표시자라 먼저 걸러내고, 그 다음 **내용**이 자리표시자 모양인지 본다 — 좌표(`ALLOWED`)
 * 조회는 내용으로 자리표시자임을 확인할 수 없을 때만 최후 수단으로 쓴다. 이 순서를 바꿔
 * `ALLOWED` 를 먼저 보면, 자리표시자였던 좌표에 진짜 값이 들어와도 좌표만 보고 통과시키는
 * 옛 버그가 되돌아온다.
 */
const isOffendingMatch = (rawLine: string): boolean => {
  if (LOCAL_HOST.test(rawLine)) return false;
  const { location, content } = splitGrepLine(rawLine);
  if (isPlaceholderCredentialContent(content)) return false;
  return !(location in ALLOWED);
};

const scan = (): string[] => {
  let out = '';
  try {
    out = execFileSync(
      'git',
      ['grep', '-InE', PATTERN, '--', '*.ts', '*.js', '*.json', '*.yml', '*.yaml', '*.md', '*.example', '*.env*'],
      {
        cwd: REPO,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      },
    );
  } catch (err) {
    // git grep 은 매치가 없으면 exit 1 이다. 그건 성공이다.
    if ((err as { status?: number }).status === 1) return [];
    throw err;
  }
  return out.split('\n').filter(Boolean);
};

describe('소스에 클라우드 DB 크레덴셜이 없다', () => {
  it('비-localhost 접속문자열이 0건이다', () => {
    // 실패 시에도 매치된 줄의 내용(크레덴셜 자체)을 출력하지 않는다 — location 만 남긴다.
    const offenders = scan()
      .filter(isOffendingMatch)
      .map((rawLine) => splitGrepLine(rawLine).location);

    expect(offenders).toEqual([]);
  });

  /**
   * 이 테스트가 증명하려는 사고: 좌표 기반 `ALLOWED` 는 `envs/*.example` 10곳과 README
   * 1곳에서 실제로 일어났다 — 그 좌표들엔 한때 진짜 Neon 크레덴셜이 있었고, 좌표만 보는
   * 허용 목록은 그 자리에 값이 다시 채워져도 계속 초록불을 냈을 것이다. 지금은 `ALLOWED`
   * 가 비어 있어 이 시나리오를 그대로 재현할 수 없으므로, 과거에 그 문제가 있었던 정확한
   * 좌표(`envs/.env.analytics.example:1`) 에 진짜 크레덴셜처럼 생긴 값(`npg_` 접두사 +
   * 대소문자 섞인 문자열 — 실제로 유출됐던 적 없는, 이 테스트만을 위해 지어낸 값)을 얹은
   * 줄을 합성해 판정 함수에 직접 넣는다. 트래킹된 파일은 건드리지 않는다.
   */
  it('자리표시자였던 좌표라도 내용이 진짜 크레덴셜처럼 보이면 거부한다 (fail-closed)', () => {
    const formerlyAllowedCoordinate = 'envs/.env.analytics.example:1';

    // 이 파일도 `*.ts` 로서 매 실행마다 git grep 스캔 대상이다 — 가짜 접속문자열을 한 줄에
    // 통짜로 써 두면 이 파일 자신이 offender 로 잡혀 위쪽 "0건이다" 테스트를 깨뜨린다.
    // 그래서 스킴/비밀번호를 여러 조각으로 나눠 조립한다 — 트래킹된 소스 어떤 한 줄에도
    // `scheme://user:password@` 가 통째로 나타나지 않게 하려는 것뿐, 값 자체를 숨기려는
    // 게 아니다(어차피 실제로 유출된 적 없는 지어낸 값이다).
    const fakeScheme = 'postgres' + 'ql';
    const fakeUser = 'neondb_owner';
    const fakePassword = ['npg_', 'FakeTestOnly9Zq'].join('');
    const fakeHost = 'ep-synthetic-test-01.ap-northeast-2.aws.neon.tech';
    const fakeConnectionString =
      `${fakeScheme}` + `://${fakeUser}:${fakePassword}` + `@${fakeHost}/neondb?sslmode=require`;
    const realLookingLine = `${formerlyAllowedCoordinate}:DATABASE_URL=${fakeConnectionString}`;

    expect(formerlyAllowedCoordinate in ALLOWED).toBe(false);
    expect(isOffendingMatch(realLookingLine)).toBe(true);
  });

  /**
   * 위 fail-closed 테스트의 대조군: 지금 그 좌표에 실제로 있는 자리표시자 내용
   * (`USER:PASSWORD@HOST`) 은 여전히 허용되어야 한다 — 아니면 진짜 초록불을 내야 할 템플릿
   * 파일까지 막아버리는 반대 방향 회귀다.
   */
  it('현재 자리표시자 내용(USER:PASSWORD@HOST)은 여전히 허용된다', () => {
    const placeholderLine =
      'envs/.env.analytics.example:1:DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require';

    expect(isOffendingMatch(placeholderLine)).toBe(false);
  });
});
