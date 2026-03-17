import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { PaginationQueryDto } from '@app/shared';
import { PointsAdminService } from './points-admin.service';

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

@ApiTags('Admin - Points')
@Controller('v1/admin/points')
export class PointsAdminController {
  constructor(private readonly service: PointsAdminService) {}

  @Get('balance')
  @ApiOperation({ summary: 'Get points balance for a user' })
  async getBalance(@Query('user_id') userId: string) {
    return this.service.getBalance(userId);
  }

  @Get('events')
  @ApiOperation({ summary: 'Get point events for a user (paginated)' })
  async getEvents(@Query() query: PointsEventListQueryDto) {
    return this.service.getEventsPaginated(
      query.userId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  @Post('earn')
  @HttpCode(201)
  @ApiOperation({ summary: 'Earn points for a user (admin)' })
  async earn(@Body() dto: EarnPointsDto) {
    return this.service.earn(dto.userId, dto.amount, dto.reasonCode);
  }

  @Post('earn-cancel')
  @HttpCode(201)
  @ApiOperation({ summary: 'Cancel an EARN event (admin)' })
  async earnCancel(@Body() dto: EarnCancelDto) {
    return this.service.earnCancel(
      dto.userId,
      dto.earnEventId,
      dto.amount,
      dto.reasonCode,
    );
  }
}
