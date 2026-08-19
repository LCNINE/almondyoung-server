import { getCheckoutRegion } from '@/lib/auth/session-cookies';

import { RetryFinalize } from './retry-finalize';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ intent?: string }>;
}

/**
 * 결제는 됐는데 주문 생성이 실패한 경우.
 *
 * "결제 실패" 페이지로 보내지 않는다. 지연승인 구조상 여기까지 왔으면 승인이 났거나(→주문이
 * 필요하다) 안 났거나(→돈이 안 빠졌다) 둘 중 하나인데, 어느 쪽이든 사용자에게 정확한 행동은
 * 재시도다. finalizeOrder 는 멱등이라 몇 번을 눌러도 주문이 겹치지 않는다.
 */
export default async function CheckoutFailedPage({ searchParams }: Props) {
  const { intent } = await searchParams;
  const region = (await getCheckoutRegion()) ?? 'kr';
  const orderListUrl = `${process.env.STOREFRONT_ORIGIN ?? ''}/${region}/mypage/order/list?justOrdered=1`;

  return (
    <main className="flex items-center justify-center min-h-screen px-4 bg-muted/40">
      <div className="w-full max-w-md p-6 space-y-5 border shadow-sm rounded-xl bg-card border-border/60">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold">결제는 완료되었지만 주문 생성이 지연되고 있어요</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            결제 금액이 이중으로 청구되지는 않아요. 아래 버튼으로 다시 시도하거나, 주문 내역에서 확인해 주세요.
          </p>
        </div>
        <RetryFinalize intentId={intent ?? ''} region={region} orderListUrl={orderListUrl} />
      </div>
    </main>
  );
}
