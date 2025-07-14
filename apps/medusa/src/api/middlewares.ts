import {
  defineMiddlewares,
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from '@medusajs/framework/http';
import { responseWrapper } from '../middlewares/response-wrapper';

export default defineMiddlewares({
  routes: [
    {
      matcher: '/*',
      middlewares: [responseWrapper],
    },
  ],
});
