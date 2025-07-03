import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport, KafkaOptions } from '@nestjs/microservices';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'KAFKA_PRODUCER',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: async (
          configService: ConfigService,
        ): Promise<KafkaOptions> => {
          const brokers = configService
            .get('KAFKA_BROKERS', 'localhost:29092')
            .split(',');
          const groupId = configService.get(
            'KAFKA_GROUP_ID',
            'user-service-group',
          );

          return {
            transport: Transport.KAFKA,
            options: {
              client: {
                clientId: 'user-service',
                brokers: brokers,
              },
              consumer: {
                groupId: groupId,
              },
            },
          };
        },
      },
    ]),
  ],
  exports: [ClientsModule],
})
export class KafkaModule {}
