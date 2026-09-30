import type { FastifyInstance } from 'fastify';
import { ALMOND_TEMPLATE_UPSERT_BODY_LIMIT, ALMOND_TEMPLATE_UPSERT_ROUTE } from '../constants/almond-template.constants';

export function raiseAlmondTemplateUpsertBodyLimit(fastify: FastifyInstance): void {
  fastify.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (route.url === ALMOND_TEMPLATE_UPSERT_ROUTE.url && methods.includes(ALMOND_TEMPLATE_UPSERT_ROUTE.method)) {
      route.bodyLimit = ALMOND_TEMPLATE_UPSERT_BODY_LIMIT;
    }
  });
}
