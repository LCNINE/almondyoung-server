import {
  initialFormExportRequestGuard,
  isCurrentFormExportRequest,
  nextFormExportRequestId,
  type FormExportRequestGuardState,
} from './request-guard';

describe('form-export 요청 가드 — 겹치는 요청 레이스', () => {
  it('두 번째 요청이 나간 뒤 도착한 첫 번째(stale) 응답은 무시한다', () => {
    let guard: FormExportRequestGuardState = initialFormExportRequestGuard;

    // 모달이 열려 첫 요청을 쏜다
    const first = nextFormExportRequestId(guard);
    guard = first.guard;

    // 닫혔다 다시 열려(또는 재시도로) 첫 요청이 끝나기 전에 두 번째 요청을 쏜다
    const second = nextFormExportRequestId(guard);
    guard = second.guard;

    // 응답이 도착 순서를 보장하지 않는다 — 늦게 도착한 첫 응답부터 판정
    expect(isCurrentFormExportRequest(guard, first.requestId)).toBe(false);
    // 두 번째 응답은 여전히 최신이므로 반영돼야 한다
    expect(isCurrentFormExportRequest(guard, second.requestId)).toBe(true);
  });

  it('세 번째 요청까지 겹쳐도 가장 최신 것만 유효하다', () => {
    let guard: FormExportRequestGuardState = initialFormExportRequestGuard;
    const first = nextFormExportRequestId(guard);
    guard = first.guard;
    const second = nextFormExportRequestId(guard);
    guard = second.guard;
    const third = nextFormExportRequestId(guard);
    guard = third.guard;

    expect(isCurrentFormExportRequest(guard, first.requestId)).toBe(false);
    expect(isCurrentFormExportRequest(guard, second.requestId)).toBe(false);
    expect(isCurrentFormExportRequest(guard, third.requestId)).toBe(true);
  });

  it('모달을 닫으면(무효화) 그 시점까지 나간 요청의 응답은 더 이상 유효하지 않다', () => {
    let guard: FormExportRequestGuardState = initialFormExportRequestGuard;
    const started = nextFormExportRequestId(guard);
    guard = started.guard;

    // 응답이 오기 전에 모달이 닫힌다 — 닫힘도 nextFormExportRequestId 로 무효화한다
    const closed = nextFormExportRequestId(guard);
    guard = closed.guard;

    expect(isCurrentFormExportRequest(guard, started.requestId)).toBe(false);
  });

  it('처음 발급된 requestId 는 아직 아무 일도 없었으면 유효하다', () => {
    const guard = initialFormExportRequestGuard;
    const { requestId, guard: next } = nextFormExportRequestId(guard);
    expect(isCurrentFormExportRequest(next, requestId)).toBe(true);
  });
});
