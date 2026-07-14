import { Body, Controller, Get, HttpCode, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WalletJwtAuth } from '../wallet-auth.decorator';
import { AuthenticatedRequest } from '../wallet.module';
import { RefundRequestsService } from './refund-requests.service';
import { CreateRefundRequestDto } from './dto';

@ApiTags('Refund Requests')
@Controller('v1/refund-requests')
export class RefundRequestsController {
  constructor(private readonly service: RefundRequestsService) {}

  @Post()
  @HttpCode(201)
  @WalletJwtAuth()
  @ApiOperation({ summary: '무통장 환불 요청 제출 (고객)' })
  async create(@Req() req: AuthenticatedRequest, @Body() dto: CreateRefundRequestDto) {
    if (!req.jwtUserId) throw new UnauthorizedException('JWT authentication required');
    const { intentId, ...account } = dto;
    const request = await this.service.create(intentId, account, req.jwtUserId);
    return { id: request.id, status: request.status, createdAt: request.createdAt };
  }

  @Get('by-intent/:intentId')
  @WalletJwtAuth()
  @ApiOperation({ summary: '해당 주문의 대기중 환불 요청 조회 (고객)' })
  async byIntent(@Req() req: AuthenticatedRequest, @Param('intentId') intentId: string) {
    if (!req.jwtUserId) throw new UnauthorizedException('JWT authentication required');
    const request = await this.service.findActiveByIntent(intentId, req.jwtUserId);
    if (!request) return null;
    return { id: request.id, status: request.status, createdAt: request.createdAt };
  }
}
