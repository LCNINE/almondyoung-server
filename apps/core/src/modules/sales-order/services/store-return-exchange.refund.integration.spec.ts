// deferred (⏸ dev DB): intent-first attempt 커밋·FOR UPDATE 직렬화·partial unique 위반은
// 실 Postgres 필요 — DATABASE_URL 없는 CI/로컬에서는 auto-skip.
// 작업 14 attemptReturnRefund 상태기계(규율 1·2·3)의 통합 레벨 회귀를 채울 자리.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
describeIfDb('StoreReturnExchangeService refund state machine (integration)', () => {
  it.todo('크래시 후 재시도: 같은 key 재생 → completed');
  it.todo('확정 실패 → 다음 재시도 N+1 새 key');
  it.todo('동시 재시도 FOR UPDATE 직렬화 → 이중 attempt 없음');
  it.todo('partial unique(returnRequestId) where status=pending 위반 시 재사용 경로로 수렴');
});
