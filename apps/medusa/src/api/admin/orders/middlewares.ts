import { MiddlewareRoute } from '@medusajs/framework/http';
import { rejectDefaultCancelWithRefundable } from './middlewares/reject-default-cancel-with-refundable';

export const adminOrderRoutesMiddlewares: MiddlewareRoute[] = [
  {
    // method 를 주면 정확 일치로 등록된다 — /channel-cancel·/partial-cancel·/fulfillments/:fid/cancel 과 맞지 않는다(PR 6 판정 5)
    method: ['POST'],
    matcher: '/admin/orders/:id/cancel',
    middlewares: [rejectDefaultCancelWithRefundable],
  },
];
