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
  'docs/superpowers/plans/2026-07-23-local-core-dev-environment.md:114':
    '위 guard.spec.ts:16 과 동일한 반대 방향 픽스처를 인용하는 설계 문서. 자격증명은 u:p 자리표시자다.',
  'apps/medusa/docker-compose.yml:54':
    'medusa 로컬 docker-compose 스택. 호스트 "postgres" 는 같은 compose 네트워크 안의 서비스명이지 실재 원격 호스트가 아니고, 자격증명은 postgres:postgres 기본값이다.',
  'apps/file-service/docs/deployment-guide.md:57':
    '배포 가이드의 예시 접속문자열. user/password/prod-host 모두 자리표시자다.',
  'apps/outbox-demo/.env.example:2': '예시 env 파일. user/password/host 모두 자리표시자다.',
  'apps/search/.env.example:28': '예시 env 파일. user/password/host 모두 자리표시자다.',
  'docs/local-dev.md:117':
    '로컬 개발 문서의 예시. postgres:postgres 는 compose 기본값이고 호스트는 <노트북 IP> 자리표시자다.',
  'docs/runbooks/selmate-stock-pipeline.md:487':
    '런북 예시 명령어. <pw>/<live-host> 는 자리표시자이지 실재 값이 아니다.',
  'scripts/seed-data/README.md:201':
    '트러블슈팅 안내문의 형식 예시. user/password/host/port/database 모두 자리표시자다.',
  // envs/*.example 은 실제 개발자가 복사해 쓰는 템플릿이라 파일 자체나 키를 지우지 않는다.
  // 2026-08-08 에 각 파일의 실제 Neon 접속문자열을 자리표시자로 교체했다 — 이 자리표시자도
  // 정규식 형태상 매치되므로(HOST 가 localhost 가 아님) 명시적으로 허용해둔다.
  'envs/.env.analytics.example:1': 'envs 템플릿 자리표시자 (USER:PASSWORD@HOST) — 실제 값 아님.',
  'envs/.env.channel-adapter.example:1': 'envs 템플릿 자리표시자 (USER:PASSWORD@HOST) — 실제 값 아님.',
  'envs/.env.file-service.example:3': 'envs 템플릿 자리표시자 (USER:PASSWORD@HOST) — 실제 값 아님.',
  'envs/.env.medusa.example:11': 'envs 템플릿 자리표시자 (USER:PASSWORD@HOST) — 실제 값 아님.',
  'envs/.env.membership.example:1': 'envs 템플릿 자리표시자 (USER:PASSWORD@HOST) — 실제 값 아님.',
  'envs/.env.pim.example:3': 'envs 템플릿 자리표시자 (USER:PASSWORD@HOST) — 실제 값 아님.',
  'envs/.env.ugc-service.example:5': 'envs 템플릿 자리표시자 (USER:PASSWORD@HOST) — 실제 값 아님.',
  'envs/.env.user-service.example:6': 'envs 템플릿 자리표시자 (USER:PASSWORD@HOST) — 실제 값 아님.',
  'envs/.env.wallet.example:1': 'envs 템플릿 자리표시자 (USER:PASSWORD@HOST) — 실제 값 아님.',
  'envs/.env.wms.example:3': 'envs 템플릿 자리표시자 (USER:PASSWORD@HOST) — 실제 값 아님.',
  'apps/user-service/README.md:62': 'README 의 예시 env 스니펫. 2026-08-08 에 실제 접속문자열을 자리표시자로 교체했다.',
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
