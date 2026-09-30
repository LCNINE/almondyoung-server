import type { FastifyInstance } from 'fastify';
import {
  ALMOND_DESIGN_CREATE_BODY_LIMIT,
  ALMOND_DESIGN_CREATE_ROUTE,
  ALMOND_TEMPLATE_UPSERT_BODY_LIMIT,
  ALMOND_TEMPLATE_UPSERT_ROUTE,
} from '../constants/almond-template.constants';

const RAISED_ROUTES = [
  { ...ALMOND_TEMPLATE_UPSERT_ROUTE, bodyLimit: ALMOND_TEMPLATE_UPSERT_BODY_LIMIT },
  { ...ALMOND_DESIGN_CREATE_ROUTE, bodyLimit: ALMOND_DESIGN_CREATE_BODY_LIMIT },
];

export function raiseAlmondRouteBodyLimits(fastify: FastifyInstance): void {
  fastify.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const raised = RAISED_ROUTES.find((target) => route.url === target.url && methods.includes(target.method));
    if (raised) route.bodyLimit = raised.bodyLimit;
  });
}
