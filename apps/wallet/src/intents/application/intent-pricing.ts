export type IntentSnapshotValidationErrorCode =
  | 'INVALID_SNAPSHOT_SCHEMA'
  | 'INVALID_ITEMS'
  | 'INVALID_PRICING_INPUT';

export class IntentSnapshotValidationError extends Error {
  constructor(
    public readonly code: IntentSnapshotValidationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'IntentSnapshotValidationError';
  }
}

export type IntentItemType = 'PRODUCT' | 'SHIPPING_FEE';
export type IntentItemDiscountKind = 'ITEM_PER_UNIT' | 'ITEM_FLAT';
export type IntentOrderDiscountKind = 'ORDER';

export interface ParsedItemDiscount {
  discountId?: string;
  kind: IntentItemDiscountKind;
  amount: number;
}

export interface ParsedOrderDiscount {
  discountId?: string;
  kind: IntentOrderDiscountKind;
  amount: number;
}

export interface ParsedSnapshotItem {
  lineId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  type?: IntentItemType;
  id?: string;
  discounts: ParsedItemDiscount[];
}

export interface ParsedIntentSnapshot {
  schemaVersion: 'INTENT_SNAPSHOT_V1';
  items: ParsedSnapshotItem[];
  orderDiscounts: ParsedOrderDiscount[];
}

export interface IntentPricingItemResult {
  lineId: string;
  name: string;
  type?: IntentItemType;
  id?: string;
  unitPrice: number;
  quantity: number;
  baseAmount: number;
  itemDiscountPerUnitTotal: number;
  itemDiscountFlatTotal: number;
  payableAmount: number;
  discounts: ParsedItemDiscount[];
}

export interface IntentPricingResult {
  items: IntentPricingItemResult[];
  orderDiscounts: ParsedOrderDiscount[];
  itemsSubtotal: number;
  orderDiscountTotal: number;
  intentPayable: number;
}

const ITEM_TYPES = new Set<IntentItemType>(['PRODUCT', 'SHIPPING_FEE']);
const ITEM_DISCOUNT_KINDS = new Set<IntentItemDiscountKind>([
  'ITEM_PER_UNIT',
  'ITEM_FLAT',
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePositiveInteger(
  value: unknown,
  fieldPath: string,
  options: { allowZero: boolean },
): number {
  if (!Number.isInteger(value)) {
    throw new IntentSnapshotValidationError(
      'INVALID_PRICING_INPUT',
      `${fieldPath} must be an integer`,
    );
  }

  if (!Number.isSafeInteger(value)) {
    throw new IntentSnapshotValidationError(
      'INVALID_PRICING_INPUT',
      `${fieldPath} must be a safe integer`,
    );
  }

  if (options.allowZero) {
    if ((value as number) < 0) {
      throw new IntentSnapshotValidationError(
        'INVALID_PRICING_INPUT',
        `${fieldPath} must be >= 0`,
      );
    }
    return value as number;
  }

  if ((value as number) <= 0) {
    throw new IntentSnapshotValidationError(
      'INVALID_PRICING_INPUT',
      `${fieldPath} must be > 0`,
    );
  }

  return value as number;
}

function parseOptionalString(value: unknown, fieldPath: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new IntentSnapshotValidationError(
      'INVALID_SNAPSHOT_SCHEMA',
      `${fieldPath} must be a non-empty string`,
    );
  }
  return value;
}

function parseRequiredString(value: unknown, fieldPath: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new IntentSnapshotValidationError(
      'INVALID_SNAPSHOT_SCHEMA',
      `${fieldPath} must be a non-empty string`,
    );
  }
  return value;
}

function safeAdd(left: number, right: number, fieldPath: string): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    throw new IntentSnapshotValidationError(
      'INVALID_PRICING_INPUT',
      `${fieldPath} overflowed safe integer range`,
    );
  }
  return total;
}

function safeMultiply(left: number, right: number, fieldPath: string): number {
  const total = left * right;
  if (!Number.isSafeInteger(total)) {
    throw new IntentSnapshotValidationError(
      'INVALID_PRICING_INPUT',
      `${fieldPath} overflowed safe integer range`,
    );
  }
  return total;
}

