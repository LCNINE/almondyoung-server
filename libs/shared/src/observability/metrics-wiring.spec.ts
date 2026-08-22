import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// @app/events 를 쓰는 앱 전부. file-service 는 events 미사용이라 제외한다.
const APPS = [
  'core',
  'wallet',
  'membership',
  'notification',
  'analytics',
  'search',
  'channel-adapter',
  'ugc-service',
  'user-service',
];

describe('metrics 서버 배선', () => {
  it.each(APPS)('%s 의 tracing.ts 가 startMetricsServer 를 부른다', (app) => {
    const source = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'apps', app, 'src', 'tracing.ts'),
      'utf8',
    );

    // 배럴(@app/shared)을 당기면 OTEL SDK 시작 전에 다른 모듈이 로드된다.
    expect(source).toContain("from '@app/shared/observability/metrics-server'");
    expect(source).not.toContain("from '@app/shared'");
    // 실제 호출이 있어야 한다 (import만 있고 호출이 주석 처리된 경우를 잡음).
    expect(source).toMatch(/^\s*startMetricsServer\(\);\s*$/m);
  });
});
