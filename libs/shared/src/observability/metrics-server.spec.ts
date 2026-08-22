import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Counter, Gauge, register } from 'prom-client';
import { resolveMetricsPort, startMetricsServer } from './metrics-server';

/** free TCP 포트 하나를 예약해 번호만 받고 즉시 반환한다 — 고정 포트를 spec 에 박지 않기 위함. */
async function reserveFreePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((r) => probe.close(() => r()));
  return port;
}

describe('resolveMetricsPort', () => {
  it('PORT 에 10000 을 더한다', () => {
    expect(resolveMetricsPort({ PORT: '3040' } as NodeJS.ProcessEnv)).toBe(13040);
  });

  it('METRICS_PORT 가 PORT 보다 우선한다', () => {
    expect(
      resolveMetricsPort({ PORT: '3040', METRICS_PORT: '9999' } as NodeJS.ProcessEnv),
    ).toBe(9999);
  });

  it('둘 다 없으면 undefined — 서버를 띄우지 않는다', () => {
    expect(resolveMetricsPort({} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it('PORT 가 숫자가 아니면 undefined', () => {
    expect(resolveMetricsPort({ PORT: 'nope' } as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it('METRICS_PORT 가 숫자가 아니면 미설정과 같이 취급해 PORT 로 폴백한다', () => {
    expect(
      resolveMetricsPort({ PORT: '3040', METRICS_PORT: 'nope' } as NodeJS.ProcessEnv),
    ).toBe(13040);
  });

  it('METRICS_PORT="0" 은 거부되고 PORT 로 폴백한다 — Number(\'\')===0 회귀 방지', () => {
    expect(
      resolveMetricsPort({ PORT: '3040', METRICS_PORT: '0' } as NodeJS.ProcessEnv),
    ).toBe(13040);
  });

  it('METRICS_PORT="" (빈 문자열) 도 거부되고 PORT 로 폴백한다', () => {
    expect(
      resolveMetricsPort({ PORT: '3040', METRICS_PORT: '' } as NodeJS.ProcessEnv),
    ).toBe(13040);
  });
});

describe('startMetricsServer', () => {
  let server: ReturnType<typeof startMetricsServer>;
  let port: number;

  beforeAll(async () => {
    // 전역 register 는 프로세스 단위라 다른 spec 이 먼저 등록해 뒀을 수 있다.
    register.clear();
    new Counter({
      name: 'events_dlq_messages_total',
      help: 'test fixture',
      labelNames: ['topic'],
      registers: [register],
    });

    // METRICS_PORT="0" 은 이제 거부되므로(§1 고정) free port 를 미리 예약해 넘긴다.
    const freePort = await reserveFreePort();
    server = startMetricsServer({ METRICS_PORT: String(freePort) } as NodeJS.ProcessEnv);
    if (!server) throw new Error('server did not start');
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    register.clear();
  });

  it('GET /metrics 는 200 과 Prometheus 텍스트를 준다', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/metrics`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toContain('events_dlq_messages_total');
  });

  it('그 밖의 경로는 404', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(res.status).toBe(404);
  });

  it('unref 되어 있다 — 종료 시 이벤트 루프를 붙들지 않는다', () => {
    // Node 내부 핸들. 이 서버가 태스크 종료를 지연시키지 않는다는 것을 고정한다.
    const handle = (server as unknown as { _handle?: { hasRef?: () => boolean } })._handle;
    expect(handle?.hasRef?.()).toBe(false);
  });

  it('PORT 도 METRICS_PORT 도 없으면 서버를 만들지 않는다', () => {
    expect(startMetricsServer({} as NodeJS.ProcessEnv)).toBeUndefined();
  });
});

describe('startMetricsServer — register.metrics() 실패 분기', () => {
  let server: ReturnType<typeof startMetricsServer>;
  let port: number;

  beforeAll(async () => {
    // 이 서버는 자체 register 상태를 격리하기 위해 별도 describe 에서 돈다.
    register.clear();
    // collect 훅에서 throw 하는 Gauge를 등록해 register.metrics() 를 reject 시킨다.
    new Gauge({
      name: 'test_failing_collector',
      help: 'collect 훅이 throw 하는 게이지 — register.metrics() 를 reject 시킨다',
      registers: [register],
      collect() {
        throw new Error('collector boom');
      },
    });

    const freePort = await reserveFreePort();
    server = startMetricsServer({ METRICS_PORT: String(freePort) } as NodeJS.ProcessEnv);
    if (!server) throw new Error('server did not start');
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    register.clear();
  });

  it('메트릭 수집이 실패하면 500 을 주고 한 줄 로그를 남긴다', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await fetch(`http://127.0.0.1:${port}/metrics`);
      expect(res.status).toBe(500);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(errorSpy.mock.calls[0][0] as string);
      expect(logged).toMatchObject({ level: 'error', msg: expect.any(String) });
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('startMetricsServer — 포트 충돌 시 error 이벤트', () => {
  let blocker: ReturnType<typeof createServer>;
  let blockedPort: number;

  beforeAll(async () => {
    blocker = createServer();
    await new Promise<void>((r) => blocker.listen(0, '0.0.0.0', r));
    blockedPort = (blocker.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  });

  it("이미 점유된 포트를 넘겨도 프로세스는 죽지 않고 'error' 가 로깅된다", async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    let server: ReturnType<typeof startMetricsServer>;
    try {
      server = startMetricsServer({ METRICS_PORT: String(blockedPort) } as NodeJS.ProcessEnv);
      if (!server) throw new Error('server did not start');

      await new Promise<void>((resolve) => server!.once('error', () => resolve()));

      expect(errorSpy).toHaveBeenCalled();
      const logged = JSON.parse(errorSpy.mock.calls[0][0] as string);
      expect(logged).toMatchObject({
        level: 'error',
        code: 'EADDRINUSE',
        port: blockedPort,
      });
      // 여기까지 온 것 자체가 uncaughtException 으로 프로세스가 죽지 않았다는 증거다.
    } finally {
      errorSpy.mockRestore();
      server?.close();
    }
  });
});
