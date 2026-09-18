import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { ProductAuditService } from './product-audit.service';
import { AuditLogItemDto, ProductAuditHistoryItemDto } from './dto';

@ApiTags('Product Audit')
@Controller('products/audit')
export class ProductAuditController {
  constructor(private readonly auditService: ProductAuditService) {}

  @Get('recent')
  @ApiOperation({
    summary: '최근 감사 로그 조회',
    description: '최근 변경된 감사 로그를 조회합니다.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: '조회할 로그 수 (기본값: 100)',
    example: 50,
  })
  @ApiResponse({
    status: 200,
    description: '최근 감사 로그 조회 성공',
    type: [AuditLogItemDto],
  })
  async getRecentAuditLogs(@Query('limit') limit?: string) {
    return this.auditService.getRecentAuditLogs(limit ? parseInt(limit) : 100);
  }

  @Get('by-user/:userId')
  @ApiOperation({
    summary: '사용자별 감사 로그 조회',
    description: '특정 사용자가 수행한 모든 변경 이력을 조회합니다.',
  })
  @ApiParam({ name: 'userId', description: '사용자 ID' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: '조회할 로그 수 (기본값: 100)',
    example: 50,
  })
  @ApiResponse({
    status: 200,
    description: '사용자별 감사 로그 조회 성공',
    type: [AuditLogItemDto],
  })
  async getAuditLogsByUser(@Param('userId') userId: string, @Query('limit') limit?: string) {
    return this.auditService.getAuditLogsByUser(userId, limit ? parseInt(limit) : 100);
  }

  @Get('by-action/:action')
  @ApiOperation({
    summary: '액션별 감사 로그 조회',
    description: '특정 액션(생성, 수정, 삭제 등)에 대한 감사 로그를 조회합니다.',
  })
  @ApiParam({
    name: 'action',
    description: '액션 타입 (예: created, updated, published)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: '조회할 로그 수 (기본값: 100)',
    example: 50,
  })
  @ApiResponse({
    status: 200,
    description: '액션별 감사 로그 조회 성공',
    type: [AuditLogItemDto],
  })
  async getAuditLogsByAction(@Param('action') action: string, @Query('limit') limit?: string) {
    return this.auditService.getAuditLogsByAction(action, limit ? parseInt(limit) : 100);
  }

  @Get(':masterId')
  @ApiOperation({
    summary: '제품 감사 이력 조회',
    description: '특정 제품의 모든 변경 이력을 조회합니다.',
  })
  @ApiParam({ name: 'masterId', description: '제품 마스터 ID' })
  @ApiResponse({
    status: 200,
    description: '감사 이력 조회 성공',
    type: [ProductAuditHistoryItemDto],
  })
  async getProductAuditHistory(@Param('masterId', ParseUUIDPipe) masterId: string) {
    return this.auditService.getProductAuditHistory(masterId);
  }
}
