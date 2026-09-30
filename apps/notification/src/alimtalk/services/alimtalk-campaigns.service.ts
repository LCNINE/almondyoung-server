import { Injectable } from '@nestjs/common';
import { CreateAlimtalkCampaignDto, PreviewAlimtalkCampaignDto } from '../dto';
import { AlimtalkCampaignCreated, AlimtalkCampaignManager } from './alimtalk-campaign.manager';
import {
  AlimtalkCampaignListItem,
  AlimtalkCampaignPreview,
  AlimtalkCampaignReader,
  AlimtalkCampaignResults,
  AlimtalkRecipientGroupOption,
} from './alimtalk-campaign.reader';

@Injectable()
export class AlimtalkCampaignsService {
  constructor(
    private readonly reader: AlimtalkCampaignReader,
    private readonly manager: AlimtalkCampaignManager,
  ) {}

  recipientGroups(): Promise<AlimtalkRecipientGroupOption[]> {
    return this.reader.recipientGroups();
  }

  preview(dto: PreviewAlimtalkCampaignDto): Promise<AlimtalkCampaignPreview> {
    return this.reader.preview(dto);
  }

  list(): Promise<AlimtalkCampaignListItem[]> {
    return this.reader.list();
  }

  results(campaignId: string): Promise<AlimtalkCampaignResults> {
    return this.reader.results(campaignId);
  }

  create(dto: CreateAlimtalkCampaignDto, createdBy: string): Promise<AlimtalkCampaignCreated> {
    return this.manager.create(dto, createdBy);
  }

  stop(campaignId: string): Promise<{ cancelled: number }> {
    return this.manager.stop(campaignId);
  }
}
