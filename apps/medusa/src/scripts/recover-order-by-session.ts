import { ExecArgs } from '@medusajs/framework/types';
import { completeCartWorkflow } from '@medusajs/medusa/core-flows';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';

export default async function recoverOrderBySession({ container, args }: ExecArgs) {
  const sessionId = args[0];

  if (!sessionId) {
    throw new Error('Usage: medusa exec ./src/scripts/recover-order-by-session.ts <payment_session_id>');
  }

  const paymentModule = container.resolve(Modules.PAYMENT);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const sessions = await paymentModule.listPaymentSessions(
    { id: sessionId } as any,
    { select: ['id', 'payment_collection_id'] },
  );
  const session = sessions[0];

  if (!session) {
    throw new Error(`No payment session found for id=${sessionId}`);
  }

  const { data: collections } = await query.graph({
    entity: 'payment_collection',
    fields: ['id', 'cart.id', 'cart.completed_at'],
    filters: { id: session.payment_collection_id },
  });

  const cart = (collections[0] as any)?.cart as { id: string; completed_at: string | null } | undefined;

  if (!cart?.id) {
    throw new Error(`No cart found for payment_collection_id=${session.payment_collection_id}`);
  }

  const cartId = cart.id;

  if (cart.completed_at) {
    console.log(JSON.stringify({ status: 'already_completed', sessionId, cartId, completed_at: cart.completed_at }, null, 2));
    return;
  }

  // Check if order already exists via order_cart link
  const { data: orderCartLinks } = await query.graph({
    entity: 'order_cart',
    fields: ['cart_id', 'order_id'],
    filters: { cart_id: cartId },
  });

  if (orderCartLinks.length > 0) {
    console.log(JSON.stringify({ status: 'order_already_exists', sessionId, cartId, order_id: (orderCartLinks[0] as any)?.order_id }, null, 2));
    return;
  }

  console.log(`Running completeCartWorkflow for cart ${cartId} (session ${sessionId})...`);

  const { errors, result } = await completeCartWorkflow(container).run({
    input: { id: cartId },
    // Use unique transactionId to avoid replaying a previously failed/partial execution
    context: { transactionId: `manual-recover:${cartId}:${Date.now()}` },
    throwOnError: false,
  });

  if (errors?.length) {
    const details = errors.map((e) => ({
      action: e.action,
      handlerType: e.handlerType,
      message: e.error?.message,
      type: e.error?.type,
      name: e.error?.name,
    }));
    console.log(JSON.stringify({ ok: false, sessionId, cartId, errors: details }, null, 2));
    return;
  }

  const { data: orders } = await query.graph({
    entity: 'order',
    fields: ['id', 'status', 'email', 'created_at', 'customer_id'],
    filters: { id: result.id },
  });

  console.log(JSON.stringify({ ok: true, sessionId, cartId, order: orders?.[0] ?? null }, null, 2));
}
