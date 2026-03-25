/**
 * Pricing calculation logic for payment intents with items.
 *
 * For each item:
 *   base_amount = unit_price × quantity
 *   item_discount_per_unit_total = Σ(ITEM_PER_UNIT.amount) × quantity
 *   item_discount_flat_total = Σ(ITEM_FLAT.amount)
 *   item_payable = max(0, base - per_unit_discount - flat_discount)
 *
 * items_subtotal = Σ(item_payable)
 * order_discount_total = Σ(order_discounts.amount)
 * payable_amount = max(0, items_subtotal - order_discount_total)
 */

export interface ItemDiscountInput {
  kind: 'ITEM_PER_UNIT' | 'ITEM_FLAT';
  amount: number;
  discountRefId?: string;
  name?: string;
}

export interface ItemInput {
  lineId: string;
  name: string;
  itemType?: 'PRODUCT' | 'SUBSCRIPTION' | 'SHIPPING_FEE' | 'OTHER';
  itemRefId?: string;
  unitPrice: number;
  quantity: number;
  discounts?: ItemDiscountInput[];
}

export interface OrderDiscountInput {
  kind: 'ORDER';
  amount: number;
  discountRefId?: string;
  name?: string;
}

export interface CalculatedItem {
  lineId: string;
  name: string;
  itemType?: 'PRODUCT' | 'SUBSCRIPTION' | 'SHIPPING_FEE' | 'OTHER';
  itemRefId?: string;
  unitPrice: number;
  quantity: number;
  baseAmount: number;
  itemDiscountPerUnitTotal: number;
  itemDiscountFlatTotal: number;
  payableAmount: number;
  discounts: ItemDiscountInput[];
}

export interface PricingResult {
  items: CalculatedItem[];
  itemsSubtotal: number;
  orderDiscountTotal: number;
  payableAmount: number;
}

export function calculatePricing(items: ItemInput[], orderDiscounts: OrderDiscountInput[] = []): PricingResult {
  const calculatedItems: CalculatedItem[] = items.map((item) => {
    const baseAmount = item.unitPrice * item.quantity;
    const discounts = item.discounts ?? [];

    const perUnitDiscountSum = discounts
      .filter((d) => d.kind === 'ITEM_PER_UNIT')
      .reduce((sum, d) => sum + d.amount, 0);
    const flatDiscountSum = discounts.filter((d) => d.kind === 'ITEM_FLAT').reduce((sum, d) => sum + d.amount, 0);

    const itemDiscountPerUnitTotal = perUnitDiscountSum * item.quantity;
    const itemDiscountFlatTotal = flatDiscountSum;

    const payableAmount = Math.max(0, baseAmount - itemDiscountPerUnitTotal - itemDiscountFlatTotal);

    return {
      lineId: item.lineId,
      name: item.name,
      itemType: item.itemType,
      itemRefId: item.itemRefId,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      baseAmount,
      itemDiscountPerUnitTotal,
      itemDiscountFlatTotal,
      payableAmount,
      discounts,
    };
  });

  const itemsSubtotal = calculatedItems.reduce((sum, item) => sum + item.payableAmount, 0);
  const orderDiscountTotal = orderDiscounts.reduce((sum, d) => sum + d.amount, 0);
  const payableAmount = Math.max(0, itemsSubtotal - orderDiscountTotal);

  return {
    items: calculatedItems,
    itemsSubtotal,
    orderDiscountTotal,
    payableAmount,
  };
}
