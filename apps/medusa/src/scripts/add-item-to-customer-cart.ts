import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import {
  addToCartWorkflow,
  createCartWorkflow,
} from "@medusajs/medusa/core-flows";

type InputArgs = {
  customerId: string;
  variantId: string;
  quantity: number;
  regionId: string;
  salesChannelId?: string;
  email?: string;
};

function parseArgs(args: string[]): InputArgs {
  const [customerId, variantId, quantityRaw, regionId, salesChannelId, email] =
    args;

  if (!customerId || !variantId || !quantityRaw || !regionId) {
    throw new Error(
      "Usage: medusa exec ./src/scripts/add-item-to-customer-cart.ts <customer_id> <variant_id> <quantity> <region_id> [sales_channel_id] [email]",
    );
  }

  const quantity = Number(quantityRaw);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("quantity must be a positive integer");
  }

  return {
    customerId,
    variantId,
    quantity,
    regionId,
    salesChannelId,
    email,
  };
}

export default async function addItemToCustomerCart({
  container,
  args,
}: ExecArgs) {
  const input = parseArgs(args);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: ["id", "customer_id", "completed_at", "updated_at", "email"],
    filters: {
      customer_id: input.customerId,
      completed_at: null,
    },
  });

  const activeCart = (carts || []).sort((a: any, b: any) => {
    const dateA = new Date(a.updated_at || 0).getTime();
    const dateB = new Date(b.updated_at || 0).getTime();
    return dateB - dateA;
  })[0];

  let cartId = activeCart?.id as string | undefined;

  if (!cartId) {
    const { result, errors } = await createCartWorkflow(container).run({
      input: {
        region_id: input.regionId,
        customer_id: input.customerId,
        sales_channel_id: input.salesChannelId,
        email: input.email,
      },
      throwOnError: false,
    });

    if (errors?.length || !result?.id) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            step: "create_cart",
            errors: (errors || []).map((e) => e.error?.message || e.action),
          },
          null,
          2,
        ),
      );
      return;
    }

    cartId = result.id;
  }

  const { errors: addErrors } = await addToCartWorkflow(container).run({
    input: {
      cart_id: cartId,
      items: [{ variant_id: input.variantId, quantity: input.quantity }],
    },
    throwOnError: false,
  });

  if (addErrors?.length) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          step: "add_item",
          cartId,
          errors: addErrors.map((e) => e.error?.message || e.action),
        },
        null,
        2,
      ),
    );
    return;
  }

  const { data: cartsAfter } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "email",
      "customer_id",
      "updated_at",
      "items.id",
      "items.variant_id",
      "items.quantity",
      "items.title",
      "items.subtitle",
    ],
    filters: { id: cartId },
  });

  const cart = cartsAfter?.[0] as any;

  console.log(
    JSON.stringify(
      {
        ok: true,
        cartId,
        customerId: input.customerId,
        added: {
          variantId: input.variantId,
          quantity: input.quantity,
        },
        cartItems: (cart?.items || []).map((i: any) => ({
          id: i.id,
          variant_id: i.variant_id,
          quantity: i.quantity,
          title: i.title,
          subtitle: i.subtitle,
        })),
      },
      null,
      2,
    ),
  );
}