function parseItemDiscount(
  value: unknown,
  fieldPath: string,
): ParsedItemDiscount {
  if (!isObject(value)) {
    throw new IntentSnapshotValidationError(
      'INVALID_SNAPSHOT_SCHEMA',
      `${fieldPath} must be an object`,
    );
  }

  const kind = parseRequiredString(value.kind, `${fieldPath}.kind`);
  if (!ITEM_DISCOUNT_KINDS.has(kind as IntentItemDiscountKind)) {
    throw new IntentSnapshotValidationError(
      'INVALID_SNAPSHOT_SCHEMA',
      `${fieldPath}.kind must be ITEM_PER_UNIT or ITEM_FLAT`,
    );
  }

  return {
    discountId: parseOptionalString(value.discountId, `${fieldPath}.discountId`),
    kind: kind as IntentItemDiscountKind,
    amount: parsePositiveInteger(value.amount, `${fieldPath}.amount`, {
      allowZero: false,
    }),
  };
}

function parseOrderDiscount(
  value: unknown,
  fieldPath: string,
): ParsedOrderDiscount {
  if (!isObject(value)) {
    throw new IntentSnapshotValidationError(
      'INVALID_SNAPSHOT_SCHEMA',
      `${fieldPath} must be an object`,
    );
  }

  const kind = parseRequiredString(value.kind, `${fieldPath}.kind`);
  if (kind !== 'ORDER') {
    throw new IntentSnapshotValidationError(
      'INVALID_SNAPSHOT_SCHEMA',
      `${fieldPath}.kind must be ORDER`,
    );
  }

  return {
    discountId: parseOptionalString(value.discountId, `${fieldPath}.discountId`),
    kind: 'ORDER',
    amount: parsePositiveInteger(value.amount, `${fieldPath}.amount`, {
      allowZero: false,
    }),
  };
}

function parseSnapshotItem(value: unknown, index: number): ParsedSnapshotItem {
  const fieldPath = `snapshotPayload.items[${index}]`;
  if (!isObject(value)) {
    throw new IntentSnapshotValidationError(
      'INVALID_SNAPSHOT_SCHEMA',
      `${fieldPath} must be an object`,
    );
  }

  const typeRaw = value.type;
  const id = parseOptionalString(value.id, `${fieldPath}.id`);
  let type: IntentItemType | undefined;

  if (typeRaw !== undefined && typeRaw !== null) {
    if (typeof typeRaw !== 'string' || !ITEM_TYPES.has(typeRaw as IntentItemType)) {
      throw new IntentSnapshotValidationError(
        'INVALID_SNAPSHOT_SCHEMA',
        `${fieldPath}.type must be PRODUCT or SHIPPING_FEE`,
      );
    }
    type = typeRaw as IntentItemType;
  }

  if (!type && id) {
    throw new IntentSnapshotValidationError(
      'INVALID_SNAPSHOT_SCHEMA',
      `${fieldPath}.id cannot exist when type is missing`,
    );
  }

  if (type === 'SHIPPING_FEE' && id) {
    throw new IntentSnapshotValidationError(
      'INVALID_SNAPSHOT_SCHEMA',
      `${fieldPath}.id must be omitted when type is SHIPPING_FEE`,
    );
  }

  const discountsRaw = value.discounts ?? [];
  if (!Array.isArray(discountsRaw)) {
    throw new IntentSnapshotValidationError(
      'INVALID_SNAPSHOT_SCHEMA',
      `${fieldPath}.discounts must be an array`,
    );
  }

  return {
    lineId: parseRequiredString(value.lineId, `${fieldPath}.lineId`),
    name: parseRequiredString(value.name, `${fieldPath}.name`),
    unitPrice: parsePositiveInteger(value.unitPrice, `${fieldPath}.unitPrice`, {
      allowZero: true,
    }),
    quantity: parsePositiveInteger(value.quantity, `${fieldPath}.quantity`, {
      allowZero: false,
    }),
    type,
    id,
    discounts: discountsRaw.map((discount, discountIndex) =>
      parseItemDiscount(discount, `${fieldPath}.discounts[${discountIndex}]`),
    ),
  };
}

