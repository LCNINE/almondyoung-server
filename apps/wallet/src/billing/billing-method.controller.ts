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
  Put,
  Body,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WalletJwtAuth } from '../wallet-auth.decorator';
import { AuthenticatedRequest } from '../wallet.module';
import { BillingMethodService } from './billing-method.service';
import { CmsMemberService } from '../cms/cms-member.service';
import { BillingMethodResponseDto, CmsBankAccountDto, RegisterCmsBillingMethodDto } from './dto';
import { BillingMethod } from '../types';

@ApiTags('Billing Methods')
@Controller('v1/billing-methods')
export class BillingMethodController {
  constructor(
    private readonly service: BillingMethodService,
    private readonly cmsMemberService: CmsMemberService,
  ) {}

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

  @Post('cms/register')
  @HttpCode(201)
  @WalletJwtAuth()
  @ApiOperation({ summary: 'CMS 은행 계좌 등록 — 효성 CMS API 호출 후 billing_method 생성' })
  async registerCmsBankAccount(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CmsBankAccountDto,
  ): Promise<BillingMethodResponseDto> {
    const userId = req.jwtUserId!;
    try {
      const { billingMethod } = await this.cmsMemberService.registerMember(userId, dto);
      return this.toResponse(billingMethod);
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('already')) throw new BadRequestException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  @Put('cms/:id')
  @WalletJwtAuth()
  @ApiOperation({ summary: 'CMS 은행 계좌 변경 — 효성 CMS API 업데이트 후 cms_members PENDING 상태로 전환' })
  async updateCmsBankAccount(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: CmsBankAccountDto,
  ): Promise<void> {
    const userId = req.jwtUserId!;
    try {
      await this.cmsMemberService.updateBankAccount(id, userId, dto);
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found') || msg.includes('access denied')) throw new NotFoundException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  @Get()
  @WalletJwtAuth()
  @ApiOperation({ summary: 'List billing methods for the authenticated user' })
  async list(@Req() req: AuthenticatedRequest): Promise<BillingMethodResponseDto[]> {
    const userId = req.jwtUserId!;
    const [methods, cmsMembers] = await Promise.all([
      this.service.getUserBillingMethods(userId),
      this.cmsMemberService.findByUserId(userId),
    ]);
    // CMS_BATCH는 효성 회원 등록 확정(REGISTERED) 전까지 사용 불가 — PENDING/FAILED는 제외
    const confirmedCmsIds = new Set(
      cmsMembers.filter((m) => m.status === 'REGISTERED').map((m) => m.billingMethodId),
    );
    return methods
      .filter((m) => m.providerType !== 'CMS_BATCH' || confirmedCmsIds.has(m.id))
      .map((m) => this.toResponse(m));
  }

  @Delete(':id')
  @HttpCode(204)
  @WalletJwtAuth()
  @ApiOperation({ summary: 'Revoke a billing method' })
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
