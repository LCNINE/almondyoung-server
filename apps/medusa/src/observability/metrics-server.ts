import { createServer, Server } from 'node:http';
import { register } from 'prom-client';

/**
 * `libs/shared/src/observability/metrics-server.ts` 의 사본이다 — Medusa 는 번들러가 없어 `@app/*` 를
 * 런타임에 해석하지 못한다(같은 이유로 `@packages/*` 도 못 쓴다, ADR-0033 §7). 원본이 바뀌면 여기도 손본다.
 *
 * 메트릭 포트 = 앱 포트 + 10000. Medusa 는 Dockerfile 이 `PORT=9000` 을 박으므로 19000 이고, Alloy 의
 * `prometheus.scrape "medusa"` 가 그 숫자를 리터럴로 안다.
 */
export function resolveMetricsPort(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const explicit = Number(env.METRICS_PORT);
  // 빈 문자열은 Number('') === 0 이라 `>= 0` 로 두면 폴백을 건너뛰고 OS 임의 포트에 붙는다 — Alloy 는 고정
  // 포트만 긁으므로 영구 up=0 이 되고 로그에 단서가 없다. `> 0` 이어야 한다 (#613 리뷰).
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  const appPort = Number(env.PORT);
  if (!Number.isInteger(appPort) || appPort <= 0) return undefined;
  return appPort + 10000;
}

function logError(msg: string, extra?: Record<string, unknown>): void {
  console.error(
    JSON.stringify({ level: 'error', service_name: 'medusa-metrics-server', time: new Date().toISOString(), msg, ...extra }),
  );
}

/**
 * Prometheus 스크레이프용 최소 HTTP 서버. Medusa 의 라우트 로더·미들웨어 밖이고, Medusa 의 `instrument.http` 는
 * 라우트 레이어 자체 계측이라 이 서버는 trace 를 만들지 않는다(스펙 §2 ⑥).
 *
 * ALB 는 앱 포트만 포워딩하고 태스크는 private subnet 이라 이 포트에 인터넷 경로가 없다 — 인증 가드 없음.
 */
export function startMetricsServer(env: NodeJS.ProcessEnv = process.env): Server | undefined {
  const port = resolveMetricsPort(env);
  if (port === undefined) return undefined;

  const server = createServer((req, res) => {
    if (req.url !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    register
      .metrics()
      .then((body) => {
        res.writeHead(200, { 'Content-Type': register.contentType });
        res.end(body);
      })
      .catch((err: unknown) => {
        logError('메트릭 수집 실패', { error: err instanceof Error ? err.message : String(err) });
        res.writeHead(500).end();
      });
  });

  // 리스너 없는 'error' 는 Node 가 throw 한다. 이 함수는 instrumentation.ts 에서 앱 부팅 전에 돌므로
  // EADDRINUSE 를 그대로 두면 uncaughtException 으로 프로세스가 죽는다 — 관측 실패가 가용성 실패로 승격된다.
  server.on('error', (err: NodeJS.ErrnoException) => {
    logError('메트릭 서버 바인딩 실패 — 프로세스는 계속 실행된다', { port, code: err.code, error: err.message });
  });

  server.listen(port, '0.0.0.0');
  server.unref();
  return server;
}
