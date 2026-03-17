import { ExecArgs } from "@medusajs/framework/types";
import { completeCartWorkflow } from "@medusajs/medusa/core-flows";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

export default async function recoverCartComplete({ container, args }: ExecArgs) {
  const cartId = args[0];

  if (!cartId) {
    throw new Error("Usage: medusa exec ./src/scripts/recover-cart-complete.ts <cart_id>");
  }

  const { errors, result } = await completeCartWorkflow(container).run({
    input: { id: cartId },
    context: { transactionId: `recover:${cartId}` },
    throwOnError: false,
  });

  if (errors?.length) {
    const details = errors.map((e) => ({
      action: e.action,
      handlerType: e.handlerType,
      message: e.error?.message,
      type: (e.error as any)?.type,
      name: e.error?.name,
    }));
    console.log(JSON.stringify({ ok: false, cartId, errors: details }, null, 2));
    return;
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "status",
      "email",
      "created_at",
      "customer_id",
      "payment_collections.id",
      "payment_collections.payments.id",
      "payment_collections.payments.captures.id",
    ],
    filters: { id: result.id },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        cartId,
        order: orders?.[0] ?? null,
      },
      null,
      2,
    ),
  );
}
