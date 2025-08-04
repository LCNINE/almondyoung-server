import { DynamicModule, Global, Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import {
  EventPublisherService,
  EVENT_PUBLISHER_CLIENT,
} from './event-publisher.service';
import { EventDefinition, KafkaConfig } from './types';

export interface EventsModuleOptions<
  TEvents extends Record<string, EventDefinition>,
> {
  kafka: KafkaConfig;
  events: TEvents;
  serviceName?: string;
}
@Global()
@Module({})
export class EventsModule {
  static forRoot<TEvents extends Record<string, EventDefinition>>(
    options: EventsModuleOptions<TEvents>,
  ): DynamicModule {
    return {
      module: EventsModule,
      global: true,
      imports: [
        ClientsModule.register([
          {
            name: EVENT_PUBLISHER_CLIENT,
            transport: Transport.KAFKA,
            options: {
              client: {
                clientId: options.kafka.clientId,
                brokers: options.kafka.brokers,
                retry: options.kafka.retry,
              },
              consumer: {
                groupId:
                  options.kafka.groupId || `${options.kafka.clientId}-consumer`,
              },
            },
          },
        ]),
      ],
      providers: [
        {
          provide: EventPublisherService,
          useFactory: (kafkaClient: any) => {
            const service = new EventPublisherService<TEvents>(kafkaClient);
            if (options.serviceName) {
              service.setServiceName(options.serviceName);
            }
            return service;
          },
          inject: [EVENT_PUBLISHER_CLIENT],
        },
      ],
      exports: [EventPublisherService],
    };
  }

  static forFeature<TEvents extends Record<string, EventDefinition>>(
    options: EventsModuleOptions<TEvents>,
  ): DynamicModule {
    return this.forRoot(options);
  }
}
