import { Module } from '@nestjs/common';
import { TestService } from './services/test.service';
import { TestController } from './controllers/test.controller';

@Module({
  controllers: [TestController],
  providers: [
    TestService,
  ],
  exports: [TestService],
})
export class TestModule {}
