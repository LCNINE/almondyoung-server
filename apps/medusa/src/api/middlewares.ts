import { authenticate, defineMiddlewares } from '@medusajs/framework/http';
// import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { adminRouteMiddlewares } from './admin/middlewares';

// 멤버십 전용 상품 필터 미들웨어
// - 비멤버(비로그인 포함) 에게는 metadata.isMembershipOnly=true 상품을 DB 쿼리 레벨에서 제외
// const membershipProductFilterMiddleware = async (
//   req: any,
//   res: any,
//   next: any,
// ) => {
//   const membershipGroupId = process.env.MEDUSA_MEMBERSHIP_GROUP_ID;
//   if (!membershipGroupId) {
//     return next();
//   }

//   // 인증된 고객이면 멤버십 그룹 여부 확인
//   let isMember = false;
//   const customerId = req.auth_context?.actor_id;
//   if (customerId) {
//     try {
//       const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
//       const { data: customers } = await query.graph({
//         entity: 'customer',
//         fields: ['id', 'groups.id'],
//         filters: { id: customerId },
//       });
//       isMember =
//         customers?.[0]?.groups?.some(
//           (g: any) => g.id === membershipGroupId,
//         ) ?? false;
//     } catch {
//       // 조회 실패 시 비멤버로 처리
//     }
//   }

//   // 멤버는 필터 없이 그대로 통과
//   if (isMember) {
//     return next();
//   }

//   // 비멤버: req.filterableFields에 필터를 추가해 DB 쿼리 자체에서 멤버십 전용 상품 제외
//   // Medusa의 query.graph/query.index가 req.filterableFields를 그대로 사용하므로
//   // count 포함 정확한 필터링이 가능
//   req.filterableFields = {
//     ...req.filterableFields,
//     metadata: {
//       ...req.filterableFields?.metadata,
//       isMembershipOnly: { $nin: [true, 'true'] },
//     },
//   };

//   next();
// };

// 프로파일링용 타이밍 미들웨어
const timingMiddleware = (req: any, res: any, next: any) => {
  const start = Date.now();
  const path = req.path;
  const method = req.method;

  res.on('finish', () => {
    const duration = Date.now() - start;
    // 300ms 이상 걸리는 요청만 로깅 (눈에 띄게 느린 요청)
    if (duration > 300) {
      console.log(
        `[SLOW] ${method} ${path} - ${duration}ms (status: ${res.statusCode})`,
      );
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
    // 멤버십 전용 상품 필터: 비멤버에게는 isMembershipOnly=true 상품 노출 안 함
    // {
    //   matcher: '/store/products*',
    //   middlewares: [
    //     authenticate('customer', ['session', 'bearer'], {
    //       allowUnauthenticated: true,
    //     }),
    //     // membershipProductFilterMiddleware,
    //   ],
    // },
    // TODO: 401 디버깅용
    // {
    //   matcher: '/store/customers/me',
    //   middlewares: [debugAuthMiddleware],
    // },
    {
      matcher: '/store/customers/me/promotions',
      middlewares: [authenticate('customer', ['session', 'bearer'])],
    },
    {
      matcher: '/store/customers/me/cart',
      middlewares: [authenticate('customer', ['session', 'bearer'])],
    },
    {
      matcher: '/store/orders/:id/confirm-purchase',
      middlewares: [authenticate('customer', ['session', 'bearer'])],
    },
  ],
});
