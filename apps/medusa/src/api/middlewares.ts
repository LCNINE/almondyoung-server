import { authenticate, defineMiddlewares } from '@medusajs/framework/http';
import { adminRouteMiddlewares } from './admin/middlewares';
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
  ],
});
