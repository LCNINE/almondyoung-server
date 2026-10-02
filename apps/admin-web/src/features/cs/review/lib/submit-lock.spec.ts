import { createSubmitLock } from './submit-lock';

/**
 * 저장 버튼 더블클릭이 리뷰를 두 건 만들었다(로컬 스모크, 1ms 차). 두 클릭이 같은 렌더의
 * 핸들러를 부르면 `submitted`·`isPending` state 는 둘 다 아직 false 라 가드를 통과한다 —
 * 잠금은 렌더를 기다리지 않는 동기 값이어야 한다.
 */
describe('createSubmitLock', () => {
  it('첫 시도만 잡고, 풀기 전까지 두 번째 시도는 거절한다', () => {
    const lock = createSubmitLock();
    expect(lock.tryAcquire()).toBe(true);
    expect(lock.tryAcquire()).toBe(false);
  });

  it('실패로 풀면 다시 잡을 수 있다 (재시도)', () => {
    const lock = createSubmitLock();
    lock.tryAcquire();
    lock.release();
    expect(lock.tryAcquire()).toBe(true);
  });

  it('잠금은 인스턴스마다 따로다', () => {
    const a = createSubmitLock();
    const b = createSubmitLock();
    a.tryAcquire();
    expect(b.tryAcquire()).toBe(true);
  });
});
