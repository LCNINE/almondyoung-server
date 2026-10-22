import { Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { FulfillmentsController } from './fulfillments.controller';
import { ShipmentPlanningController } from './shipment-planning.controller';

/**
 * K6 PR4 — 판매주문 기록 없이 상태만 바꾸던 관리자 라우트는 지워졌다(스펙 §8 D1·D10·D11).
 * 취소는 판매주문 취소로만, 배송은 추적으로만 기록된다. 되살아나면 여기서 빨갛다.
 */
function routesOf(controller: Type): string[] {
  const proto = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
    .flatMap((name) => {
      const handler = proto[name] as object;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      return path === undefined || method === undefined ? [] : [`${RequestMethod[method]} ${path}`];
    });
}

describe('K6 PR4 — 판매주문 기록을 우회하던 관리자 라우트는 없다 (D1·D10·D11)', () => {
  it('ShipmentPlanningController 에 POST :id/cancellations 가 없다 (D1)', () => {
    expect(routesOf(ShipmentPlanningController)).not.toContain('POST :id/cancellations');
    // 헬퍼가 실제로 라우트를 읽는지 — 남는 라우트 하나로 확인
    expect(routesOf(ShipmentPlanningController)).toContain('GET :id');
  });

  it('FulfillmentsController 에 POST :id/cancel·POST :id/deliver 가 없다 (D10·D11)', () => {
    const routes = routesOf(FulfillmentsController);
    expect(routes).not.toContain('POST :id/cancel');
    expect(routes).not.toContain('POST :id/deliver');
    expect(routes).toContain('GET :id/outbox-events');
  });
});
