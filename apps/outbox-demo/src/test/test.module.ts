import { Module } from '@nestjs/common';
import { TestService } from './services/test.service';
import { OutboxDispatcher } from './services/outbox-dispatcher.service';
import { TestController } from './controllers/test.controller';

@Module({
  controllers: [TestController],
  providers: [
    TestService,
    OutboxDispatcher,
  ],
  exports: [TestService],
})
export class TestModule {}
