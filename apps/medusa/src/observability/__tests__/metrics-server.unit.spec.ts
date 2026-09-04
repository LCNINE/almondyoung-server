import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolveMetricsPort, startMetricsServer } from '../metrics-server';

/**
 * `libs/shared/src/observability/metrics-server.spec.ts` 의 `reserveFreePort()` 사본이다 — free TCP
 * 포트 하나를 예약해 번호만 받고 즉시 반환한다. `process.pid % 1000` 같은 고정 산식은 이 머신의 다른
 * 프로세스와 충돌할 수 있다(#775 리뷰 — 실측 EADDRINUSE 2건, `:40742`·`:40782`).
 */
async function reserveFreePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((r) => probe.close(() => r()));
  return port;
}

describe('resolveMetricsPort — #613 의 교훈 셋', () => {
  it('METRICS_PORT 가 양의 정수면 그것', () => {
    expect(resolveMetricsPort({ METRICS_PORT: '19999', PORT: '9000' })).toBe(19999);
  });
  it('빈 문자열(Number("")===0)·NaN·0 은 미설정 → PORT+10000', () => {
    expect(resolveMetricsPort({ METRICS_PORT: '', PORT: '9000' })).toBe(19000);
    expect(resolveMetricsPort({ METRICS_PORT: 'abc', PORT: '9000' })).toBe(19000);
    expect(resolveMetricsPort({ METRICS_PORT: '0', PORT: '9000' })).toBe(19000);
  });
  it('PORT 도 없으면 undefined (서버를 안 띄운다)', () => {
    expect(resolveMetricsPort({})).toBeUndefined();
  });
});

describe('startMetricsServer', () => {
  it('/metrics 를 prom 텍스트로 답하고, 다른 경로는 404', async () => {
    const freePort = await reserveFreePort();
    const server = startMetricsServer({ METRICS_PORT: String(freePort) })!;
    await once(server, 'listening');
    const { port } = server.address() as { port: number };
    const ok = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('text/plain');
    const nf = await fetch(`http://127.0.0.1:${port}/health`);
    expect(nf.status).toBe(404);
    server.close();
  });

  it('바인딩 실패는 던지지 않는다 — 관측 실패는 가용성 실패가 아니다', async () => {
    const freePort = await reserveFreePort();
    const first = startMetricsServer({ METRICS_PORT: String(freePort) })!;
    await once(first, 'listening');
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const second = startMetricsServer({ METRICS_PORT: String(freePort) })!;
    await once(second, 'error');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('메트릭 서버 바인딩 실패'));
    errorSpy.mockRestore();
    first.close();
  });
});
