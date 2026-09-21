import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { UserContactClient } from '@app/shared';
import { SmsGateClient } from './clients/sms-gate.client';
import { SmsDevicesController } from './controllers/sms-devices.controller';
import { SmsGateWebhookController } from './controllers/sms-gate-webhook.controller';
import { SmsMessagesController } from './controllers/sms-messages.controller';
import { SmsTemplatesController } from './controllers/sms-templates.controller';
import { SmsGateRepository } from './repositories/sms-gate.repository';
import { InboundSmsManager } from './services/inbound-sms.manager';
import { SmsDeviceManager } from './services/sms-device.manager';
import { SmsDeviceReader } from './services/sms-device.reader';
import { SmsDevicesService } from './services/sms-devices.service';
import { SmsDispatchManager } from './services/sms-dispatch.manager';
import { SmsDispatchWorker } from './services/sms-dispatch.worker';
import { SmsMessageManager } from './services/sms-message.manager';
import { SmsMessagesService } from './services/sms-messages.service';
import { SmsTemplateManager } from './services/sms-template.manager';
import { SmsTemplateReader } from './services/sms-template.reader';
import { SmsTemplatesService } from './services/sms-templates.service';

@Module({
  imports: [HttpModule],
  controllers: [SmsDevicesController, SmsMessagesController, SmsTemplatesController, SmsGateWebhookController],
  providers: [
    SmsDevicesService,
    SmsMessagesService,
    SmsGateRepository,
    SmsGateClient,
    SmsDeviceReader,
    SmsDeviceManager,
    SmsMessageManager,
    SmsDispatchManager,
    SmsDispatchWorker,
    InboundSmsManager,
    SmsTemplatesService,
    SmsTemplateReader,
    SmsTemplateManager,
    UserContactClient,
  ],
})
export class SmsGateModule {}
