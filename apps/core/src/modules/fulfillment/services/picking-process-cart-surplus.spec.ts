import { PickingProcessService } from './picking-process.service';
import type {
  AggregateCartSurplusReturnInput,
  AggregateCartSurplusReturnResult,
} from '../picking/picking-strategy.interface';

type Exposed = { withAggregateThenSortStrategy: (...args: unknown[]) => Promise<AggregateCartSurplusReturnResult> };

describe('PickingProcessService.aggregateCartSurplusReturn', () => {
  it('draft 로 나간 박스의 대기 오퍼레이션 재개는 전략 트랜잭션이 끝난 뒤에 부른다', async () => {
    const order: string[] = [];
    const exited = [{ workItemId: 'w1', shipmentId: 's1', exitTo: 'draft', waitingOperationId: 'op1' }];
    const result = { exited } as AggregateCartSurplusReturnResult;
    const returns = {
      resumeAfterDraftExit: jest.fn(async () => {
        order.push('resume');
      }),
    };
    const service = new PickingProcessService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      returns as never,
    );
    jest.spyOn(service as unknown as Exposed, 'withAggregateThenSortStrategy').mockImplementation(async () => {
      order.push('strategy-start');
      await Promise.resolve();
      order.push('strategy-committed');
      return result;
    });

    await expect(service.aggregateCartSurplusReturn({} as AggregateCartSurplusReturnInput)).resolves.toBe(result);

    expect(order).toEqual(['strategy-start', 'strategy-committed', 'resume']);
    expect(returns.resumeAfterDraftExit).toHaveBeenCalledWith(exited, undefined);
  });
});
