import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { LoaderOptions } from '@medusajs/framework/types';
import { IEventBusModuleService } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';

let consumer: Consumer | null = null;

/**
 * user-service Kafka 이벤트를 Medusa 내부 이벤트 버스로 브릿지하는 loader
 *
 * 구독 토픽: users.events.v1
 * 브릿지 이벤트:
 *   - UserUpdated → user.updated
 *   - UserDeleted → user.deleted
 */
export default async function userEventsLoader({ container }: LoaderOptions) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  const kafkaBrokers = process.env.KAFKA_BROKERS;
  const kafkaGroupId = process.env.KAFKA_GROUP_ID || 'medusa-group';
  const kafkaApiKey = process.env.KAFKA_API_KEY;
  const kafkaApiSecret = process.env.KAFKA_API_SECRET;

  if (!kafkaBrokers) {
    logger.warn('[KafkaBridge] KAFKA_BROKERS not configured. Kafka user events bridge disabled.');
    return;
  }

  const kafka = new Kafka({
    clientId: `${process.env.KAFKA_CLIENT_ID_PREFIX || 'medusa'}-user-events`,
    brokers: kafkaBrokers.split(','),
    ...(kafkaApiKey &&
      kafkaApiSecret && {
        ssl: true,
        sasl: {
          mechanism: 'plain' as const,
          username: kafkaApiKey,
          password: kafkaApiSecret,
        },
      }),
  });

  consumer = kafka.consumer({ groupId: `${kafkaGroupId}-user-events` });

  try {
    await consumer.connect();
    logger.info('[KafkaBridge] Kafka consumer connected for user events');

    await consumer.subscribe({ topic: 'users.events.v1', fromBeginning: false });
    logger.info('[KafkaBridge] Subscribed to topic: users.events.v1');

    await consumer.run({
      eachMessage: async ({ message }: EachMessagePayload) => {
        try {
          const value = message.value?.toString();
          if (!value) return;

          const event = JSON.parse(value);
          const eventType = event.eventType || event.type;
          const payload = event.payload || event.data || event;

          logger.info(`[KafkaBridge] Received Kafka event: ${eventType}`);

          const eventBus = container.resolve<IEventBusModuleService>(Modules.EVENT_BUS);

          switch (eventType) {
            case 'UserUpdated':
              await eventBus.emit({
                name: 'user.updated',
                data: payload,
              });
              logger.info(`[KafkaBridge] Emitted user.updated for userId: ${payload.userId}`);
              break;

            case 'UserDeleted':
              await eventBus.emit({
                name: 'user.deleted',
                data: payload,
              });
              logger.info(`[KafkaBridge] Emitted user.deleted for userId: ${payload.userId}`);
              break;

            default:
              logger.debug(`[KafkaBridge] Ignoring event type: ${eventType}`);
          }
        } catch (error) {
          logger.error(`[KafkaBridge] Error processing Kafka message: ${error}`);
        }
      },
    });
  } catch (error) {
    logger.error(`[KafkaBridge] Failed to connect Kafka consumer: ${error}`);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  if (consumer) {
    await consumer.disconnect();
  }
});

process.on('SIGINT', async () => {
  if (consumer) {
    await consumer.disconnect();
  }
});
