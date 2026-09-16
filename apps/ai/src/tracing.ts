// 공용 OpenTelemetry 부트스트랩. 반드시 main.ts 의 첫 import 로 유지할 것 —
// 계측 대상 모듈보다 먼저 SDK 가 시작돼야 trace_id 주입/자동계측이 성립한다.
import { startTelemetry } from '@app/shared/observability/telemetry';
import { startMetricsServer } from '@app/shared/observability/metrics-server';

startTelemetry({ serviceName: 'ai' });
startMetricsServer();
