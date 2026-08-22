import { register } from 'prom-client';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  beforeEach(() => {
    // 전역 register 는 프로세스 단위다. 같은 프로세스의 다른 spec 이 등록해 뒀으면
    // 필드 이니셜라이저에서 중복 등록 throw 가 난다.
    register.clear();
  });

  afterAll(() => {
    register.clear();
  });

  it('한 번의 상세 헬스체크에서 컴포넌트 3개를 기록해도 throw 하지 않는다', () => {
    const service = new MetricsService();

    // health.service.ts 는 상세 체크 한 번에 세 컴포넌트를 기록한다.
    // 게이지를 recordHealthCheck 안에서 만들던 시절엔 2번째에서 중복 등록으로 throw 했다.
    expect(() => {
      service.recordHealthCheck('database', 'healthy', 5);
      service.recordHealthCheck('memory', 'healthy', 3);
      service.recordHealthCheck('business', 'unhealthy', 10);
    }).not.toThrow();
  });

  it('기록한 헬스 게이지가 전역 register 에 나타난다', async () => {
    const service = new MetricsService();
    service.recordHealthCheck('database', 'healthy', 5);

    await expect(register.metrics()).resolves.toContain('wms_health_status');
  });
});
