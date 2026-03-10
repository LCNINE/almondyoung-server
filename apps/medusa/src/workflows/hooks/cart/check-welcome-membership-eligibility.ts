import { addToCartWorkflow } from '@medusajs/medusa/core-flows';
import { Modules } from '@medusajs/framework/utils';

/**
 * 웰컴 멤버십 상품 구매 자격 검증 훅
 *
 * 장바구니에 상품 추가 시:
 * 1. 추가되는 variant가 웰컴 멤버십 상품인지 확인 (product tag: "welcome-membership")
 * 2. 웰컴 멤버십 상품이면 고객 로그인 여부 및 구매 자격 확인
 * 3. 자격 없으면 에러 반환
 *
 * 웰컴 멤버십 상품 태그 설정:
 *   Medusa Admin → Products → 해당 상품 → Organize → Tags에 "welcome-membership" 추가
 *
 * 환경변수:
 *   MEMBERSHIP_SERVICE_URL: 멤버십 서비스 base URL (예: http://localhost:3040)
 */

const MEMBERSHIP_SERVICE_URL =
  process.env.MEMBERSHIP_SERVICE_URL || 'http://localhost:3040';

const WELCOME_MEMBERSHIP_TAG = 'welcome-membership';

addToCartWorkflow.hooks.validate(
  async ({ input }, { container }) => {
    const items = input.items;
    if (!items || items.length === 0) return;

    const variantIds = items
      .map((item) => item.variant_id)
      .filter((id): id is string => !!id);

    if (variantIds.length === 0) return;

    // 상품 모듈에서 variant → product → tags 조회
    const productModule = container.resolve(Modules.PRODUCT);
    const variants = await productModule.listProductVariants(
      { id: variantIds },
      { relations: ['product', 'product.tags'] },
    );

    const hasWelcomeMembershipItem = variants.some((variant) => {
      const tags: Array<{ value: string }> = (variant as any).product?.tags ?? [];
      return tags.some((tag) => tag.value === WELCOME_MEMBERSHIP_TAG);
    });

    if (!hasWelcomeMembershipItem) return;

    // 웰컴 멤버십 상품이 포함되어 있음 → 고객 자격 확인
    const cartModule = container.resolve(Modules.CART);
    const cart = await cartModule.retrieveCart(input.cart_id, {
      select: ['customer_id'],
    });

    if (!cart?.customer_id) {
      throw new Error(
        '웰컴 멤버십 상품은 로그인 후 구매하실 수 있습니다.',
      );
    }

    // Medusa customer → almond user_id 매핑
    const customerModule = container.resolve(Modules.CUSTOMER);
    const customer = await customerModule.retrieveCustomer(cart.customer_id, {
      select: ['metadata'],
    });
    const userId = (customer?.metadata as Record<string, unknown> | null)?.almond_user_id as string | undefined;

    if (!userId) {
      // almond_user_id 없으면 fail-open (연동 안 된 계정)
      console.warn('[WelcomeMembership] customer has no almond_user_id, failing open');
      return;
    }

    // 멤버십 서비스에 자격 확인 요청
    let eligible = true;
    let reason: string | undefined;
    try {
      const response = await fetch(
        `${MEMBERSHIP_SERVICE_URL}/welcome-membership/eligibility/${userId}`,
        { signal: AbortSignal.timeout(5000) },
      );

      if (response.ok) {
        const data = (await response.json()) as { eligible: boolean; reason?: string };
        eligible = data.eligible;
        reason = data.reason;
      } else {
        // 서비스 오류 시 구매 허용 (fail-open: 서비스 다운으로 고객 차단 방지)
        console.warn(
          `[WelcomeMembership] eligibility check failed (${response.status}), failing open`,
        );
      }
    } catch (err) {
      // 네트워크 오류 시 구매 허용 (fail-open)
      console.warn(
        `[WelcomeMembership] eligibility check error, failing open:`,
        err,
      );
    }

    if (!eligible) {
      if (reason === 'not_a_member') {
        throw new Error('웰컴 멤버십 상품은 멤버십 회원만 구매하실 수 있습니다.');
      }
      throw new Error('웰컴 멤버십 상품은 1회만 구매 가능합니다. 이미 구매 이력이 있습니다.');
    }
  },
);
