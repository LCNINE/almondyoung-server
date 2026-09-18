import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { ProductAuditService } from './product-audit.service';
import { AuditLogItemDto, ListAuditLogsQueryDto, ProductAuditHistoryItemDto } from './dto';
import { ApiOkResponsePaginated } from '../../common/decorators';

@ApiTags('Product Audit')
@Controller('products/audit')
export class ProductAuditController {
  constructor(private readonly auditService: ProductAuditService) {}

  @Get()
  @ApiOperation({
    summary: '감사 로그 목록',
    description: '최신순. action·작업자로 거를 수 있다.',
  })
  @ApiOkResponsePaginated(AuditLogItemDto)
  async listAuditLogs(@Query() query: ListAuditLogsQueryDto) {
    return this.auditService.listAuditLogs(query);
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
