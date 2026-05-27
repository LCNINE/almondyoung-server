import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WalletJwtAuth } from '../wallet-auth.decorator';
import { AuthenticatedRequest } from '../wallet.module';
import { BillingAgreementService } from './billing-agreement.service';
import { BillingAgreementResponseDto, CreateBillingAgreementDto, UpdateBillingMethodDto } from './dto';
import { BillingAgreement } from '../types';

@ApiTags('Billing Agreements')
@Controller('v1/billing-agreements')
export class BillingAgreementController {
  constructor(private readonly service: BillingAgreementService) {}

  @Post()
  @ApiOperation({ summary: 'Create billing agreement (server-to-server, API key auth)' })
  async create(@Body() dto: CreateBillingAgreementDto): Promise<BillingAgreementResponseDto> {
    try {
      const agreement = dto.billingMethodId
        ? await this.service.create(dto.userId, dto.billingMethodId, dto.subscriberRef, dto.subscriberType)
        : await this.service.createWithAutoMethod(dto.userId, dto.subscriberRef, dto.subscriberType);
      return this.toResponse(agreement);
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found') || msg.includes('no active')) throw new NotFoundException(e.message);
      if (msg.match(/inactive|invalid|already/)) throw new BadRequestException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  @Get()
  @WalletJwtAuth()
  @ApiOperation({ summary: 'List billing agreements for the authenticated user' })
  async list(@Req() req: AuthenticatedRequest): Promise<BillingAgreementResponseDto[]> {
    const userId = req.jwtUserId!;
    const agreements = await this.service.findByUserId(userId);
    return agreements.map((a) => this.toResponse(a));
  }

  @Put(':id/billing-method')
  @WalletJwtAuth()
  @ApiOperation({ summary: 'Update billing method for a billing agreement' })
  async updateBillingMethod(
    @Param('id') id: string,
    @Body() dto: UpdateBillingMethodDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    try {
      const userId = req.jwtUserId!;
      await this.service.updateBillingMethod(id, dto.billingMethodId, userId);
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException(e.message);
      if (msg.match(/inactive|invalid/)) throw new BadRequestException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  @Delete('by-subscriber')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke billing agreement by subscriber ref (server-to-server, API key auth)' })
  async revokeBySubscriber(
    @Query('subscriberType') subscriberType: string,
    @Query('subscriberRef') subscriberRef: string,
  ): Promise<void> {
    try {
      await this.service.revokeBySubscriberRef(subscriberType, subscriberRef);
    } catch (e: any) {
      throw new InternalServerErrorException(e.message);
    }
  }

  @Delete(':id')
  @HttpCode(204)
  @WalletJwtAuth()
  @ApiOperation({ summary: 'Revoke a billing agreement' })
  async revoke(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    try {
      const userId = req.jwtUserId!;
      await this.service.revoke(id, userId);
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  private toResponse(a: BillingAgreement): BillingAgreementResponseDto {
    return {
      id: a.id,
      userId: a.userId,
      billingMethodId: a.billingMethodId,
      subscriberRef: a.subscriberRef,
      subscriberType: a.subscriberType,
      status: a.status,
      createdAt: a.createdAt,
    };
  }
}
