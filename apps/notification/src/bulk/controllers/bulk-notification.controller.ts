import { Controller, Post, Body, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { BulkNotificationService } from '../services/bulk-notification.service';
import { CreateBulkNotificationDto } from '../dto/create-bulk-notification.dto';

@ApiTags('bulk')
@Controller('bulk-notifications')
export class BulkNotificationController {
  private readonly logger = new Logger(BulkNotificationController.name);

  constructor(private readonly bulkNotificationService: BulkNotificationService) {}

  @Post()
  @ApiOperation({ 
    summary: '대량 알림 발송', 
    description: '다수의 사용자에게 동시에 알림을 발송하는 캠페인을 시작합니다.' 
  })
  @ApiBody({ type: CreateBulkNotificationDto, description: '대량 알림 발송 정보' })
  @ApiResponse({ 
    status: 201, 
    description: '대량 알림 캠페인 시작 성공',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Bulk notification campaign initiated' },
        campaignId: { type: 'string', example: 'campaign_123456789' },
        status: { type: 'string', example: 'INITIATED' }
      }
    }
  })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async createBulkNotification(@Body() createBulkNotificationDto: CreateBulkNotificationDto) {
    this.logger.log(`Received request to create bulk notification: ${JSON.stringify(createBulkNotificationDto)}`);
    const result = await this.bulkNotificationService.createBulkNotification(createBulkNotificationDto);
    return { message: 'Bulk notification campaign initiated', campaignId: result.campaignId, status: result.status };
  }
}
