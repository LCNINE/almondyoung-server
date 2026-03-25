/**
 * 셀메이트 발주용 주문 데이터를 JSON으로 저장하는 스크립트
 *
 * 실행 방법:
 *   yarn fetch:sellmate
 *
 * 환경변수 옵션:
 *   FROM_DATE  - 조회 시작일 (예: "2026-03-09")  기본값: 오늘 KST
 *   TO_DATE    - 조회 종료일 (예: "2026-03-09")  기본값: 오늘 KST
 *   STATUS     - 주문 상태 콤마 구분 (예: "pending,processing")  기본값: "pending"
 *   OUTPUT     - 출력 JSON 경로  기본값: ./sellmate-orders-YYYYMMDD.json
 */
import { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import * as fs from 'fs';
import * as path from 'path';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstStartOfDay(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00+09:00`);
}
function kstEndOfDay(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59+09:00`);
}
function todayKST(): string {
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}
function formatKST(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().replace('T', ' ').slice(0, 19);
}
function toDateStrKST(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10).replace(/-/g, '');
}

export default async function fetchOrdersForSellmate({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const today = todayKST();
  const fromDate = kstStartOfDay(process.env.FROM_DATE ?? today);
  const toDate = kstEndOfDay(process.env.TO_DATE ?? today);
  const statuses = (process.env.STATUS ?? 'pending').split(',').map((s) => s.trim());

  logger.info(
    `[sellmate-fetch] 기간: ${formatKST(fromDate)} ~ ${formatKST(toDate)} (KST), 상태: ${statuses.join(', ')}`,
  );

  const limit = 100;
  let offset = 0;
  const allOrders: any[] = [];

  while (true) {
    const { data: orders } = await query.graph({
      entity: 'order',
      fields: [
        'id',
        'display_id',
        'created_at',
        'total',
        'original_total',
        // items = OrderLineItem (product_title, unit_price)
        // items.detail = OrderItem (quantity)
        'items.id',
        'items.product_title',
        'items.unit_price',
        'items.detail.quantity',
        'items.variant.options.value',
        'items.variant.options.option.title',
        // shipping_address 하위 필드 명시
        'shipping_address.first_name',
        'shipping_address.last_name',
        'shipping_address.address_1',
        'shipping_address.address_2',
        'shipping_address.postal_code',
        'shipping_address.phone',
      ],
      filters: {
        status: statuses,
        created_at: {
          $gte: fromDate.toISOString(),
          $lte: toDate.toISOString(),
        },
      },
      pagination: { take: limit, skip: offset },
    });

    allOrders.push(...orders);
    if (orders.length < limit) break;
    offset += limit;
  }

  logger.info(`[sellmate-fetch] 주문 ${allOrders.length}건 조회 완료`);

  // 첫 번째 주문 구조 디버그 출력 (shipping_address 필드 확인용)
  if (allOrders.length > 0) {
    const sample = allOrders[0];
    logger.info(
      `[sellmate-fetch] 샘플 주문 구조:\n${JSON.stringify(
        {
          id: sample.id,
          display_id: sample.display_id,
          shipping_address: sample.shipping_address,
          items_count: sample.items?.length,
          first_item: sample.items?.[0]
            ? {
                product_title: sample.items[0].product_title,
                unit_price: sample.items[0].unit_price,
                quantity: sample.items[0].quantity,
                variant_options: sample.items[0].variant?.options,
              }
            : null,
        },
        null,
        2,
      )}`,
    );
  }

  // 정규화된 JSON 저장 (build-sellmate-xls.ts 에서 읽음)
  const result = allOrders.map((order: any) => ({
    id: order.id,
    displayId: order.display_id,
    createdAt: order.created_at,
    total: order.total,
    originalTotal: order.original_total,
    shippingAddress: {
      firstName: order.shipping_address?.first_name ?? '',
      lastName: order.shipping_address?.last_name ?? '',
      address1: order.shipping_address?.address_1 ?? '',
      address2: order.shipping_address?.address_2 ?? '',
      postalCode: order.shipping_address?.postal_code ?? '',
      phone: order.shipping_address?.phone ?? '',
    },
    items: (order.items ?? []).map((item: any) => ({
      productTitle: item.product_title ?? '',
      optionName: (item.variant?.options ?? []).map((o: any) => o.value).join(', '),
      unitPrice: item.unit_price ?? 0,
      quantity: item.detail?.quantity ?? 0,
    })),
  }));

  const outputPath = process.env.OUTPUT ?? path.join(process.cwd(), `sellmate-orders-${toDateStrKST(fromDate)}.json`);

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
  logger.info(`[sellmate-fetch] ${result.length}건 → ${outputPath}`);
}
