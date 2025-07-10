import { AbstractEventBusModuleService } from '@medusajs/framework/utils';
import { Message } from '@medusajs/types';

class EventModuleService extends AbstractEventBusModuleService {
  protected groupedEventsMap_: Map<string, Message[]>;

  constructor() {
    // @ts-ignore
    super(...arguments);

    this.groupedEventsMap_ = new Map();
  }

  async emit<T>(
    data: Message<T> | Message<T>[],
    options: Record<string, unknown>,
  ): Promise<void> {
    const events = Array.isArray(data) ? data : [data];

    for (const event of events) {
      console.log(`Received the event ${event.name} with data ${event.data}`);

      // TODO push the event somewhere
    }
  }

  async releaseGroupedEvents(eventGroupId: string): Promise<void> {
    const groupedEvents = this.groupedEventsMap_.get(eventGroupId) || [];

    for (const event of groupedEvents) {
      const { options, ...eventBody } = event;

      // TODO emit event
    }

    await this.clearGroupedEvents(eventGroupId);
  }
  async clearGroupedEvents(eventGroupId: string): Promise<void> {
    this.groupedEventsMap_.delete(eventGroupId);
  }
}

export default EventModuleService;
