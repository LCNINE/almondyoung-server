import { Controller, Get, Req, UnauthorizedException } from '@nestjs/common';
import { WalletJwtAuth } from '../wallet-auth.decorator';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PointsAdminService, PointsBalance } from '../admin/points-admin.service';
import { AuthenticatedRequest } from '../wallet.module';

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
}
