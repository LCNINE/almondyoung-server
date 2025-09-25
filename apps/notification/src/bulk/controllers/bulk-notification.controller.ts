import { Controller, Post, Body, Logger } from '@nestjs/common';
import { BulkNotificationService } from '../services/bulk-notification.service';
import { CreateBulkNotificationDto } from '../dto/create-bulk-notification.dto';

@Controller('bulk-notifications')
export class BulkNotificationController {
  private readonly logger = new Logger(BulkNotificationController.name);

  constructor(private readonly bulkNotificationService: BulkNotificationService) {}

  @Post()
  async createBulkNotification(@Body() createBulkNotificationDto: CreateBulkNotificationDto) {
    this.logger.log(`Received request to create bulk notification: ${JSON.stringify(createBulkNotificationDto)}`);
    const result = await this.bulkNotificationService.createBulkNotification(createBulkNotificationDto);
    return { message: 'Bulk notification campaign initiated', campaignId: result.campaignId, status: result.status };
  }
}
