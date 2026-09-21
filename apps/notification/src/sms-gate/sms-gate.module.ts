import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { UserContactClient } from '@app/shared';
import { ProviderModule } from '../provider/provider.module';
import { SmsGateClient } from './clients/sms-gate.client';
import { SmsCampaignsController } from './controllers/sms-campaigns.controller';
import { SmsDevicesController } from './controllers/sms-devices.controller';
import { SmsGateWebhookController } from './controllers/sms-gate-webhook.controller';
import { SmsMessagesController } from './controllers/sms-messages.controller';
import { SmsTemplatesController } from './controllers/sms-templates.controller';
import { SmsGateRepository } from './repositories/sms-gate.repository';
import { SmsCampaignManager } from './services/sms-campaign.manager';
import { SmsCampaignReader } from './services/sms-campaign.reader';
import { SmsCampaignsService } from './services/sms-campaigns.service';
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
  imports: [HttpModule, ProviderModule],
  controllers: [SmsDevicesController, SmsCampaignsController, SmsMessagesController, SmsTemplatesController, SmsGateWebhookController],
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
    SmsCampaignsService,
    SmsCampaignReader,
    SmsCampaignManager,
    SmsTemplateReader,
    SmsTemplateManager,
    UserContactClient,
  ],
})
export class SmsGateModule {}
