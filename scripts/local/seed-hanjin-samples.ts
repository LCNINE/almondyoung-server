/**
 * 한진 통합테스트(검수)용 샘플 출고 박스를 dev_core 에 얹는다.
 *
 * 한진은 자체출력 고객사에 두 가지 검수를 요구한다 (정본 `docs/hanjin-api-integration-reference.md` §1):
 * 샘플 운송장 출력물(영업담당자) + 개발환경에 전송한 주문 데이터(IT담당자). 두 검수가 **같은 건**을
 * 보도록, 이 스크립트가 만든 박스에 core API 로 운송장을 발급하고 그 라벨을 그대로 출력한다.
 *
 * 시드 주문(`dev:core:reset`)은 수취인이 전부 같은 더미 주소라 검수 재료가 못 된다. 여기서는
 * 수취인 이름·연락처는 가공하고 주소는 공공기관 실주소를 쓴다 — 한진 분류(터미널 코드)가
 * 실제로 계산돼야 하기 때문이다.
 *
 * 지역 셋(수도권·제주·강원 산간)은 한진 영업담당자가 정했다(2026-09-29 통화) — 도서산간까지
 * 분류가 제대로 찍히는지 보려는 것이다. 다품목(추가 쪽)·긴 이름 같은 우리 쪽 확인거리는 그
 * 셋 안에 얹는다. 주소·우편번호는 우체국 우편번호 검색으로 확인한 값이다.
 *
 * 상품명은 아몬드영 쇼핑몰에서 실제로 파는 실물 상품이다. 한진에 등록되는 품명은 판매주문 라인의
 * 상품명에서, 라벨 품목 줄은 **SKU 이름**에서 나오므로 둘 다 같은 이름으로 맞춘다 — 그래서 이
 * 스크립트는 쓰는 시드 SKU 의 이름을 바꾼다(dev_core 전용이라 시드 결정론은 여기서 포기한다).
 *
 * 전제: `dev:core:reset` 이 끝난 dev_core (시드 variant·SKU·재고·배송 프로필을 쓴다).
 * 운송장 발급은 이 스크립트가 하지 않는다 — core 를 띄우고 HTTP 로 발급해야 실제 경로를 탄다.
 * 순서는 `docs/hanjin-api-integration-reference.md` §7.1.
 *
 *   npx dotenv -e apps/core/.env -- npx ts-node -r tsconfig-paths/register --transpile-only scripts/local/seed-hanjin-samples.ts
 *
 * 멱등: 같은 채널 주문번호가 이미 있으면 그 샘플은 건너뛴다.
 */
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as postgres from 'postgres';
import { DbTx, wmsSchema, wmsTables } from '../../apps/core/src/modules/inventory/schema/inventory.schema';
import {
  makeDbService,
  wireLogistics,
} from '../../apps/core/src/modules/fulfillment/services/__support__/logistics-wiring';
import { deriveCustOrdNo } from '../../apps/core/src/modules/fulfillment/waybill/cust-ord-no';
import { SEED_IDS, SEED_SKUS } from './seed-dev-core/constants';
import { assertLocalDevCoreUrl } from './seed-dev-core/guard';
import { buildShipmentPlanning } from './seed-dev-core/planning';
import { SEED_ACTOR } from './seed-dev-core/shipments';

/** seed-dev-core/orders.ts 의 variantIdFor 와 같은 규칙 — 시드가 이미 SKU 에 매칭해 둔 variant 다.
 * 그 파일처럼 variant index i 는 SEED_SKUS[i + 2](재고가 있는 SKU)에 매칭돼 있다. */
function seededVariantId(index: number): string {
  const seq = String(index + 1).padStart(4, '0');
  return `019d0007-${seq}-7000-a000-00000000${seq}`;
}

interface SampleLine {
  variantIndex: number;
  productName: string;
  quantity: number;
}

interface Sample {
  channelOrderId: string;
  purpose: string;
  shippingAddress: {
    recipientName: string;
    phone: string;
    postalCode: string;
    roadAddress: string;
    detailAddress: string;
    deliveryNote?: string;
  };
  entrancePassword?: string;
  lines: SampleLine[];
}

