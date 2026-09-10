import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * **시프트된 `Date` 는 `time.util.ts` 밖으로 나가지 않는다 (#744).**
 *
 * `date-fns-tz` 의 `toZonedTime` 은 「이 Date 를 로컬 시간으로 읽으면 서울 시계가 보이도록」
 * **epoch 을 옮긴** Date 를 돌려준다. 즉 결과는 더 이상 «순간»이 아니라 «표시용 벽시계»다.
 * 그걸 저장하거나 비교하면 조용히 틀린다:
 *
 * - **저장**: 드리즐이 `timestamptz` 에 `toISOString()` 으로 직렬화하므로 값이 한 번 더 밀린다.
 *   #744 가 이것이었다 — 라이브 `audit_logs` **3,850행 전부**가 정확히 +9h 로 쌓였다
 *   (2026-09-10 실측: `timestamp - created_at` 이 전 행 `09:00:00.008` ~ `09:00:12.072`).
 * - **비교**: DB 에서 온 진짜 순간과 견주면 기준이 9시간 어긋난다. #724 발견 ⑪ 이 이것이었다 —
 *   KST 15:00~24:00 의 당일 입고 취소가 라이브에서만 전부 400 이었다.
 *
 * ⚠️ **이 부류는 개발 머신에서 스스로 사라진다.** 어긋남의 크기가 `서울 오프셋 − 런타임 TZ
 * 오프셋` 이라, `Asia/Seoul` 머신에서는 0 이 되어 결함이 항등원이 된다. 그래서 스펙을 아무리
 * 써도 초록이었다. `scripts/jest/global-setup.js` 가 jest 를 UTC 로 박는 이유가 이것이고,
 * 이 가드는 그 위에 한 겹 더 — **애초에 시프트된 Date 가 만들어져 나가지 못하게** 한다.
 *
 * 서울 기준 «판정»이 필요하면 `isTodaySeoul(instant)` 를 쓴다. 그 함수는 기준 `now` 를 자기가
 * 만들어서 오용 자체가 불가능하다. 서울 기준 «표시 문자열»이 필요하면 `formatInTimeZone` 처럼
 * **문자열을 내주는** 함수를 쓴다 (`apps/analytics/src/shared/date.util.ts` 가 그 본이다) —
 * 문자열은 다시 `Date` 로 오해될 수 없다.
 *
 * 예외가 정말 필요하면 여기에 이유와 함께 허용 항목을 만들 것. 지금은 없다.
 */
const REPO = join(__dirname, '..', '..');

/**
 * 호출 모양(`이름(`)으로만 잡는다. 맨 이름으로 잡으면 **산문이 걸린다** — 실제로
 * `apps/analytics/src/shared/date.util.ts` 의 주석이 core 의 이 함수들을 이름으로 언급하면서
 * 「그래서 import 하지 않는다」를 설명한다. 그 주석은 옳은 판단을 적은 것이라 걸리면 안 된다.
 *
 * `utcToZonedTime` 은 `date-fns-tz` v2 시절 이름이다. 업그레이드가 되돌아가도 잡히게 남겨둔다.
 */
const PATTERN = String.raw`\b(toZonedTime|utcToZonedTime|nowSeoul|toSeoulTime)\s*\(`;

/** 시프트된 Date 의 유일한 합법적 거처. 여기서 `isTodaySeoul` 로 감싸여 밖으로는 boolean 만 나간다. */
const TIME_UTIL = ':(exclude)**/time.util.ts';

/**
 * 이 파일 자신은 스캔에서 뺀다 — 위 `PATTERN` 이 금지 이름들을 **문자열로** 들고 있어서
 * 빼지 않으면 가드가 스스로에게 걸린다. 구멍은 이 한 파일뿐이고, 그 이유가 여기 적혀 있다.
 */
const SELF = ':(exclude)scripts/jest/no-shifted-date-outside-time-util.spec.ts';

/**
 * 스펙은 뺀다. `time.util.spec.ts` 와 `inbound.service.same-day-cancel.integration.spec.ts` 는
 * **이 부류를 회귀 고정하는 스펙**이라 금지 형태를 일부러 들고 있다.
 */
const SPECS = ':(exclude)*.spec.ts';

/** `git grep` 은 매치가 없으면 exit code 1 로 끝난다 — 그건 "위반 0" 이지 오류가 아니다. */
function grepSources(pattern: string): string[] {
  try {
    const out = execFileSync('git', ['grep', '-nE', pattern, '--', '*.ts', SPECS, TIME_UTIL, SELF], {
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

describe('시프트된 Date 는 time.util.ts 밖으로 나가지 않는다 (#744)', () => {
  it('프로덕션 코드가 시프트된 Date 를 만들지 않는다', () => {
    const hits = grepSources(PATTERN);

    expect(hits).toEqual([]);
  });

  it('정규식이 산문 속 이름 언급은 잡지 않는다 (이 가드가 지키려는 정밀도)', () => {
    const prose = ' *     `isSameSeoulDay`/`nowSeoul` 뿐).';

    expect(new RegExp(PATTERN).test(prose)).toBe(false);
    expect(new RegExp(PATTERN).test('timestamp: nowSeoul(),')).toBe(true);
    expect(new RegExp(PATTERN).test('return toZonedTime(d, SEOUL_TZ);')).toBe(true);
  });
});
