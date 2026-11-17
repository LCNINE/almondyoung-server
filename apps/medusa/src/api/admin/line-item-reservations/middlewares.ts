import { validateAndTransformBody, validateAndTransformQuery } from '@medusajs/framework';
import type { MiddlewareRoute } from '@medusajs/framework/http';
import { AdminListLineItemReservations, AdminSetLineItemReservations } from './validators';

export const adminLineItemReservationRoutesMiddlewares: MiddlewareRoute[] = [
  {
    method: ['POST'],
    matcher: '/admin/line-item-reservations',
    middlewares: [validateAndTransformBody(AdminSetLineItemReservations)],
  },
  {
    method: ['GET'],
    matcher: '/admin/line-item-reservations',
    middlewares: [validateAndTransformQuery(AdminListLineItemReservations, {})],
  },
];
