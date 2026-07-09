import { register } from 'prom-client';
import { MetricsService } from './metrics.service';

describe('MetricsService.setLedgerDrift', () => {
  let metrics: MetricsService;

  beforeEach(() => {
    // 전역 레지스트리를 비워 다른 스펙과의 중복 등록 충돌을 막는다.
    register.clear();
    metrics = new MetricsService();
  });

  it('두 severity 라벨을 모두 게이지에 기록한다', async () => {
    metrics.setLedgerDrift({ mismatch: 2, critical: 1 });
    const out = await metrics.getMetrics();
    expect(out).toContain('wms_ledger_drift_grains{severity="MISMATCH"} 2');
    expect(out).toContain('wms_ledger_drift_grains{severity="CRITICAL"} 1');
  });

  it('정상(0 drift) 실행도 0 을 명시적으로 기록한다', async () => {
    metrics.setLedgerDrift({ mismatch: 0, critical: 0 });
    const out = await metrics.getMetrics();
    expect(out).toContain('wms_ledger_drift_grains{severity="MISMATCH"} 0');
    expect(out).toContain('wms_ledger_drift_grains{severity="CRITICAL"} 0');
  });
});
