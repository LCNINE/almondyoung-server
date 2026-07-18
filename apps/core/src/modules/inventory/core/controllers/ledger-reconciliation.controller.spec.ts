import { LedgerReconciliationController } from './ledger-reconciliation.controller';
import { LedgerReconciliationService, LedgerReconciliationReport } from '../services/ledger-reconciliation.service';

describe('LedgerReconciliationController', () => {
  it('쿼리 필터를 서비스에 전달하고 리포트를 반환한다', async () => {
    const report: LedgerReconciliationReport = {
      checkedAt: new Date(),
      totalDriftGrains: 0,
      criticalCount: 0,
      drifts: [],
    };
    const reconcile = jest.fn().mockResolvedValue(report);
    const service = { reconcile } as unknown as LedgerReconciliationService;
    const controller = new LedgerReconciliationController(service);

    const result = await controller.getReconciliation('wh-1', 'sku-1');

    expect(reconcile).toHaveBeenCalledWith({ warehouseId: 'wh-1', skuId: 'sku-1' });
    expect(result).toBe(report);
  });

  it('필터 없이도 동작한다', async () => {
    const report: LedgerReconciliationReport = { checkedAt: new Date(), totalDriftGrains: 0, criticalCount: 0, drifts: [] };
    const reconcile = jest.fn().mockResolvedValue(report);
    const controller = new LedgerReconciliationController({ reconcile } as unknown as LedgerReconciliationService);
    await controller.getReconciliation(undefined, undefined);
    expect(reconcile).toHaveBeenCalledWith({ warehouseId: undefined, skuId: undefined });
  });
});
