import { Controller, Get, Query, Req, UnauthorizedException } from '@nestjs/common';
import { WalletJwtAuth } from '../wallet-auth.decorator';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaginatedResponseDto } from '@app/shared';
import {
  PointsAdminService,
  PointsBalance,
  PointsEventRow,
} from '../admin/points-admin.service';
import { AuthenticatedRequest } from '../wallet.module';
import { PointsHistoryQueryDto } from './dto/points-history-query.dto';

@ApiTags('Points')
@Controller('v1/points')
export class PointsController {
  constructor(private readonly pointsAdminService: PointsAdminService) {}

  @Get('balance')
  @WalletJwtAuth()
  @ApiOperation({ summary: "Get current user's points balance (JWT cookie auth)" })
  async getMyBalance(@Req() req: AuthenticatedRequest): Promise<PointsBalance> {
    if (!req.jwtUserId) {
      throw new UnauthorizedException('JWT authentication required');
    }
    return this.pointsAdminService.getBalance(req.jwtUserId);
  }

  @Get('history')
  @WalletJwtAuth()
  @ApiOperation({ summary: "Get current user's points history (JWT cookie auth, paginated)" })
  async getMyHistory(
    @Req() req: AuthenticatedRequest,
    @Query() query: PointsHistoryQueryDto,
  ): Promise<PaginatedResponseDto<PointsEventRow>> {
    if (!req.jwtUserId) {
      throw new UnauthorizedException('JWT authentication required');
    }
    return this.pointsAdminService.getEventsPaginated(
      req.jwtUserId,
      query.page ?? 1,
      query.limit ?? 20,
      { dateFrom: query.dateFrom, dateTo: query.dateTo },
    );
  }
}
