import { and, eq, inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import type { CustomerReturn, CustomerReturnStatus } from './customer-return.types';

/**
 * 반품 예정 기록의 상태 전이 — 이 파일이 `customer_returns.status` 를 쓰는 유일한 곳이다.
 * `from` 에 든 상태일 때만 바꾼다(조건부 UPDATE). 아무 행도 못 바꿨으면 false —
 * 호출자가 «이미 끝난 일»인지 «어긋난 일»인지 판정한다.
 */
export async function transitionCustomerReturn(
  trx: DbTx,
  p: {
    id: string;
    from: readonly CustomerReturnStatus[];
    to: CustomerReturnStatus;
    set?: Partial<Pick<CustomerReturn, 'cancelledAt'>>;
  },
): Promise<boolean> {
  const updated = await trx
    .update(wmsTables.customerReturns)
    .set({ ...p.set, status: p.to, updatedAt: new Date() })
    .where(and(eq(wmsTables.customerReturns.id, p.id), inArray(wmsTables.customerReturns.status, [...p.from])))
    .returning({ id: wmsTables.customerReturns.id });
  return updated.length > 0;
}
