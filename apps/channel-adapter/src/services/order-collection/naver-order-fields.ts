import { z } from 'zod';
import type { ShippingAddress } from '@packages/event-contracts/streams';
import { ClaimStatusSchema, ProductOrderStatusSchema } from '../../zods/naver/naver-core.zod';

/**
 * 네이버 상품주문 상세의 **우리가 읽는 부분만** 좁힌 모양.
 *
 * 커머스API 의 공개 문서(`llms/*.md`)는 `order`·`productOrder` 의 하위 구조를 "OAS 참조" 로
 * 생략한다. 그래서 **이 파일이 필드명 확정의 단일 지점**이다 — shadow 점검(계획 Task 8)에서
 * 실 응답을 보고 여기만 고친다. 아래 이름은 옛 어댑터가 실제로 읽던 값이다
 * (`naver-smartstore.adapter.ts:727-745`).
 *
 * `looseObject` 인 것이 요점이다: 모르는 필드는 통과시키고, **우리가 의존하는 필드가 없으면
 * throw** 한다. 삼키면 라인이 조용히 빠진 주문이 Core 로 들어간다.
 *
 * **Load-bearing 필드** (누락 시 throw):
 * - `orderId` — 주문 식별 (필수)
 * - `productOrderId` — 상품주문 식별 (필수)
 * - `productOrderStatus` — 주문 상태 (필수)
 * - `quantity` — 수량 (필수, 기본값 1 은 언더십핑 위험)
 * - `unitPrice` — 단가 (필수, 누락 시 매출 0 으로 조용히 기록되어 회복 불가)
 *
 * **Display/Fallback 필드** (누락 가능):
 * - `productName`, `shippingAddress` — 기본값으로 표시 목적 달성
 * - `totalPaymentAmount` — `unitPrice * quantity` 로 유도 가능
 * - `deliveryFeeAmount` — 누락 시 배송료 0 (수량 부문 아님)
 *
 * **클레임 칸** (누락 가능, 🔴 shadow 점검 전 추정):
 * - `productOrder.claimId`·`productOrder.claimType`, 최상위 `currentClaim.cancel.requestQuantity`
 * - 이름·위치의 근거는 공식 Q&A 뿐이다(https://github.com/commerce-api-naver/commerce-api/discussions/1773 —
 *   `quantityClaimCompatibility=true` 로 조회하면 상품주문 하나 안의 일부 수량 클레임이 `currentClaim` 에 온다).
 *   실 응답으로 아직 확인하지 않았다. 틀렸으면 **여기만** 고친다.
 * - 없어도 throw 하지 않는다 — 클레임이 없는 상품주문이 대부분이고, 수량이 없을 때 무엇을 할지는
 *   source(`naver-order.source.ts` 의 `buildLifecycle`)가 정한다. 있는데 모양이 틀리면 throw 한다 —
 *   틀린 수량으로 조용히 취소하지 않는다.
 */
const OrderSchema = z.looseObject({
  orderId: z.string().min(1),
  paymentDate: z.string().optional(),
  ordererName: z.string().optional(),
  ordererTel: z.string().optional(),
});

const ShippingAddressSchema = z.looseObject({
  name: z.string().optional(),
  tel1: z.string().optional(),
  zipCode: z.string().optional(),
  baseAddress: z.string().optional(),
  detailedAddress: z.string().optional(),
});

const ProductOrderSchema = z.looseObject({
  productOrderId: z.string().min(1),
  productOrderStatus: ProductOrderStatusSchema,
  claimStatus: ClaimStatusSchema.optional(),
  productId: z.union([z.string(), z.number()]).optional(),
  productName: z.string().optional(),
  quantity: z.number().int().nonnegative(),
  unitPrice: z.number().nonnegative(),
  totalPaymentAmount: z.number().nonnegative().optional(),
  deliveryFeeAmount: z.number().nonnegative().optional(),
  shippingAddress: ShippingAddressSchema.optional(),
  /** 🔴 shadow 점검 전 추정 (discussions/1773). 숫자로 와도 식별자로만 쓰므로 문자열로 받는다(`productId` 와 같다). */
  claimId: z.union([z.string().min(1), z.number()]).optional(),
  /** 🔴 shadow 점검 전 추정 (discussions/1773). 예: `CANCEL`. */
  claimType: z.string().min(1).optional(),
});

/** 🔴 shadow 점검 전 추정 (discussions/1773). `quantityClaimCompatibility=true` 일 때만 온다. */
const CurrentClaimSchema = z.looseObject({
  cancel: z
    .looseObject({
      requestQuantity: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

const ProductOrderInfoSchema = z.looseObject({
  order: OrderSchema,
  productOrder: ProductOrderSchema,
  currentClaim: CurrentClaimSchema.optional(),
});

export interface NaverProductOrderInfo {
  orderId: string;
  productOrderId: string;
  productOrderStatus: z.infer<typeof ProductOrderStatusSchema>;
  claimStatus?: z.infer<typeof ClaimStatusSchema>;
  /** 클레임 식별. 🔴 shadow 점검 전 추정 이름. 취소요청의 중복 판정 키(`channelRequestKey`)에 들어간다. */
  claimId?: string;
  /** 클레임 종류(예: `CANCEL`). 🔴 shadow 점검 전 추정 이름. */
  claimType?: string;
  /** 현재 취소 클레임의 수량(`currentClaim.cancel.requestQuantity`). 🔴 shadow 점검 전 추정 이름. */
  cancelClaimQuantity?: number;
  /** 리스팅 조회 키. 종류(원상품번호 vs 채널상품번호)는 shadow 로 확정한다. */
  channelProductId?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  shippingFee: number;
  paymentDate?: string;
  shippingAddress: ShippingAddress;
}

export function parseNaverProductOrderInfo(raw: unknown): NaverProductOrderInfo {
  const parsed = ProductOrderInfoSchema.parse(raw);
  const { order, productOrder, currentClaim } = parsed;
  const cancelClaimQuantity = currentClaim?.cancel?.requestQuantity;
  const address = productOrder.shippingAddress;

  return {
    orderId: order.orderId,
    productOrderId: productOrder.productOrderId,
    productOrderStatus: productOrder.productOrderStatus,
    ...(productOrder.claimStatus ? { claimStatus: productOrder.claimStatus } : {}),
    ...(productOrder.claimId != null ? { claimId: String(productOrder.claimId) } : {}),
    ...(productOrder.claimType ? { claimType: productOrder.claimType } : {}),
    ...(cancelClaimQuantity != null ? { cancelClaimQuantity } : {}),
    ...(productOrder.productId != null ? { channelProductId: String(productOrder.productId) } : {}),
    productName: productOrder.productName ?? productOrder.productOrderId,
    quantity: productOrder.quantity,
    unitPrice: productOrder.unitPrice,
    lineTotal: productOrder.totalPaymentAmount ?? productOrder.unitPrice * productOrder.quantity,
    shippingFee: productOrder.deliveryFeeAmount ?? 0,
    ...(order.paymentDate ? { paymentDate: order.paymentDate } : {}),
    shippingAddress: {
      recipientName: address?.name ?? order.ordererName ?? 'Unknown',
      phone: address?.tel1 ?? order.ordererTel ?? '',
      postalCode: address?.zipCode ?? '',
      roadAddress: address?.baseAddress ?? '',
      detailAddress: address?.detailedAddress ?? '',
    },
  };
}
