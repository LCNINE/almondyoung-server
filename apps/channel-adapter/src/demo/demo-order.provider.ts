import { v5 as uuidv5 } from 'uuid';
import { DEMO_LOGISTICS_FIXTURE, DEMO_LOGISTICS_FIXTURE_VERSION } from '@app/shared/demo-logistics.fixture';
import type { OrderCreatedPayload } from '@packages/event-contracts/streams';
import type {
  ChannelOrderProvider,
  FetchOrdersResult,
  OrderFetchItem,
} from '../services/order-collection/channel-order-provider.interface';

export const DEMO_FIXTURE_VERSION = DEMO_LOGISTICS_FIXTURE_VERSION;
export const DEFAULT_HAPPY_PATH_VARIANT_ID = DEMO_LOGISTICS_FIXTURE.catalog[29].variantId;
export const DEFAULT_INVENTORY_SHORTAGE_VARIANT_ID = DEMO_LOGISTICS_FIXTURE.catalog[0].variantId;
const DEMO_ID_NAMESPACE = '24b9fd11-32c9-4d0b-8e3e-a99843fc59cd';

export interface DemoFixtureIdentity {
  fixtureNumber: number;
  variantId: string;
  masterId: string;
  versionId: string;
  skuId: string;
  sku: string;
  productName: string;
  unitPrice: number;
}

export interface DemoProviderRunInput {
  requestId: string;
  scenario: 'happy_path' | 'inventory_shortage';
  count: number;
  variantId: string;
  quantity: number;
  createdAt: Date;
}

export interface DemoPersistedOrderLine {
  orderItemId: string;
  skuId: string;
  masterId: string;
  versionId: string;
  variantId: string;
  sku: string;
  productName: string;
  availableQuantity: number | null;
  components: { skuId: string; quantity: number; availableQuantity: number | null }[];
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export function fixtureIdentityForVariant(variantId: string): DemoFixtureIdentity {
  const fixtureNumber = DEMO_LOGISTICS_FIXTURE.catalog.findIndex((item) => item.variantId === variantId) + 1;
  const fixture = DEMO_LOGISTICS_FIXTURE.catalog[fixtureNumber - 1];
  if (!fixture) {
    throw new Error(`variantId is not part of ${DEMO_FIXTURE_VERSION}`);
  }

  return {
    fixtureNumber,
    variantId: fixture.variantId,
    masterId: fixture.masterId,
    versionId: fixture.versionId,
    skuId: fixture.skuId,
    sku: fixture.sku,
    productName: fixture.productName,
    unitPrice: fixture.unitPrice,
  };
}

export function demoRunItemIdentity(requestId: string, sequence: number) {
  const key = `${requestId}:${sequence}`;
  return {
    id: uuidv5(`demo-run-item:${key}`, DEMO_ID_NAMESPACE),
    orderId: uuidv5(`demo-order:${key}`, DEMO_ID_NAMESPACE),
    externalOrderId: `demo-${requestId}-${String(sequence).padStart(3, '0')}`,
    orderItemId: `demo-line-${uuidv5(`demo-line:${key}`, DEMO_ID_NAMESPACE)}`,
  };
}

export function demoRunLineIdentity(requestId: string, sequence: number, lineSequence: number): string {
  return `demo-line-${uuidv5(`demo-line:${requestId}:${sequence}:${lineSequence}`, DEMO_ID_NAMESPACE)}`;
}

export class DemoOrderProvider implements ChannelOrderProvider {
  readonly channel = 'medusa' as const;

  private constructor(private readonly orders: OrderFetchItem[]) {}

  static forRun(input: DemoProviderRunInput): DemoOrderProvider {
    return new DemoOrderProvider(Array.from({ length: input.count }, (_, index) => buildDemoOrder(input, index + 1)));
  }

  static forItem(input: DemoProviderRunInput, sequence: number): DemoOrderProvider {
    return new DemoOrderProvider([buildDemoOrder(input, sequence)]);
  }

  static forPersistedItem(
    input: DemoProviderRunInput,
    sequence: number,
    lines: DemoPersistedOrderLine[],
  ): DemoOrderProvider {
    return new DemoOrderProvider([buildDemoOrder(input, sequence, lines)]);
  }

  fetchOrders(_since: Date | null): Promise<FetchOrdersResult> {
    void _since;
    return Promise.resolve({ orders: this.orders, failures: [], lifecycleEvents: [] });
  }
}

function buildDemoOrder(
  input: DemoProviderRunInput,
  sequence: number,
  persistedLines?: DemoPersistedOrderLine[],
): OrderFetchItem {
  const identity = demoRunItemIdentity(input.requestId, sequence);
  const createdAt = input.createdAt.toISOString();
  const shippingAddress = {
    recipientName: `데모 수령인 ${String(sequence).padStart(2, '0')}`,
    phone: '010-0000-0000',
    postalCode: '06236',
    roadAddress: '서울특별시 강남구 테헤란로 1',
    detailAddress: `데모 ${sequence}호`,
    deliveryNote: `${DEMO_FIXTURE_VERSION} / ${input.scenario}`,
  };
  const lines: DemoPersistedOrderLine[] =
    persistedLines ??
    (() => {
      const fixture = fixtureIdentityForVariant(input.variantId);
      return [
        {
          orderItemId: identity.orderItemId,
          skuId: fixture.skuId,
          masterId: fixture.masterId,
          versionId: fixture.versionId,
          variantId: fixture.variantId,
          sku: fixture.sku,
          productName: fixture.productName,
          availableQuantity: null,
          components: [{ skuId: fixture.skuId, quantity: 1, availableQuantity: null }],
          quantity: input.quantity,
          unitPrice: fixture.unitPrice,
          totalPrice: fixture.unitPrice * input.quantity,
        },
      ];
    })();
  const items = lines.map((line) => ({
    orderItemId: line.orderItemId,
    skuId: line.variantId,
    masterId: line.masterId,
    versionId: line.versionId,
    variantId: line.variantId,
    productName: line.productName,
    channelProductId: line.sku,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    totalPrice: line.totalPrice,
    fulfillmentKind: 'physical' as const,
    requiresShipping: true,
  }));
  const totalPrice = items.reduce((sum, item) => sum + item.totalPrice, 0);
  const createPayload: OrderCreatedPayload = {
    orderId: identity.orderId,
    externalOrderId: identity.externalOrderId,
    displayOrderNo: `DEMO-${input.requestId.slice(0, 8)}-${String(sequence).padStart(3, '0')}`,
    salesChannel: 'medusa',
    customerId: null,
    items,
    totalAmount: totalPrice,
    subtotalAmount: totalPrice,
    shippingAmount: 0,
    discountAmount: 0,
    currency: 'KRW',
    shippingAddress,
    status: 'confirmed',
    createdAt,
  };

  return {
    externalOrderId: identity.externalOrderId,
    sourceUpdatedAt: createdAt,
    eligibleForOrderCreation: true,
    createPayload,
    changes: { items, shippingAddress, totalAmount: totalPrice },
    modifiedAt: createdAt,
  };
}
