import { createServer, Server } from 'node:http';
import { register } from 'prom-client';

/**
 * 메트릭 포트를 앱 포트에서 파생한다.
 *
 * 앱 포트는 한 ECS 태스크 안에서 이미 유일하다 (ALB 룰이 강제하고, 번들 태스크는
 * `supervisor.mjs` 의 APPS 테이블이 강제한다). 그래서 `+10000` 파생 포트도 자동으로
 * 유일하고, 앱마다 별도 env 를 심을 필요가 없다.
 */
export function resolveMetricsPort(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const explicit = Number(env.METRICS_PORT);
  // METRICS_PORT 파싱 불가 값(NaN)은 미설정과 동일하게 취급한다 — Nest 부팅 전에
  // 도는 경로라 throw 하면 선택적 env 오타 하나가 전체 서비스를 불가로 만든다.
  if (Number.isInteger(explicit) && explicit >= 0) return explicit;

  const appPort = Number(env.PORT);
  if (!Number.isInteger(appPort) || appPort <= 0) return undefined;
  return appPort + 10000;
}

/**
 * Prometheus 스크레이프용 최소 HTTP 서버. **Nest 밖**이다 — 로거·예외필터·가드가
 * 붙지 않으므로 이 파일은 짧게 유지한다. 라우팅은 `/metrics` 하나뿐이다.
 *
 * 방향에 주의: 이 서버는 Alloy 로 아무것도 보내지 않는다. Alloy 가 주기적으로
 * 긁어간다(pull). 트레이스·로그가 OTLP push 인 것과 반대다.
 *
 * ALB 리스너 룰은 앱 포트만 포워딩하고 태스크는 private subnet + assignPublicIp:false
 * 이므로, 이 포트에는 인터넷 경로가 존재하지 않는다. 그래서 인증 가드를 두지 않는다.
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
      .catch(() => {
        res.writeHead(500).end();
      });
  });

  server.listen(port, '0.0.0.0');
  // 이벤트 루프를 붙들지 않게 한다. 이게 없으면 SIGTERM 후에도 이 핸들이 살아 있어
  // 태스크 종료가 supervisor 의 GRACEFUL_TIMEOUT_MS(28s)까지 늘어날 수 있다.
  server.unref();
  return server;
}
