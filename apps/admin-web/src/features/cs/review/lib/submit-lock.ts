/**
 * 한 번만 제출하게 하는 동기 잠금.
 *
 * React state(`submitted`, mutation `isPending`)는 다음 렌더에야 바뀐다. 더블클릭처럼 두 클릭이
 * 같은 렌더의 핸들러를 부르면 둘 다 옛 값(false)을 보고 통과해 요청이 두 번 나간다 —
 * 실제로 리뷰가 두 건 생겼다. 이 잠금은 렌더와 무관하게 즉시 닫힌다.
 */
export function createSubmitLock() {
  let locked = false;
  return {
    /** 잡았으면 true. 이미 잡혀 있으면 false — 호출부는 그대로 돌아간다 */
    tryAcquire(): boolean {
      if (locked) return false;
      locked = true;
      return true;
    },
    /** 실패해서 다시 시도할 수 있게 푼다. 성공 뒤에는 풀지 않는다(화면을 떠나므로) */
    release(): void {
      locked = false;
    },
  };
}
