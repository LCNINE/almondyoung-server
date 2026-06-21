import type { Params } from 'nestjs-pino';

/**
 * 모든 NestJS 서비스 공용 nestjs-pino 설정.
 *
 * trace_id/span_id 주입은 telemetry.ts 의 getNodeAutoInstrumentations() 에 포함된
 * @opentelemetry/instrumentation-pino 가 자동 처리한다 — active span 이 있으면 모든 로그
 * 줄에 trace_id 가 붙는다. 여기서 수동 주입은 불필요.
 *
 * 운영(JSON)과 로컬(pretty)을 NODE_ENV 로 분기. JSON 출력은 OTLP 로그 브리지와 Loki
 * 상관(correlation)의 토대.
 *
 * 사용처(app.module.ts): `LoggerModule.forRoot(loggerConfig)` + main.ts 에서
 * `NestFactory.create(Mod, ..., { bufferLogs: true })` 후 `app.useLogger(app.get(Logger))`.
 */
export const loggerConfig: Params = {
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? 'info',
    // 운영은 구조화 JSON 그대로(OTLP/스크레이프 친화), 로컬만 pretty.
    ...(process.env.NODE_ENV === 'production'
      ? {}
      : {
          transport: {
            target: 'pino-pretty',
            options: { singleLine: true },
          },
        }),
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    autoLogging: {
      ignore: (req) => req.url === '/health' || req.url === '/metrics',
    },
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      remove: true,
    },
  },
};
