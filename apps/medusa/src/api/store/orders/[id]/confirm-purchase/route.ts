import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, MedusaError, Modules } from '@medusajs/framework/utils';
import { confirmPurchaseWorkflow } from '../../../../../workflows/orders/workflows/confirm-purchase-workflow';

const MEMBERSHIP_SERVICE_URL = process.env.MEMBERSHIP_SERVICE_URL || 'http://localhost:3040';

const WELCOME_MEMBERSHIP_TAG = 'welcome-membership';

async function markWelcomeMembershipPurchased(
  customerId: string,
  orderId: string,
  productIds: string[],
  container: any,
) {
  try {
    const productModule = container.resolve(Modules.PRODUCT);
    const products = await productModule.listProducts({ id: productIds }, { relations: ['tags'] });
    const hasWelcomeMembership = products.some((p: any) =>
      (p.tags ?? []).some((tag: any) => tag.value === WELCOME_MEMBERSHIP_TAG),
    );
    if (!hasWelcomeMembership) return;

    // Medusa customer_id → almond user_id 변환
    const customerModule = container.resolve(Modules.CUSTOMER);
    const customer = await customerModule.retrieveCustomer(customerId, {
      select: ['metadata'],
    });
    const userId = (customer?.metadata as Record<string, unknown> | null)?.almond_user_id as string | undefined;

    if (!userId) {
      console.warn('[WelcomeMembership] markPurchased: customer has no almond_user_id, skipping');
      return;
    }

    await fetch(`${MEMBERSHIP_SERVICE_URL}/welcome-membership/eligibility/${userId}/purchased`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    // 구매 기록 실패는 주문 자체를 실패시키지 않음 (로그만)
    console.error('[WelcomeMembership] markPurchased failed:', err);
  }
}

type OrderWithPayments = {
  id: string;
  customer_id?: string | null;
  metadata?: Record<string, unknown> | null;
  items?: Array<{
    id: string;
    product_id: string;
  }>;
  payment_collections?: Array<{
    payments?: Array<{
      id: string;
      captures?: Array<{ id: string }>;
    }>;
  }>;
};

const getOrderPaymentRows = (order: OrderWithPayments) =>
  (order.payment_collections?.flatMap((collection) => collection.payments ?? []) ?? []).filter(
    (payment): payment is { id: string; captures?: Array<{ id: string }> } => !!payment?.id,
  );

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const orderId = req.params.id;
  const customerId = req.auth_context?.actor_id;

  if (!customerId) {
    return res.status(401).json({
      message: 'Customer authentication required',
    });
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data } = await query.graph({
    entity: 'order',
    fields: [
      'id',
      'customer_id',
      'metadata',
      'items.id',
      'items.product_id',
      'payment_collections.id',
      'payment_collections.payments.id',
      'payment_collections.payments.captures.id',
    ],
    filters: { id: orderId },
  });

  const order = data?.[0] as OrderWithPayments | undefined;

  if (!order) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${orderId} was not found`);
  }

  if (order.customer_id !== customerId) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, 'You are not allowed to confirm purchase for this order');
  }

  const payments = getOrderPaymentRows(order);

  if (!payments.length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'No capturable payment found for this order');
  }

  const uncapturedPaymentIds = payments
    .filter((payment) => !((payment.captures?.length ?? 0) > 0))
    .map((payment) => payment.id);

  // 무통장입금 '입금확인중'(awaiting_deposit) 주문은 아직 미결제 상태(authorized)이므로
  // 고객의 구매확정(capture)을 서버에서 거절한다. UI 버튼 숨김만으로는 직접 API 호출을 막지 못한다.
  // 입금 확인(capture)은 관리자가 입금을 검증한 뒤에만 수행된다.
  // (capture 후 'confirmed' metadata 갱신이 실패해 awaiting_deposit 가 남아도, 이미 모두 capture된
  //  주문이면 uncaptured 가 없어 통과 — channel-adapter/주문내역의 'payment captured' 불변식과 동일.)
  const isAwaitingDeposit =
    (order.metadata as Record<string, unknown> | null)?.bank_transfer_status === 'awaiting_deposit';
  if (isAwaitingDeposit && uncapturedPaymentIds.length > 0) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      'This bank transfer order is awaiting deposit confirmation. Payment is captured by the administrator after the deposit is verified.',
    );
  }

  // 결제 캡처 + 리뷰 자격 생성을 워크플로우로 트랜잭션 처리
  await confirmPurchaseWorkflow(req.scope).run({
    input: {
      orderId,
      customerId,
      uncapturedPaymentIds,
      items: order.items ?? [],
    },
  });

  // 웰컴 멤버십 상품 구매 기록 (비동기, 주문 완료에 영향 없음)
  const productIds = (order.items ?? []).map((item) => item.product_id).filter(Boolean);
  if (productIds.length > 0) {
    void markWelcomeMembershipPurchased(customerId, orderId, productIds, req.scope);
  }

  const { data: refreshed } = await query.graph({
    entity: 'order',
    fields: [
      'id',
      'payment_collections.id',
      'payment_collections.payments.id',
      'payment_collections.payments.captures.id',
    ],
    filters: { id: orderId },
  });

  const updatedOrder = refreshed?.[0] as OrderWithPayments | undefined;
  const refreshedPayments = updatedOrder ? getOrderPaymentRows(updatedOrder) : [];
  const isCaptured =
    refreshedPayments.length > 0 && refreshedPayments.every((payment) => (payment.captures?.length ?? 0) > 0);

  return res.status(200).json({
    success: true,
    order: {
      id: updatedOrder?.id ?? orderId,
      payment_status: isCaptured ? 'captured' : 'authorized',
    },
  });
};
