import { validateAndTransformBody } from '@medusajs/framework';
import type { MiddlewareRoute } from '@medusajs/framework/http';
import { AdminTimeSaleWrite } from './validators';

export const adminTimeSaleRoutesMiddlewares: MiddlewareRoute[] = [
  { method: ['POST'], matcher: '/admin/time-sales', middlewares: [validateAndTransformBody(AdminTimeSaleWrite)] },
  { method: ['POST'], matcher: '/admin/time-sales/:id', middlewares: [validateAndTransformBody(AdminTimeSaleWrite)] },
];
