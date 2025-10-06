import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EventsModule } from '@app/events';
import { TEST_STREAM } from './test-stream.config';
import { TestService } from './services/test.service';
import { OutboxDispatcher } from './services/outbox-dispatcher.service';
import { TestController } from './controllers/test.controller';

function createKafkaConfig() {
  return {
    clientId: process.env.KAFKA_CLIENT_ID || 'outbox-demo',
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',').map(b => b.trim()),
    ssl: !!(process.env.KAFKA_API_KEY && process.env.KAFKA_API_SECRET),
    sasl: (process.env.KAFKA_API_KEY && process.env.KAFKA_API_SECRET) ? {
      mechanism: 'plain' as const,
      username: process.env.KAFKA_API_KEY,
      password: process.env.KAFKA_API_SECRET,
    } : undefined,
  };
}

@Module({
  imports: [
    ScheduleModule.forRoot(),  // ← Cron 활성화
    EventsModule.forRoot({
      streams: [TEST_STREAM],
      serviceName: 'outbox-demo',
      kafka: createKafkaConfig(),  // ← 명시적으로 Kafka 설정 전달
    }),
  ],
  controllers: [TestController],
  providers: [
    TestService,
    OutboxDispatcher,  // ← Dispatcher 등록
  ],
  exports: [TestService],
})
export class TestModule {}
