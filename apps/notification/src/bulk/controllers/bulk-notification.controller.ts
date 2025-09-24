// apps/notification/src/bulk/controllers/bulk-notification.controller.ts
import { Controller, Post, Get, Body, Param, Logger } from '@nestjs/common';
import { BulkNotificationService } from '../services/bulk-notification.service';
import { CreateBulkNotificationDto } from '../dto/create-bulk-notification.dto';

@Controller('api/v1/bulk-notifications')
export class BulkNotificationController {
  private readonly logger = new Logger(BulkNotificationController.name);

  constructor(private readonly bulkNotificationService: BulkNotificationService) {}

  @Post()
  async createBulkNotification(@Body() createBulkNotificationDto: CreateBulkNotificationDto) {
    this.logger.log(`Received request to create bulk notification: ${JSON.stringify(createBulkNotificationDto)}`);
    const result = await this.bulkNotificationService.createBulkNotification(createBulkNotificationDto);
    return { 
      message: 'Bulk notification campaign initiated', 
      campaignId: result.campaignId, 
      stats: result.stats 
    };
  }

  @Get()
  async getCampaigns() {
    this.logger.log('Fetching all campaigns');
    const campaigns = await this.bulkNotificationService.getCampaigns();
    return { campaigns };
  }

  @Get(':campaignId')
  async getCampaignById(@Param('campaignId') campaignId: string) {
    this.logger.log(`Fetching campaign: ${campaignId}`);
    const campaign = await this.bulkNotificationService.getCampaignById(campaignId);
    return { campaign };
  }

  @Get(':campaignId/stats')
  async getCampaignStats(@Param('campaignId') campaignId: string) {
    this.logger.log(`Fetching campaign stats: ${campaignId}`);
    const stats = await this.bulkNotificationService.getCampaignStats(campaignId);
    return stats;
  }
}
