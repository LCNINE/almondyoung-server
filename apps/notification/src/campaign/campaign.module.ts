// apps/notification/src/campaign/campaign.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { DbModule } from '@app/db';
import { notificationTables } from '../../database/schemas/notification-schema';
import { CampaignController } from './controllers/campaign.controller';
import { CampaignTargetingController } from './controllers/campaign-targeting.controller';
import { CampaignService } from './services/campaign.service';
import { CampaignTargetingService } from './services/campaign-targeting.service';
import { UserSearchService } from './services/user-search.service';
import { CampaignProcessor } from './processors/campaign.processor';
import { ProviderModule } from '../provider/provider.module';
import { TemplateModule } from '../template/template.module';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'campaign' }),
    DbModule.forRoot({
      config: {
        connectionString: process.env.NOTIFICATION_DATABASE_URL ?? '',
      },
      schema: notificationTables,
    }),
    ProviderModule,
    TemplateModule,
    SharedModule,
  ],
  controllers: [CampaignController, CampaignTargetingController],
  providers: [
    CampaignService,
    CampaignTargetingService,
    UserSearchService,
    CampaignProcessor,
  ],
  exports: [CampaignService],
})
export class CampaignModule { }