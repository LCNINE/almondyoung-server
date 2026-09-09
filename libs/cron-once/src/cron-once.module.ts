import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { CronOnceExplorer } from './cron-once.explorer';
import { CronOnceRunner } from './cron-once.runner';
import { CronRunClaimer } from './cron-run.claimer';

/**
 * 앱 루트 모듈이 `SCHEDULE_ROOT` 옆에 import 한다. 정적 모듈이라 Nest 11 의 참조 기준 dedupe 에
 * 걸리지 않는다 — 여러 곳에서 import 해도 한 벌이다.
 *
 * 의존: `SchedulerRegistry` 는 전역 `SCHEDULE_ROOT` 가, `DbService` 는 앱의 `DbModule.forRoot` 가
 * export 한다. 이 모듈이 빠지면 `@CronOnce` 는 조용히 안 돈다 — `guards/cron-once-guard.spec.ts`.
 */
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [CronRunClaimer, CronOnceRunner, CronOnceExplorer],
  exports: [CronRunClaimer],
})
export class CronOnceModule {}
