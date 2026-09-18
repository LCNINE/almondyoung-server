import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { UserContactClient } from '@app/shared';
import { SmsDeviceManager } from './sms-device.manager';
import { SmsDeviceReader } from './sms-device.reader';
import { SmsDispatchManager } from './sms-dispatch.manager';
import { SmsDispatchWorker } from './sms-dispatch.worker';
import { SmsGateClient } from './sms-gate.client';
import { SmsGateController } from './sms-gate.controller';
import { SmsGateRepository } from './sms-gate.repository';
import { SmsGateService } from './sms-gate.service';
import { SmsMessageManager } from './sms-message.manager';

@Module({
  imports: [HttpModule],
  controllers: [SmsGateController],
  providers: [
    SmsGateService,
    SmsGateRepository,
    SmsGateClient,
    SmsDeviceReader,
    SmsDeviceManager,
    SmsMessageManager,
    SmsDispatchManager,
    SmsDispatchWorker,
    UserContactClient,
  ],
})
export class SmsGateModule {}
