import { Logger } from '@nestjs/common';
import { UserContactClient } from '@app/shared';
import { Channel, NotificationCategory, NotificationPriority } from '../../shared/enums';
import { EventMappingService } from '../../shared/services/event-mapping.service';
import { NotificationDispatcherService } from '../services/notification-dispatcher.service';

export interface NotifyMemberDeps {
  dispatcher: NotificationDispatcherService;
  eventMappings: EventMappingService;
  contacts: UserContactClient;
  logger: Logger;
}

export async function notifyMember(
  deps: NotifyMemberDeps,
  input: {
    eventKey: string;
    userId: string;
    correlationId?: string;
    payload: object;
    variables: (contact: { email: string; username: string }) => Record<string, unknown>;
    email?: string;
  },
): Promise<void> {
  const mapping = await deps.eventMappings.getEventMapping(input.eventKey);
  if (!mapping || !mapping.isActive) {
    deps.logger.warn(`Event mapping for ${input.eventKey} not found or inactive.`);
    return;
  }

  const contact = input.email
    ? { email: input.email, username: '', marketingConsent: false }
    : (await deps.contacts.findContacts([input.userId])).get(input.userId);
  if (!contact?.email) {
    deps.logger.warn(`Skipping ${input.eventKey}: no active contact (user ${input.userId})`);
    return;
  }
  if (mapping.category === NotificationCategory.MARKETING && !contact.marketingConsent) {
    deps.logger.log(`Skipping ${input.eventKey}: no marketing consent (user ${input.userId})`);
    return;
  }

  await deps.dispatcher.send({
    userId: input.userId,
    channels: mapping.defaultChannels as Channel[],
    category: mapping.category as NotificationCategory,
    templateKey: mapping.templateKey,
    eventKey: mapping.eventKey,
    payload: { ...input.payload, email: contact.email },
    correlationId: input.correlationId,
    priority: mapping.priority as NotificationPriority,
    variables: input.variables(contact),
  });
}
