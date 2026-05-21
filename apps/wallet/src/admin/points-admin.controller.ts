import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsArray, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, IsUUID, Min } from 'class-validator';
import { PaginationQueryDto } from '@app/shared';
import { PointsAdminService } from './points-admin.service';
import { WalletAdminAuth } from '../wallet-admin-auth.decorator';

class EarnPointsDto {
  @ApiProperty({ description: 'User ID', maxLength: 128 })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ description: 'Amount to earn (positive integer)', minimum: 1 })
  @IsInt()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ description: 'Reason code', maxLength: 128 })
  @IsOptional()
  @IsString()
  reasonCode?: string;

  @ApiPropertyOptional({ description: 'Expiry date (ISO 8601). Points auto-cancelled on expiry.' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

class DeductPointsDto {
  @ApiProperty({ description: 'User ID', maxLength: 128 })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ description: 'Amount to deduct (positive integer)', minimum: 1 })
  @IsInt()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ description: 'Reason code', maxLength: 128 })
  @IsOptional()
  @IsString()
  reasonCode?: string;
}

class EarnCancelDto {
  @ApiProperty({ description: 'User ID', maxLength: 128 })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ description: 'UUID of the EARN event to cancel' })
  @IsUUID()
  earnEventId: string;

  @ApiPropertyOptional({ description: 'Amount to cancel (defaults to full original amount)', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  @ApiPropertyOptional({ description: 'Reason code', maxLength: 128 })
  @IsOptional()
  @IsString()
  reasonCode?: string;
}

class PointsEventListQueryDto extends PaginationQueryDto {
  @ApiProperty({ description: 'User ID' })
  @IsString()
  @IsNotEmpty()
  userId: string;
}

class AllEventsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by User ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ enum: ['EARN', 'REDEEM', 'EARN_CANCEL', 'REDEEM_CANCEL'] })
  @IsOptional()
  @IsIn(['EARN', 'REDEEM', 'EARN_CANCEL', 'REDEEM_CANCEL'])
  eventType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

class StatsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

class BatchEarnDto {
  @ApiProperty({ description: 'List of user IDs to earn points', type: [String] })
  @IsArray()
  @IsString({ each: true })
  userIds: string[];

  @ApiProperty({ description: 'Amount to earn per user (positive integer)', minimum: 1 })
  @IsInt()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ description: 'Reason code', maxLength: 128 })
  @IsOptional()
  @IsString()
  reasonCode?: string;

  @ApiPropertyOptional({ description: 'Expiry date (ISO 8601). Points auto-cancelled on expiry.' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

class TopUsersQueryDto {
  @ApiPropertyOptional({ description: 'Number of top users to return (default: 20, max: 100)' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  limit?: number;
}

@ApiTags('Admin - Points')
@WalletAdminAuth()
@Controller('v1/admin/points')
export class PointsAdminController {
  constructor(private readonly service: PointsAdminService) {}

  @Get('balance')
  @ApiOperation({ summary: 'Get points balance for a user' })
  async getBalance(@Query('user_id') userId: string) {
    return this.service.getBalance(userId);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get aggregated points statistics' })
  async getStats(@Query() query: StatsQueryDto) {
    return this.service.getStats({ dateFrom: query.dateFrom, dateTo: query.dateTo });
  }

  @Get('events')
  @ApiOperation({ summary: 'Get point events for a user (paginated)' })
  async getEvents(@Query() query: PointsEventListQueryDto) {
    return this.service.getEventsPaginated(query.userId, query.page ?? 1, query.limit ?? 20);
  }

  @Get('events/all')
  @ApiOperation({ summary: 'Get all point events across users (paginated, with filters)' })
  async getAllEvents(@Query() query: AllEventsQueryDto) {
    return this.service.getAllEventsPaginated(query.page ?? 1, query.limit ?? 20, {
      userId: query.userId,
      eventType: query.eventType,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    });
  }

  @Get('users/top')
  @ApiOperation({ summary: 'Get top users by points balance' })
  async getTopUsers(@Query() query: TopUsersQueryDto) {
    const limit = Math.min(query.limit ?? 20, 100);
    return this.service.getTopUsersByBalance(limit);
  }

  @Post('earn')
  @HttpCode(201)
  @ApiOperation({ summary: 'Earn points for a user (admin)' })
  async earn(@Body() dto: EarnPointsDto) {
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
    return this.service.earn(dto.userId, dto.amount, dto.reasonCode, undefined, expiresAt);
  }

  @Post('earn/batch')
  @HttpCode(200)
  @ApiOperation({ summary: 'Batch earn points for multiple users (admin)' })
  async batchEarn(@Body() dto: BatchEarnDto) {
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
    return this.service.batchEarn(dto.userIds, dto.amount, dto.reasonCode, expiresAt);
  }

  @Post('expire')
  @HttpCode(200)
  @ApiOperation({ summary: 'Process expired EARN events — creates EARN_CANCEL for unredeemed expired points' })
  async processExpired() {
    return this.service.processExpiredPoints();
  }

  @Post('deduct')
  @HttpCode(201)
  @ApiOperation({ summary: 'Deduct points from a user (admin)' })
  async deduct(@Body() dto: DeductPointsDto) {
    return this.service.deduct(dto.userId, dto.amount, dto.reasonCode);
  }

  @Post('earn-cancel')
  @HttpCode(201)
  @ApiOperation({ summary: 'Cancel an EARN event (admin)' })
  async earnCancel(@Body() dto: EarnCancelDto) {
    return this.service.earnCancel(dto.userId, dto.earnEventId, dto.amount, dto.reasonCode);
  }
}
