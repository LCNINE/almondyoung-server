import type { Params } from 'nestjs-pino';

/**
 * nestjs-pino 설정.
 *
 * trace_id/span_id 주입은 tracing.ts 의 getNodeAutoInstrumentations() 에 포함된
 * @opentelemetry/instrumentation-pino 가 자동으로 처리한다 — active span 이 있으면
 * 모든 로그 줄에 trace_id / span_id / trace_flags 가 붙는다. 여기서 수동 주입은 불필요.
 *
 * 운영(JSON)과 로컬(pretty)을 NODE_ENV 로 분기한다. JSON 출력은 이후 Loki 파싱과
 * trace 상관(correlation)의 토대가 된다.
 */
export const loggerConfig: Params = {
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? 'info',
    // 운영은 구조화 JSON 그대로(스크레이프/OTLP 친화), 로컬만 pretty.
    ...(process.env.NODE_ENV === 'production'
      ? {}
      : {
          transport: {
            target: 'pino-pretty',
            options: { singleLine: true },
          },
        }),
    // 헬스체크/메트릭 스크레이프 로그는 노이즈라 낮춘다.
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    autoLogging: {
      ignore: (req) => req.url === '/health' || req.url === '/metrics',
    },
    // 민감 헤더 마스킹.
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      remove: true,
    },
  },
};
