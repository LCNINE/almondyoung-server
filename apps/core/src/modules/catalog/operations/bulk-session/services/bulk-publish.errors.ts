/**
 * 발행 실패 예외를 관리자 화면에 그대로 실을 수 있는 한국어 문장으로 옮긴다.
 *
 * 부록 A.8 이 남긴 후속이다 — 지금까지는 예외 원문(영어 DB 오류 포함)이 500자로 잘려
 * 화면에 렌더됐다. 발행 실패의 종류는 유한하고(F5) 그 넷이 실제 사고의 대부분이다.
 *
 * **원문을 완전히 버리지 않는다** — 모르는 오류는 잘라낸 원문을 괄호로 붙인다. 버리면
 * 로그를 뒤지지 않고는 아무것도 못 하고, 통째로 실으면 지금과 같아진다.
 *
 * 한국어로 시작하는 메시지는 우리 도메인 예외이므로 그대로 통과시킨다.
 */
const MAX_LENGTH = 500;
const RAW_TAIL = 120;

/**
 * 우리 도메인 문구인지 판정한다. 한글로 시작하거나, 행 오류의 시트 접두(`[조합] …`) 뒤가
 * 한글이면 우리가 쓴 문장이다.
 *
 * **"한글이 어디든 있으면" 이 아니다** — 영어 DB 오류에 한국어 상품명이 값으로 섞여 들어오면
 * (`… Key (name)=(아몬드영 크림) already exists.`) 그것까지 원문 그대로 통과해, 이 함수가
 * 없애려던 증상이 그대로 재현된다.
 */
const DOMAIN_MESSAGE = /^(\[[^\]]*\]\s*)?[가-힣]/;

/**
 * `action` — 이 실패가 발행 실패인지, 정리(purge) 실패인지, draft 생성 실패인지. **폴백
 * 문구에만 영향을 준다**. 나머지 분기(품목코드·상품코드·길이·가격 초과, 우리 도메인 문구
 * 통과)는 세 경로 모두에서 그대로 맞는 문구라 `action` 과 무관하게 공유한다. 기본값 `'발행'`
 * 은 기존 발행 경로 호출부(F5)를 그대로 두기 위함이다 — Task 6 리뷰 발견 2: `purgeDrafts` 는
 * 삭제 실패에도 "발행에 실패했습니다"가 뜨는 오진을 냈다. `'생성'` 은 최종 리뷰 발견 ②
 * (§10.7 이 닫았다고 적은 `errorMessage` 분류가 실은 절반만 닫혀 있었다 — `draftOne` 의
 * catch(`bulk-session-job.manager.ts`)가 이 함수를 아예 부르지 않고 예외 원문을 그대로
 * `failItem` 에 넘겼다)를 닫기 위해 추가됐다.
 */
export function classifyPublishError(error: unknown, action: '발행' | '정리' | '생성' = '발행'): string {
  const isErrorInstance = error instanceof Error;
  const raw = isErrorInstance ? error.message : '알 수 없는 오류';

  const variantDup = /Duplicate variantCode in version [^:]+: (.+)/.exec(raw);
  if (variantDup) return `품목코드가 다른 상품과 중복됩니다: ${variantDup[1]}`.slice(0, MAX_LENGTH);

  const productDup = /productCode (.+) is already used by another active product/.exec(raw);
  if (productDup) return `상품코드를 이미 사용 중인 다른 상품이 있습니다: ${productDup[1]}`.slice(0, MAX_LENGTH);

  const tooLong = /value too long for type character varying\((\d+)\)/.exec(raw);
  if (tooLong) return `입력한 값이 저장할 수 있는 길이(${tooLong[1]}자)를 넘었습니다.`;

  if (raw.startsWith('Invalid calculated prices')) {
    return '계산된 판매가가 올바르지 않습니다. 가격 설정을 확인해 주세요.';
  }

  // 한글로 시작하는 메시지 (또는 [시트명] 접두 뒤가 한글)는 우리 도메인 예외다
  if (isErrorInstance && DOMAIN_MESSAGE.test(raw)) return raw.slice(0, MAX_LENGTH);

  return `${action}에 실패했습니다. (원인: ${raw.slice(0, RAW_TAIL)})`;
}