const SAMPLES: Sample[] = [
  {
    channelOrderId: 'HJ-SAMPLE-0001',
    purpose: '수도권 + 배송메모·공동현관(배송요구사항 합성)',
    shippingAddress: {
      recipientName: '홍길동',
      phone: '010-1234-5678',
      postalCode: '04524',
      roadAddress: '서울특별시 중구 세종대로 110',
      detailAddress: '서울시청 본관 1층',
      deliveryNote: '부재 시 경비실에 맡겨주세요',
    },
    entrancePassword: '1234#',
    lines: [{ variantIndex: 6, productName: '노몬드 속눈썹 영양제 블랙', quantity: 2 }],
  },
  {
    channelOrderId: 'HJ-SAMPLE-0002',
    purpose: '제주 + 다품목(추가 쪽)·긴 이름(5자 이상 마스킹)·긴 상세주소',
    shippingAddress: {
      recipientName: '남궁가나다라',
      phone: '010-9876-5432',
      postalCode: '63122',
      roadAddress: '제주특별자치도 제주시 문연로 6',
      detailAddress: '제주특별자치도청 제1청사 2층 민원실 물류검수 담당 (정문 안내데스크 경유)',
      deliveryNote: '배송 전 연락 부탁드립니다',
    },
    lines: [
      { variantIndex: 0, productName: '퍼매니아 속눈썹펌 키트 속눈썹 펌 세트', quantity: 1 },
      { variantIndex: 1, productName: '듀오에어 속눈썹풀 속눈썹 듀오 접착제 글루 7ml', quantity: 2 },
      { variantIndex: 2, productName: '노몬드 네일 젤 클렌저 1L', quantity: 1 },
      { variantIndex: 3, productName: '오샤레 속눈썹 고글', quantity: 1 },
      { variantIndex: 4, productName: '속눈썹 펌스틱', quantity: 3 },
      { variantIndex: 5, productName: '루벤스 네일 드라이어', quantity: 1 },
    ],
  },
  {
    channelOrderId: 'HJ-SAMPLE-0003',
    purpose: '강원 산간 — 단품·메모 없음',
    shippingAddress: {
      recipientName: '이몽룡',
      phone: '010-5555-0303',
      postalCode: '24659',
      roadAddress: '강원특별자치도 인제군 기린면 기린로42번길 9',
      detailAddress: '기린면행정복지센터',
    },
    lines: [{ variantIndex: 7, productName: '엘라 속눈썹 걸이', quantity: 1 }],
  },
];

async function findShipmentId(tx: DbTx, salesOrderId: string): Promise<string> {
  // shipments 에는 salesOrderId 가 없다 — shipment_lines → FO items → FO 로만 이어진다 (orders.ts 와 같은 경로).
  const rows = await tx
    .selectDistinct({ id: wmsTables.shipments.id })
    .from(wmsTables.shipments)
    .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.shipmentId, wmsTables.shipments.id))
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .innerJoin(
      wmsTables.fulfillmentOrders,
      eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
    )
    .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
  if (rows.length !== 1) {
    throw new Error(`[hanjin-samples] 주문 ${salesOrderId} 의 박스가 1개가 아니다: ${rows.length}`);
  }
  return rows[0].id;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('[hanjin-samples] DATABASE_URL 이 없다 — dotenv -e apps/core/.env 로 주입할 것');
  assertLocalDevCoreUrl(url);

  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema: wmsSchema });
  const dbService = makeDbService(db);
  const wired = wireLogistics(dbService, 'v2');
  const planning = buildShipmentPlanning(dbService, wired);

  const created: { sample: Sample; shipmentId: string }[] = [];
  try {
    for (const sample of SAMPLES) {
      const [existing] = await db
        .select({ id: wmsTables.salesOrders.id })
        .from(wmsTables.salesOrders)
        .where(
          and(
            eq(wmsTables.salesOrders.salesChannel, 'medusa'),
            eq(wmsTables.salesOrders.channelOrderId, sample.channelOrderId),
          ),
        );
      if (existing) {
        console.log(`· ${sample.channelOrderId} 이미 있음 — 건너뜀`);
        continue;
      }

      const shipmentId = await dbService.run(async (tx) => {
        const [salesOrder] = await tx
          .insert(wmsTables.salesOrders)
          .values({
            channelOrderId: sample.channelOrderId,
            salesChannel: 'medusa',
            status: 'confirmed',
            shippingAddress: sample.shippingAddress,
            entrancePassword: sample.entrancePassword ?? null,
            orderDate: new Date(),
          })
          .returning();

        await tx.insert(wmsTables.salesOrderLines).values(
          sample.lines.map((line, index) => ({
            salesOrderId: salesOrder.id,
            variantId: seededVariantId(line.variantIndex),
            productName: line.productName,
            quantity: line.quantity,
            unitPrice: 10_000,
            channelOrderItemId: `${sample.channelOrderId}-ITEM-${index + 1}`,
            channelProductId: `${sample.channelOrderId}-PRODUCT-${index + 1}`,
          })),
        );

        for (const line of sample.lines) {
          await tx
            .update(wmsTables.skus)
            .set({ name: line.productName })
            .where(eq(wmsTables.skus.id, SEED_SKUS[line.variantIndex + 2].id));
        }

        await wired.fulfillments.create({ salesOrderId: salesOrder.id, warehouseId: SEED_IDS.warehouseBucheon }, tx);
        const id = await findShipmentId(tx, salesOrder.id);

        const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, id));
        await planning.plan(
          id,
          {
            shippingProfileId: SEED_IDS.deliveryProfile,
            expectedManifestVersion: shipment.manifestVersion,
            expectedReservationVersion: shipment.reservationVersion,
          },
          `hanjin-sample-plan-${sample.channelOrderId}`,
          SEED_ACTOR,
          tx,
        );
        return id;
      });
      created.push({ sample, shipmentId });
    }
  } finally {
    await client.end();
  }

  if (created.length === 0) {
    console.log('새로 만든 샘플 없음');
    return;
  }
  console.log('\n새로 만든 planned 박스 — 운송장은 core API 로 발급한다:');
  for (const { sample, shipmentId } of created) {
    console.log(
      `${sample.channelOrderId}\tshipment=${shipmentId}\tcustOrdNo=${deriveCustOrdNo(shipmentId)}\t${sample.purpose}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
