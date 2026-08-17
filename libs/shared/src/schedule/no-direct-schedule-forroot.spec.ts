import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * `ScheduleModule.forRoot()` 는 저장소 전체에서 **딱 한 곳**(`schedule-root.ts`)만 부른다 (#599).
 *
 * Nest 11 은 동적 모듈을 **객체 참조**로 중복 제거하므로, 두 번째 호출은 두 번째 모듈 인스턴스를
 * 만들고 그 앱의 **모든 `@Cron` 이 두 번 등록**된다. 근거와 재현은 `schedule-root.spec.ts`.
 *
 * 이 결함은 **증상이 조용하다** — 크론이 두 번 돌아도 대개 로그가 두 줄일 뿐이고, 멱등한
 * 작업이면 결과도 같아 보인다. channel-adapter 에서는 취소/환불 이벤트가 실제로 중복 발행됐고
 * (라이브 8건), 그걸 알아채는 데 8일이 걸렸다. 그래서 리뷰가 아니라 테스트로 막는다.
 *
 * ⚠️ 이 테스트는 **저장소 전체를 grep** 한다. 새 앱에서 무심코 `ScheduleModule.forRoot()` 를
 * 부르면 그 앱의 diff 만 보는 리뷰로는 절대 안 걸리지만 여기서는 걸린다.
 */
const REPO = join(__dirname, '..', '..', '..', '..');

/** 이 한 파일만이 `forRoot()` 를 부를 자격이 있다. */
const CANONICAL = 'libs/shared/src/schedule/schedule-root.ts';

/**
 * 스펙은 제외한다. 스펙이 자기 `Test.createTestingModule` 안에서 `forRoot()` 를 한 번 부르는 것은
 * 격리된 앱을 세우는 정상 사용이고, 이 규칙이 막으려는 것은 **프로덕션 모듈 배선의 두 번째 호출**이다.
 * (`schedule-root.spec.ts` 는 근거를 고정하려고 일부러 두 번 부른다 — 그게 테스트의 내용이다.)
 */
const isSpec = (file: string) => file.endsWith('.spec.ts');

describe('ScheduleModule.forRoot() 직접 호출 금지 (#599)', () => {
  it('정본 파일과 근거 스펙 밖에서는 아무도 부르지 않는다', () => {
    let out = '';
    try {
      out = execFileSync('git', ['grep', '-InE', String.raw`ScheduleModule\.forRoot\(`, '--', '*.ts'], {
        cwd: REPO,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch (error) {
      // git grep 은 매치가 없으면 exit 1 이다. 그 경우만 빈 결과로 취급한다.
      const status = (error as { status?: number }).status;
      if (status !== 1) throw error;
      out = '';
    }

    const offenders = out
      .split('\n')
      .filter((line) => line.trim().length > 0)
      // `file:line:content` — content 안에도 콜론이 나오므로 앞 2개만 구분자로 쓴다.
      .map((line) => {
        const [file, lineNo, ...rest] = line.split(':');
        return { file, lineNo, content: rest.join(':').trim() };
      })
      .filter(({ file }) => file !== CANONICAL && !isSpec(file))
      // 주석에서 이름을 언급하는 것은 호출이 아니다.
      .filter(({ content }) => !content.startsWith('*') && !content.startsWith('//'));

    expect(offenders).toEqual([]);
  });
});
