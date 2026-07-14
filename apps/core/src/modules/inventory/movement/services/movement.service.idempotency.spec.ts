import { MovementService } from './movement.service';

const SENTINEL = { sentinel: true };

function build() {
  const withIdempotency = jest.fn().mockResolvedValue(SENTINEL);
  // MovementService 생성자 시그니처는 파일 :12 확인 — idempotency 를 마지막 파라미터로 추가한 상태 기준
  const svc = new MovementService({} as never, {} as never, { withIdempotency } as never);
  return { svc, withIdempotency };
}

describe('MovementService 멱등 래퍼 배선', () => {
  it('moveImmediately → withIdempotency(movement.move, …) — 단, 사전 검증은 래퍼 밖', async () => {
    const { svc, withIdempotency } = build();
    const dto = { warehouseId: 'w', lines: [], idempotencyKey: 'k' };
    const result = await svc.moveImmediately(dto as never);
    expect(withIdempotency).toHaveBeenCalledWith('movement.move', 'k', dto, expect.any(Function));
    expect(result).toBe(SENTINEL);
  });
});
