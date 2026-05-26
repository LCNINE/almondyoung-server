import { authenticate, defineMiddlewares } from '@medusajs/framework/http';
import { adminRouteMiddlewares } from './admin/middlewares';
import { perCustomerLimitMiddleware } from './store/carts/middlewares/per-customer-limit';

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
      matcher: '/store/carts/:id/promotions',
      method: 'POST',
      middlewares: [
        authenticate('customer', ['session', 'bearer'], { allowUnauthenticated: true }),
        perCustomerLimitMiddleware,
      ],
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
