import { RequirePermission } from '@app/authorization';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IamAuditLogsQueryDto, IamAuditPageDto } from './dto/iam-audit.dto';
import { IamAuditService } from './iam-audit.service';

@ApiTags('Admin/IAM audit')
@ApiBearerAuth('access-token')
@Controller('admin/iam/audit-logs')
export class IamAuditController {
  constructor(private readonly service: IamAuditService) {}

  @ApiOperation({ summary: '역할·권한·부여 변경 이력(최신순, 커서 페이지)' })
  @RequirePermission('iam.audit_log.read')
  @Get()
  page(@Query() query: IamAuditLogsQueryDto): Promise<IamAuditPageDto> {
    return this.service.page(query);
  }
}
