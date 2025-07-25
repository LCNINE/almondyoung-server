import { EventPublisherService } from '@/shared/src/events/src';
import { EventBusService as MedusaEventBus } from '@medusajs/framework';

export class KafkaBridgedEventBusService extends MedusaEventBus {
  constructor(
    private readonly kafka: EventPublisherService,
    ...args: ConstructorParameters<typeof MedusaEventBus>
  ) {
    super(...args);
  }

  override async emit<T = unknown>(eventName: string, data: T): Promise<void> {
    await super.emit(eventName, data); // 기존 이벤트도 메모리에 전달
    await this.kafka.publishEvent(eventName as any, data as any); // 카프카에도 발행
  }
}
