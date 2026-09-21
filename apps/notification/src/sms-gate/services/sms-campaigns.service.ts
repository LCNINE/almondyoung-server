import { Injectable } from '@nestjs/common';
import { SmsAudienceSummary } from '@app/shared';
import { CreateSmsCampaignDto, PreviewSmsCampaignDto } from '../dto';
import { SmsCampaignManager } from './sms-campaign.manager';
import { SmsCampaignListItem, SmsCampaignPreview, SmsCampaignReader } from './sms-campaign.reader';

@Injectable()
export class SmsCampaignsService {
  constructor(
    private readonly campaignReader: SmsCampaignReader,
    private readonly campaignManager: SmsCampaignManager,
  ) {}

  audience(): Promise<SmsAudienceSummary> {
    return this.campaignReader.audience();
  }

  preview(dto: PreviewSmsCampaignDto): Promise<SmsCampaignPreview> {
    return this.campaignReader.preview(dto);
  }

  list(): Promise<SmsCampaignListItem[]> {
    return this.campaignReader.list();
  }

  create(dto: CreateSmsCampaignDto, createdBy: string): Promise<{ campaignId: string; recipients: number }> {
    return this.campaignManager.create(dto, createdBy);
  }

  stop(campaignId: string): Promise<{ cancelled: number }> {
    return this.campaignManager.stop(campaignId);
  }
}
