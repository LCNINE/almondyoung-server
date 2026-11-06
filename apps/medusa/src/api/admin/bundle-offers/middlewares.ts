import { validateAndTransformBody } from '@medusajs/framework';
import type { MiddlewareRoute } from '@medusajs/framework/http';
import { AdminBundleOfferSync } from './products/[id]/validators';

export const adminBundleOfferRoutesMiddlewares: MiddlewareRoute[] = [
  {
    method: ['POST'],
    matcher: '/admin/bundle-offers/products/:id',
    middlewares: [validateAndTransformBody(AdminBundleOfferSync)],
  },
];
