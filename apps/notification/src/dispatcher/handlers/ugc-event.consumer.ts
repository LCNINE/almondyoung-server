import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventEnvelope, EventPayload, On, RetryPolicy } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { UserContactClient } from '@app/shared';
import { UGC_EVENT_STREAM } from '@packages/event-contracts/streams/ugc.stream';
import { EnvelopeOf, EventPayloadOf } from '@packages/event-contracts/types';
import { Channel, NotificationCategory, NotificationPriority } from '../../shared/enums';
import { EventMappingService } from '../../shared/services/event-mapping.service';
import { NotificationDispatcherService } from '../services/notification-dispatcher.service';

@Controller()
@UseInterceptors(EventTypeGuard)
@RetryPolicy({ maxRetries: 0 })
export class UgcEventConsumer {
  private readonly logger = new Logger(UgcEventConsumer.name);

  constructor(
    private readonly notificationDispatcherService: NotificationDispatcherService,
    private readonly eventMappingService: EventMappingService,
    private readonly userContactClient: UserContactClient,
  ) {}

  @On(UGC_EVENT_STREAM, 'QuestionAnswered')
  async onQuestionAnswered(
    @EventEnvelope() envelope: EnvelopeOf<typeof UGC_EVENT_STREAM, 'QuestionAnswered'>,
    @EventPayload() payload: EventPayloadOf<typeof UGC_EVENT_STREAM, 'QuestionAnswered'>,
  ) {
    const mapping = await this.eventMappingService.getEventMapping('QNA_ANSWERED');
    if (!mapping || !mapping.isActive) {
      this.logger.warn('Event mapping for QNA_ANSWERED not found or inactive.');
      return;
    }

    const contact = (await this.userContactClient.findContacts([payload.userId])).get(payload.userId);
    if (!contact?.email) {
      this.logger.warn(`Skipping QNA_ANSWERED: no email (question ${payload.questionId})`);
      return;
    }

    await this.notificationDispatcherService.send({
      userId: payload.userId,
      channels: mapping.defaultChannels as Channel[],
      category: mapping.category as NotificationCategory,
      templateKey: mapping.templateKey,
      eventKey: mapping.eventKey,
      payload: { ...payload, email: contact.email },
      correlationId: envelope.correlationId,
      priority: mapping.priority as NotificationPriority,
      variables: { name: contact.username || '고객', title: payload.title },
    });
  }
}
