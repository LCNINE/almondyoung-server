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
  // METRICS_PORT 가 파싱 불가(NaN) 이거나 빈 문자열(Number('') === 0) 이면 미설정과
  // 동일하게 취급한다 — Nest 부팅 전에 도는 경로라 throw 하면 선택적 env 오타 하나가
  // 전체 서비스를 불가로 만든다. `> 0` 이어야 한다: `>= 0` 이면 `METRICS_PORT=`(빈 값)
  // 이 0 으로 파싱돼 폴백을 건너뛰고 OS 임의 포트에 바인딩한다 — Alloy 는 고정 포트만
  // 긁으므로 그 앱은 영구히 up=0 이 되고 로그에 단서가 남지 않는다.
  if (Number.isInteger(explicit) && explicit > 0) return explicit;

  const appPort = Number(env.PORT);
  if (!Number.isInteger(appPort) || appPort <= 0) return undefined;
  return appPort + 10000;
}

/**
 * 이 서버는 Nest 로거가 없다. `supervisor.mjs` 의 `log()` 관례를 따라 JSON 한 줄로
 * stderr 에 남긴다 — 별도 로그 인프라 없이도 CloudWatch/Loki 에서 grep 가능하게.
 */
function logError(msg: string, extra?: Record<string, unknown>): void {
  console.error(
    JSON.stringify({
      level: 'error',
      service_name: 'metrics-server',
      time: new Date().toISOString(),
      msg,
      ...extra,
    }),
  );
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
      .catch((err: unknown) => {
        logError('메트릭 수집 실패', { error: err instanceof Error ? err.message : String(err) });
        res.writeHead(500).end();
      });
  });

  // 리스너 없는 'error' 는 Node 가 throw 한다 — 이 함수는 tracing.ts 에서 Nest 부팅
  // 전에 돌므로, EADDRINUSE/EACCES 를 그대로 두면 uncaughtException 으로 프로세스가
  // 죽는다. 번들 태스크는 supervisor.mjs 가 백오프로 무한 재시작해 관측 실패가
  // 가용성 실패로 승격된다. 로그만 남기고 프로세스는 살려둔다 — 이 포트가 죽어도
  // 앱 자체(ALB 포트)는 멀쩡하다.
  server.on('error', (err: NodeJS.ErrnoException) => {
    logError('메트릭 서버 바인딩 실패 — 프로세스는 계속 실행된다', {
      port,
      code: err.code,
      error: err.message,
    });
  });

  server.listen(port, '0.0.0.0');
  // 이벤트 루프를 붙들지 않게 한다. 이게 없으면 SIGTERM 후에도 이 핸들이 살아 있어
  // 태스크 종료가 supervisor 의 GRACEFUL_TIMEOUT_MS(28s)까지 늘어날 수 있다.
  server.unref();
  return server;
}
