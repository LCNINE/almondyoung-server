// apps/notification/src/bulk/controllers/bulk-notification.controller.ts
import { Controller, Post, Get, Body, Param, Query, Logger, ValidationPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiParam, ApiQuery } from '@nestjs/swagger';
import { BulkNotificationService } from '../services/bulk-notification.service';
import { CreateBulkNotificationDto } from '../dto/create-bulk-notification.dto';

@ApiTags('bulk')
@Controller('api/v1/bulk-notifications')
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
        status: { type: 'string', example: 'PROCESSING' }
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

  @Get()
  @ApiOperation({ 
    summary: '캠페인 목록 조회', 
    description: '대량 알림 캠페인 목록을 조회합니다.' 
  })
  @ApiQuery({ name: 'status', required: false, type: [String], description: '상태 필터 (예: PROCESSING,COMPLETED)', example: 'PROCESSING,COMPLETED' })
  @ApiQuery({ name: 'category', required: false, type: String, description: '카테고리 필터', example: 'MARKETING' })
  @ApiQuery({ name: 'createdBy', required: false, type: String, description: '생성자 필터', example: 'admin-user-123' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: '페이지 크기', example: 50 })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: '오프셋', example: 0 })
  @ApiResponse({ status: 200, description: '캠페인 목록 조회 성공' })
  async findAllCampaigns(
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('createdBy') createdBy?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    const statusArray = status ? status.split(',') : undefined;
    const result = await this.bulkNotificationService.findAllCampaigns({
      status: statusArray,
      category,
      createdBy,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return result;
  }

  @Get(':campaignId')
  @ApiOperation({ 
    summary: '캠페인 상세 조회', 
    description: '특정 캠페인의 상세 정보를 조회합니다.' 
  })
  @ApiParam({ name: 'campaignId', description: '캠페인 ID', example: 'campaign_123456789' })
  @ApiResponse({ status: 200, description: '캠페인 상세 조회 성공' })
  @ApiResponse({ status: 404, description: '캠페인을 찾을 수 없음' })
  async findCampaignById(@Param('campaignId') campaignId: string) {
    return this.bulkNotificationService.findCampaignById(campaignId);
  }

  @Post(':campaignId/cancel')
  @ApiOperation({ 
    summary: '캠페인 취소', 
    description: '진행 중이거나 예약된 캠페인을 취소합니다.' 
  })
  @ApiParam({ name: 'campaignId', description: '캠페인 ID', example: 'campaign_123456789' })
  @ApiResponse({ status: 200, description: '캠페인 취소 성공' })
  @ApiResponse({ status: 400, description: '취소할 수 없는 상태' })
  @ApiResponse({ status: 404, description: '캠페인을 찾을 수 없음' })
  async cancelCampaign(@Param('campaignId') campaignId: string) {
    return this.bulkNotificationService.cancelCampaign(campaignId);
  }

  @Get(':campaignId/recipients')
  @ApiOperation({ 
    summary: '캠페인 수신자 목록 조회', 
    description: '특정 캠페인의 수신자 목록을 조회합니다.' 
  })
  @ApiParam({ name: 'campaignId', description: '캠페인 ID', example: 'campaign_123456789' })
  @ApiQuery({ name: 'status', required: false, type: String, description: '상태 필터', example: 'SENT' })
  @ApiQuery({ name: 'channel', required: false, type: String, description: '채널 필터', example: 'EMAIL' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: '페이지 크기', example: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: '오프셋', example: 0 })
  @ApiResponse({ status: 200, description: '수신자 목록 조회 성공' })
  @ApiResponse({ status: 404, description: '캠페인을 찾을 수 없음' })
  async getCampaignRecipients(
    @Param('campaignId') campaignId: string,
    @Query('status') status?: string,
    @Query('channel') channel?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.bulkNotificationService.getCampaignRecipients(campaignId, {
      status,
      channel,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }
}
