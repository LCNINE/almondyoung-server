import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '@app/authorization';

import { OwnershipService } from '../services/ownership.service';
import {
  ADMIN_OWNERSHIP_STATUSES,
  AdminOwnershipListResponseDto,
  AdminOwnershipResponseDto,
  AdminOwnershipStatus,
  GrantOwnershipDto,
  RevokeOwnershipDto,
} from '../dto/admin-ownership.dto';

@ApiTags('Library / Admin Ownerships')
@ApiBearerAuth()
@UseGuards(RolesGuard('master', 'admin'))
@Controller('library/admin/ownerships')
export class OwnershipAdminController {
  constructor(private readonly service: OwnershipService) {}

  @Get()
  @ApiOperation({ summary: '어드민 ownership 조회 (customer/asset/order 필터, revoke 포함)' })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'assetId', required: false })
  @ApiQuery({ name: 'salesOrderId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ADMIN_OWNERSHIP_STATUSES })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiResponse({ status: 200, type: AdminOwnershipListResponseDto })
  async list(
    @Query('customerId') customerId?: string,
    @Query('assetId') assetId?: string,
    @Query('salesOrderId') salesOrderId?: string,
    @Query('status') status?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ): Promise<AdminOwnershipListResponseDto> {
    const statusValue = ADMIN_OWNERSHIP_STATUSES.includes(status as AdminOwnershipStatus)
      ? (status as AdminOwnershipStatus)
      : undefined;

    return this.service.listForAdmin({
      customerId: customerId || undefined,
      assetId: assetId || undefined,
      salesOrderId: salesOrderId || undefined,
      status: statusValue,
      skip: skip !== undefined ? Number(skip) : undefined,
      take: take !== undefined ? Number(take) : undefined,
    });
  }

  @Post('grant')
  @ApiOperation({ summary: '어드민 수동 부여 (멱등)' })
  @ApiResponse({ status: 201, type: AdminOwnershipResponseDto })
  async grant(@Body() dto: GrantOwnershipDto): Promise<AdminOwnershipResponseDto> {
    return this.service.grantManual(dto);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @ApiOperation({ summary: '어드민 강제 회수 (다운로드 차단)' })
  @ApiResponse({ status: 200, type: AdminOwnershipResponseDto })
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevokeOwnershipDto,
  ): Promise<AdminOwnershipResponseDto> {
    return this.service.adminRevoke(id, dto.reason ?? null);
  }

  @Post(':id/resend')
  @HttpCode(200)
  @ApiOperation({ summary: '어드민 재발급 (회수된 ownership 재활성화)' })
  @ApiResponse({ status: 200, type: AdminOwnershipResponseDto })
  async resend(@Param('id', ParseUUIDPipe) id: string): Promise<AdminOwnershipResponseDto> {
    return this.service.adminResend(id);
  }
}
