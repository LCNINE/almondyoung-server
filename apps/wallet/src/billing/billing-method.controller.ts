import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Body,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WalletJwtAuth } from '../wallet-auth.decorator';
import { AuthenticatedRequest } from '../wallet.module';
import { BillingMethodService } from './billing-method.service';
import { BillingMethodResponseDto, RegisterCmsBillingMethodDto } from './dto';
import { BillingMethod } from '../types';

@ApiTags('Billing Methods')
@Controller('v1/billing-methods')
export class BillingMethodController {
  constructor(private readonly service: BillingMethodService) {}

  @Post('cms')
  @HttpCode(201)
  @WalletJwtAuth()
  @ApiOperation({ summary: 'Register a CMS billing method' })
  async registerCms(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RegisterCmsBillingMethodDto,
  ): Promise<BillingMethodResponseDto> {
    const userId = req.jwtUserId!;
    try {
      const method = await this.service.registerCmsBillingMethod(userId, dto.cmsMemberId, dto.displayName);
      return this.toResponse(method);
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('already')) throw new BadRequestException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  @Get()
  @WalletJwtAuth()
  @ApiOperation({ summary: 'List billing methods for the authenticated user' })
  async list(@Req() req: AuthenticatedRequest): Promise<BillingMethodResponseDto[]> {
    const userId = req.jwtUserId!;
    const methods = await this.service.getUserBillingMethods(userId);
    return methods.map((m) => this.toResponse(m));
  }

  @Delete(':id')
  @HttpCode(204)
  @WalletJwtAuth()
  @ApiOperation({ summary: 'Revoke a billing method' })
  async revoke(@Param('id') id: string): Promise<void> {
    try {
      await this.service.revoke(id);
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  private toResponse(m: BillingMethod): BillingMethodResponseDto {
    return {
      id: m.id,
      userId: m.userId,
      providerType: m.providerType,
      displayName: m.displayName,
      method: m.method,
      status: m.status,
      expiresAt: m.expiresAt,
      createdAt: m.createdAt,
    };
  }
}
