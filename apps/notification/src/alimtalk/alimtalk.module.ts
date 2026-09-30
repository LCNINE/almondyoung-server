import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { UserContactClient } from '@app/shared';
import { MembershipAudienceClient } from './clients/membership-audience.client';
import { NhnAlimtalkClient } from './clients/nhn-alimtalk.client';
import { AlimtalkCampaignsController } from './controllers/alimtalk-campaigns.controller';
import { AlimtalkTemplatesController } from './controllers/alimtalk-templates.controller';
import { AlimtalkRepository } from './repositories/alimtalk.repository';
import { AlimtalkCampaignManager } from './services/alimtalk-campaign.manager';
import { AlimtalkCampaignReader } from './services/alimtalk-campaign.reader';
import { AlimtalkCampaignsService } from './services/alimtalk-campaigns.service';
import { AlimtalkDispatchManager } from './services/alimtalk-dispatch.manager';
import { AlimtalkDispatchWorker } from './services/alimtalk-dispatch.worker';
import { AlimtalkTemplateManager } from './services/alimtalk-template.manager';
import { AlimtalkTemplateReader } from './services/alimtalk-template.reader';
import { AlimtalkTemplatesService } from './services/alimtalk-templates.service';

/** 관리자 알림톡: 카카오 템플릿 관리와 대상 골라 보내기. 이벤트 알림·인증번호 발송 경로와는 따로 돈다. */
@Module({
  imports: [HttpModule],
  controllers: [AlimtalkTemplatesController, AlimtalkCampaignsController],
  providers: [
    NhnAlimtalkClient,
    MembershipAudienceClient,
    UserContactClient,
    AlimtalkRepository,
    AlimtalkTemplateReader,
    AlimtalkTemplateManager,
    AlimtalkTemplatesService,
    AlimtalkCampaignReader,
    AlimtalkCampaignManager,
    AlimtalkCampaignsService,
    AlimtalkDispatchManager,
    AlimtalkDispatchWorker,
  ],
})
export class AlimtalkModule {}
