import { SetMetadata } from '@nestjs/common';
import { CRON_ONCE_METADATA, CronOnceMetadata, CronOnceOptions } from './cron-once.constants';

/**
 * `@nestjs/schedule` 의 `@Cron` 을 대체한다. 메타데이터만 남기고, 등록·선점은 `CronOnceExplorer`
 * 가 한다. 그래서 `CronOnceModule` 이 앱에 없으면 이 크론은 **조용히 안 돈다** — 가드 스펙
 * (`guards/cron-once-guard.spec.ts`) 이 그 누락을 막는다.
 *
 * `name` 은 선점 키이자 `SchedulerRegistry` 등록 이름이라 필수이고 앱 안에서 유일해야 한다.
 */
export function CronOnce(expression: string, options: CronOnceOptions): MethodDecorator {
  if (!options?.name?.trim()) {
    throw new Error(`@CronOnce('${expression}') requires a non-empty name — it is the claim key.`);
  }
  const metadata: CronOnceMetadata = {
    expression,
    name: options.name,
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  };
  return SetMetadata(CRON_ONCE_METADATA, metadata);
}
