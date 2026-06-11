import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { InspectionService } from './inspection.service';
import { BarcodeService } from '../../inventory/shared/services/barcode.service';
import { wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';

/**
 * resolveFoiFromBarcode — 검수 스캔 바코드 → 세션 내 FOI 식별.
 * QA7-C 결함 회귀: skuCode(P00008 등) 스캔 시 "Unsupported barcode" 400 이 났던 케이스.
 * 피킹(pickByBarcodeScan)과 동일하게 unknown 타입을 skus.code 매칭으로 폴백해야 한다.
 */
describe('InspectionService.resolveFoiFromBarcode', () => {
  // select().from().innerJoin().where().limit() 어디서 끊겨도 awaitable 한 체인 mock
  function buildTrx(rows: unknown[]) {
    const chain: Record<string, unknown> = {};
    const next = jest.fn().mockReturnValue(chain);
    for (const method of ['from', 'innerJoin', 'where', 'limit', 'orderBy']) {
      chain[method] = next;
    }
    chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      Promise.resolve(rows).then(resolve, reject);
    return { select: jest.fn(() => chain) };
  }

  function buildService() {
    // parseBarcode 는 순수 함수라 DbService 를 실제로 쓰지 않음 — 빈 stub 주입 (spec 한정 캐스팅)
    const dbStub = {} as DbService<typeof wmsSchema>;
    return new InspectionService(dbStub, new BarcodeService(dbStub));
  }

  const resolve = (service: InspectionService, barcode: string, trx: unknown) =>
    service['resolveFoiFromBarcode'](barcode, 'session-1', trx as DbTx);

  it('skuCode 바코드(unknown 타입)를 세션 내 SKU 코드 매칭으로 폴백한다', async () => {
    const service = buildService();
    const trx = buildTrx([
      { foiId: 'foi-done', pickedQty: 2, inspectedQty: 2 },
      { foiId: 'foi-open', pickedQty: 2, inspectedQty: 0 },
    ]);

    // 미완료(검수 여지 있는) FOI 우선
    await expect(resolve(service, 'P00008', trx)).resolves.toBe('foi-open');
  });

  it('전 FOI 검수 완료 상태면 첫 매칭 FOI 로 폴백한다 (초과 스캔은 inspectItem 단에서 검증)', async () => {
    const service = buildService();
    const trx = buildTrx([{ foiId: 'foi-done', pickedQty: 2, inspectedQty: 2 }]);

    await expect(resolve(service, 'P00008', trx)).resolves.toBe('foi-done');
  });

  it('세션에 매칭되는 SKU 코드가 없으면 NotFound', async () => {
    const service = buildService();
    const trx = buildTrx([]);

    await expect(resolve(service, 'P99999', trx)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('SKU-{uuid} 바코드는 기존 skuId 매칭 경로를 유지한다', async () => {
    const service = buildService();
    const trx = buildTrx([{ foiId: 'foi-1', pickedQty: 1, inspectedQty: 0 }]);

    await expect(resolve(service, 'SKU-11111111-1111-1111-1111-111111111111', trx)).resolves.toBe('foi-1');
  });

  it('검수 대상이 될 수 없는 바코드 타입(LOC-)은 여전히 BadRequest', async () => {
    const service = buildService();
    const trx = buildTrx([]);

    await expect(resolve(service, 'LOC-A-01-01', trx)).rejects.toBeInstanceOf(BadRequestException);
  });
});
