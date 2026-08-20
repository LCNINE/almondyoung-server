import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import type {
  ICustomerModuleService,
  ICartModuleService,
  CustomerAddressDTO,
  CartAddressDTO,
  CartDTO,
} from '@medusajs/framework/types';
import type { MedusaContainer } from '@medusajs/framework';


type CartData = Pick<CartDTO, 'id' | 'customer_id' | 'shipping_address' | 'metadata'>;

// 고객 메타데이터 타입 (커스텀 필드 정의)
interface CustomerMetadata {
  default_shipping_memo_type?: string;
  default_shipping_memo_custom?: string;
  default_entrance_password?: string;
  default_has_entrance?: boolean;
  [key: string]: unknown;
}

/**
 * 배송지 주소가 유효한지 확인
 */
export function isValidAddress(address: CartAddressDTO | null | undefined): boolean {
  if (!address) return false;
  const hasName = !!(address.first_name || address.last_name);
  const hasAddress = !!(address.province || address.city || address.address_1 || address.address_2);
  const hasPhone = !!address.phone;
  return hasName || hasAddress || hasPhone;
}

/**
 * 카트에 기본 배송지와 배송 메모를 자동으로 채움
 *
 * @returns 카트가 업데이트되었으면 true, 아니면 false
 */
export async function autoFillShipping(container: MedusaContainer, cart: CartData): Promise<boolean> {
  if (!cart.customer_id) return false;

  const needsAddress = !isValidAddress(cart.shipping_address);
  const needsMemo = !cart.metadata?.shipping_memo_type;

  //  둘 다 이미 있으면 쿼리 없이 종료
  if (!needsAddress && !needsMemo) return false;

  const query = container.resolve<any>(ContainerRegistrationKeys.QUERY);
  const customerService = container.resolve<ICustomerModuleService>(Modules.CUSTOMER);
  const cartService = container.resolve<ICartModuleService>(Modules.CART);

  const updates: {
    shipping_address?: {
      first_name: string;
      last_name: string;
      phone: string;
      province: string;
      city: string;
      address_1: string;
      address_2: string;
      postal_code: string;
      country_code: string;
    };
    metadata?: Record<string, unknown>;
  } = {};
  let needsUpdate = false;

  // 필요한 쿼리만 병렬 실행
  const [addresses, customerData] = await Promise.all([
    // 주소 조회
    needsAddress
      ? customerService.listCustomerAddresses({ customer_id: cart.customer_id }).catch(() => [])
      : Promise.resolve([]),
    // 고객 메타데이터 조회 
    needsMemo
      ? query
        .graph({
          entity: 'customer',
          fields: ['metadata'],
          filters: { id: cart.customer_id },
        })
        .then((res: any) => res.data?.[0])
        .catch(() => null)
      : Promise.resolve(null),
  ]);

  // === 1. 배송지 자동 채우기 ===
  if (needsAddress && addresses?.length) {
    const defaultAddress: CustomerAddressDTO =
      addresses.find((addr: CustomerAddressDTO) => addr.is_default_shipping) ?? addresses[0];

    updates.shipping_address = {
      first_name: defaultAddress.first_name ?? '',
      last_name: defaultAddress.last_name ?? '',
      phone: defaultAddress.phone ?? '',
      province: defaultAddress.province ?? '',
      city: defaultAddress.city ?? '',
      address_1: defaultAddress.address_1 ?? '',
      address_2: defaultAddress.address_2 ?? '',
      postal_code: defaultAddress.postal_code ?? '',
      country_code: defaultAddress.country_code ?? 'kr',
    };
    updates.metadata = { shipping_address_name: defaultAddress.address_name ?? null };
    needsUpdate = true;
  }

  // === 2. 배송 메모 자동 채우기 ===
  //
  // ⚠️ 여기서 나르는 것은 배송메모 **유형**뿐이다 — `entrance_password` 는 절대 나르지 않는다.
  // 고객이 이번 세션에서 다시 입력하지 않은 크리덴셜을 새 카트에 실어주면, 그 카트가 주문이 될
  // 때 14일 보관 시계가 처음부터 다시 간다. 주문을 반복하는 고객의 비번은 그렇게 영원히
  // 살아남고, 결제 화면이 약속한 "늦어도 주문일로부터 14일 이내 삭제"가 거짓이 된다.
  // **보관 상한을 실제로 상한이게 만드는 지점이 바로 이 누락이다.** 고객 기본값 분기든 마지막
  // 주문 폴백이든 마찬가지이며, 비번은 고객이 체크아웃에서 직접 입력할 때만 카트에 들어온다.
  if (needsMemo) {
    const customerMetadata = customerData?.metadata as CustomerMetadata | undefined;
    const defaultMemoType = customerMetadata?.default_shipping_memo_type;

    if (defaultMemoType) {
      // customer 기본 프로필에 기본 배송 메모가 있으면 사용
      updates.metadata = {
        ...(updates.metadata ?? {}),
        shipping_memo_type: defaultMemoType,
        shipping_memo_custom: customerMetadata?.default_shipping_memo_custom ?? '',
        // `default_entrance_password` 는 의도적으로 읽지 않는다 — 위 주석 참고.
        has_entrance: customerMetadata?.default_has_entrance ?? false,
      };
      needsUpdate = true;
    } else {
      // 마지막 주문의 배송 메모 조회 
      try {
        const { data: orders } = await query.graph({
          entity: 'order',
          fields: ['metadata'],
          filters: { customer_id: cart.customer_id },
          pagination: { order: { created_at: 'DESC' }, take: 1 },
        });

        const latestOrderMemo = orders?.[0]?.metadata?.shipping_memo_type;
        if (latestOrderMemo) {
          updates.metadata = {
            ...(updates.metadata ?? {}),
            shipping_memo_type: latestOrderMemo,
            shipping_memo_custom: orders[0].metadata?.shipping_memo_custom ?? '',
            // 마지막 주문의 `entrance_password` 도 읽지 않는다 — 위 주석 참고.
            has_entrance: orders[0].metadata?.has_entrance ?? false,
          };
          needsUpdate = true;
        }
      } catch {
        // 주문 조회 실패해도 무시
      }
    }
  }

  // === 3. 카트 업데이트 ===
  if (needsUpdate) {
    try {
      // Medusa 는 metadata 를 머지하지 않고 통째로 교체한다. 기존 metadata 를 spread 해서
      // 자동 채우기가 다른 키(특히 shipping_memo_*)를 날리지 않도록 보존한다.
      const mergedMetadata = updates.metadata
        ? { ...(cart.metadata ?? {}), ...updates.metadata }
        : undefined;
      await cartService.updateCarts([
        { id: cart.id, ...updates, ...(mergedMetadata ? { metadata: mergedMetadata } : {}) },
      ]);
      return true;
    } catch (err) {
      console.error('[autoFillShipping] Failed to update cart:', err);
      return false;
    }
  }

  return false;
}
