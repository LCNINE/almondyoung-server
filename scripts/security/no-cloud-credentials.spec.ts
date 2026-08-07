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
 * localhost 계열은 개발 자리표시자라 허용한다. 그 외 호스트는 실재하는 크레덴셜로 본다.
 * 정당한 예외는 `ALLOWED` 에 **이유와 함께** 추가한다 — 그 추가 자체가 리뷰 대상이다.
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

/** `"<파일>:<줄>": '이유'` */
const ALLOWED: Record<string, string> = {
  'scripts/local/seed-dev-core/guard.spec.ts:16':
    '원격 호스트를 거부하는지 검증하는 반대 방향 픽스처. 자격증명은 postgres:postgres 기본값이다.',
};

const scan = (): string[] => {
  let out = '';
  try {
    out = execFileSync('git', ['grep', '-InE', PATTERN, '--', '*.ts'], {
      cwd: REPO,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err) {
    // git grep 은 매치가 없으면 exit 1 이다. 그건 성공이다.
    if ((err as { status?: number }).status === 1) return [];
    throw err;
  }
  return out.split('\n').filter(Boolean);
};

describe('소스에 클라우드 DB 크레덴셜이 없다', () => {
  it('비-localhost 접속문자열이 0건이다', () => {
    const offenders = scan()
      .filter((line) => !LOCAL_HOST.test(line))
      .map((line) => {
        const [file, lineNo] = line.split(':');
        return `${file}:${lineNo}`;
      })
      .filter((loc) => !(loc in ALLOWED));

    expect(offenders).toEqual([]);
  });
});
