import { authenticate, defineMiddlewares } from '@medusajs/framework/http';
import { validateAndTransformQuery } from '@medusajs/framework';
import { adminRouteMiddlewares } from './admin/middlewares';
import { listTransformQueryConfig as ordersListQueryConfig } from './store/orders-list/query-config';
import { StoreGetOrdersListParams } from './store/orders-list/validators';
import { perCustomerLimitMiddleware } from './store/carts/middlewares/per-customer-limit';
import { rejectAwaitingDepositCompleteMiddleware } from './store/carts/middlewares/reject-awaiting-deposit-complete';
import { membershipPriceVisibilityMiddleware } from './store/products/middlewares/membership-price-visibility';

// 멤버십가 표시 정책: 비회원 응답에서 멤버십가 metadata만 제거한다 (상품 숨김 아님).
// authenticate(allowUnauthenticated)로 로그인 고객의 auth_context를 채운 뒤 멤버 여부를 판별한다.
const membershipPriceVisibilityMiddlewares = [
  authenticate('customer', ['session', 'bearer'], { allowUnauthenticated: true }),
  membershipPriceVisibilityMiddleware,
];

// 프로파일링용 타이밍 미들웨어
const timingMiddleware = (req: any, res: any, next: any) => {
  const start = Date.now();
  const path = req.originalUrl || req.url;
  const method = req.method;

  res.on('finish', () => {
    const duration = Date.now() - start;
    // 300ms 이상 걸리는 요청만 로깅 (눈에 띄게 느린 요청)
    if (duration > 300) {
      console.log(`[SLOW] ${method} ${path} - ${duration}ms (status: ${res.statusCode})`);
    }
  });

  next();
};

export default defineMiddlewares({
  routes: [
    // 모든 요청에 타이밍 미들웨어 적용
    {
      matcher: '/*',
      middlewares: [timingMiddleware],
    },
    ...adminRouteMiddlewares,
    {
      matcher: '/store/products',
      method: 'GET',
      middlewares: membershipPriceVisibilityMiddlewares,
    },
    {
      matcher: '/store/products/:id',
      method: 'GET',
      middlewares: membershipPriceVisibilityMiddlewares,
    },
    {
      matcher: '/store/products-sorted',
      method: 'GET',
      middlewares: membershipPriceVisibilityMiddlewares,
    },
    // assigned_only/claimable 게이트는 promo_codes 를 받는 모든 카트 경로에 걸어야 한다.
    // 기본 Medusa 의 POST /store/carts(create) 와 POST /store/carts/:id(update) 도
    // body.promo_codes 를 updateCartPromotionsWorkflow 로 적용하므로, /promotions 만
    // 막으면 카트 생성/수정 시점에 미할당 쿠폰을 붙여 게이트를 우회할 수 있다.
    {
      matcher: '/store/carts',
      method: 'POST',
      middlewares: [
        authenticate('customer', ['session', 'bearer'], { allowUnauthenticated: true }),
        perCustomerLimitMiddleware,
      ],
    },
    {
      matcher: '/store/carts/:id',
      method: 'POST',
      middlewares: [
        authenticate('customer', ['session', 'bearer'], { allowUnauthenticated: true }),
        perCustomerLimitMiddleware,
      ],
    },
    {
      matcher: '/store/carts/:id/promotions',
      method: 'POST',
      middlewares: [
        authenticate('customer', ['session', 'bearer'], { allowUnauthenticated: true }),
        perCustomerLimitMiddleware,
      ],
    },
    {
      // 무통장 입금대기 intent 의 cart 를 HTTP 로 complete 하는 경로를 막는다(미입금 출고 방지).
      // 정상 무통장 주문은 wallet 웹훅이 in-process 로 선생성하므로 이 라우트를 거치지 않는다.
      matcher: '/store/carts/:id/complete',
      method: 'POST',
      middlewares: [rejectAwaitingDepositCompleteMiddleware],
    },
    {
      matcher: '/store/coupons/preview',
      method: 'GET',
      middlewares: [
        authenticate('customer', ['session', 'bearer'], { allowUnauthenticated: true }),
      ],
    },
    {
      matcher: '/store/events/:slug',
      method: 'GET',
      middlewares: [
        authenticate('customer', ['session', 'bearer'], { allowUnauthenticated: true }),
      ],
    },
    {
      matcher: '/store/customers/me/promotions',
      middlewares: [authenticate('customer', ['session', 'bearer'])],
    },
    {
      matcher: '/store/customers/me/promotions/:id/claim',
      method: 'POST',
      middlewares: [authenticate('customer', ['session', 'bearer'])],
    },
    {
      matcher: '/store/customers/me/cart',
      middlewares: [authenticate('customer', ['session', 'bearer'])],
    },
    {
      matcher: '/store/customers/me/refresh-cart-prices',
      middlewares: [authenticate('customer', ['session', 'bearer'])],
    },
    {
      matcher: '/store/orders/:id/confirm-purchase',
      middlewares: [authenticate('customer', ['session', 'bearer'])],
    },
    {
      // 커스텀 주문 목록(기간 필터 지원) — 본인 주문만 조회 가능하도록 인증 필수.
      // validateAndTransformQuery(확장 validator)로 created_at 을 허용하고 fields 를 정규화한다.
      matcher: '/store/orders-list',
      method: 'GET',
      middlewares: [
        authenticate('customer', ['session', 'bearer']),
        validateAndTransformQuery(StoreGetOrdersListParams, ordersListQueryConfig),
      ],
    },
  ],
});
