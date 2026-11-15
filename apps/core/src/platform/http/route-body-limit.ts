import type { FastifyInstance } from 'fastify';

/** 입고리스트 업로드(2,000행 × 8열 ≈ 1 MB)가 Fastify 기본 1 MiB 에 걸린다. admin-web 프록시 상한(≈4.7 MB) 아래로 4 MiB. */
export const INBOUND_SHIPMENT_UPLOAD_BODY_LIMIT = 4 * 1024 * 1024;

/** 이 라우트 하나만 본문 상한을 올린다 — 전역으로 올리면 모든 라우트의 인증 전 파싱 비용이 커진다. 라우트 등록 전에 불러야 한다. */
export function raiseBodyLimitForInboundShipmentUpload(app: Pick<FastifyInstance, 'addHook'>): void {
  app.addHook('onRoute', (route) => {
    if (route.url === '/inventory/inbound-shipments' && route.method === 'POST') {
      route.bodyLimit = INBOUND_SHIPMENT_UPLOAD_BODY_LIMIT;
    }
  });
}