export function parseIntentSnapshotPayload(
  snapshotPayload: unknown,
): ParsedIntentSnapshot {
  if (!isObject(snapshotPayload)) {
    throw new IntentSnapshotValidationError(
      'INVALID_SNAPSHOT_SCHEMA',
      'snapshotPayload must be an object',
    );
  }

  const schemaVersion = parseRequiredString(
    snapshotPayload.schemaVersion,
    'snapshotPayload.schemaVersion',
  );
  if (schemaVersion !== 'INTENT_SNAPSHOT_V1') {
    throw new IntentSnapshotValidationError(
      'INVALID_SNAPSHOT_SCHEMA',
      'snapshotPayload.schemaVersion must be INTENT_SNAPSHOT_V1',
    );
  }

  const itemsRaw = snapshotPayload.items;
  if (!Array.isArray(itemsRaw)) {
    throw new IntentSnapshotValidationError(
      'INVALID_SNAPSHOT_SCHEMA',
      'snapshotPayload.items must be an array',
    );
  }

  if (itemsRaw.length === 0) {
    throw new IntentSnapshotValidationError(
      'INVALID_ITEMS',
      'snapshotPayload.items must include at least one item',
    );
  }

  const items = itemsRaw.map((item, index) => parseSnapshotItem(item, index));
  const seenLineIds = new Set<string>();
  for (const item of items) {
    if (seenLineIds.has(item.lineId)) {
      throw new IntentSnapshotValidationError(
        'INVALID_ITEMS',
        `snapshotPayload.items.lineId must be unique: ${item.lineId}`,
      );
    }
    seenLineIds.add(item.lineId);
  }

  const orderDiscountsRaw = snapshotPayload.orderDiscounts ?? [];
  if (!Array.isArray(orderDiscountsRaw)) {
    throw new IntentSnapshotValidationError(
      'INVALID_SNAPSHOT_SCHEMA',
      'snapshotPayload.orderDiscounts must be an array',
    );
  }

  return {
    schemaVersion: 'INTENT_SNAPSHOT_V1',
    items,
    orderDiscounts: orderDiscountsRaw.map((discount, index) =>
      parseOrderDiscount(discount, `snapshotPayload.orderDiscounts[${index}]`),
    ),
  };
}

export function calculateIntentPricing(
  snapshot: ParsedIntentSnapshot,
): IntentPricingResult {
  const items: IntentPricingItemResult[] = [];
  let itemsSubtotal = 0;

  for (const item of snapshot.items) {
    const baseAmount = safeMultiply(
      item.unitPrice,
      item.quantity,
      `items[${item.lineId}].baseAmount`,
    );

    let itemDiscountPerUnitTotal = 0;
    let itemDiscountFlatTotal = 0;

    for (const discount of item.discounts) {
      if (discount.kind === 'ITEM_PER_UNIT') {
        const lineDiscount = safeMultiply(
          discount.amount,
          item.quantity,
          `items[${item.lineId}].discounts.ITEM_PER_UNIT`,
        );
        itemDiscountPerUnitTotal = safeAdd(
          itemDiscountPerUnitTotal,
          lineDiscount,
          `items[${item.lineId}].itemDiscountPerUnitTotal`,
        );
        continue;
      }

      itemDiscountFlatTotal = safeAdd(
        itemDiscountFlatTotal,
        discount.amount,
        `items[${item.lineId}].itemDiscountFlatTotal`,
      );
    }

    const afterPerUnit = Math.max(baseAmount - itemDiscountPerUnitTotal, 0);
    const payableAmount = Math.max(afterPerUnit - itemDiscountFlatTotal, 0);
    itemsSubtotal = safeAdd(
      itemsSubtotal,
      payableAmount,
      'itemsSubtotal',
    );

    items.push({
      lineId: item.lineId,
      name: item.name,
      type: item.type,
      id: item.id,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      baseAmount,
      itemDiscountPerUnitTotal,
      itemDiscountFlatTotal,
      payableAmount,
      discounts: item.discounts,
    });
  }

  let orderDiscountTotal = 0;
  for (const discount of snapshot.orderDiscounts) {
    orderDiscountTotal = safeAdd(
      orderDiscountTotal,
      discount.amount,
      'orderDiscountTotal',
    );
  }

  const intentPayable = Math.max(itemsSubtotal - orderDiscountTotal, 0);

  return {
    items,
    orderDiscounts: snapshot.orderDiscounts,
    itemsSubtotal,
    orderDiscountTotal,
    intentPayable,
  };
}
