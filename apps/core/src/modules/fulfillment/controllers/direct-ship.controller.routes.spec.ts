import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { DirectShipController } from './direct-ship.controller';

/**
 * /direct-ship 의 라우트는 입점사 상자 경로 10개뿐이다 — 옛 FO 단위 직배 라우트가
 * 다시 생기면 이 목록이 깨진다.
 */
describe('DirectShipController routes', () => {
  it('라우트는 입점사 상자 경로 10개뿐이다', () => {
    const proto = DirectShipController.prototype as unknown as Record<string, unknown>;
    const routes = new Set<string>();
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      const handler = proto[name];
      if (typeof handler !== 'function') continue;
      const path = Reflect.getMetadata(PATH_METADATA, handler);
      const method = Reflect.getMetadata(METHOD_METADATA, handler);
      if (path === undefined || method === undefined) continue;
      routes.add(`${RequestMethod[method]} ${path}`);
    }
    expect(routes).toEqual(
      new Set([
        'GET supplier-queue',
        'GET supplier-queue/:supplierId/shipments',
        'GET suppliers/:supplierId/handoffs',
        'POST suppliers/:supplierId/handoffs',
        'GET handoffs/:handoffId/sheet',
        'POST suppliers/:supplierId/uploads/preview',
        'POST suppliers/:supplierId/uploads/apply',
        'GET cancel-notices',
        'POST cancel-notices/export/file',
        'POST cancel-notices/notified',
      ]),
    );
  });
});
