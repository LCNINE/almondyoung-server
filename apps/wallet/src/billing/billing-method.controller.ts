import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Put,
  Body,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WalletJwtAuth } from '../wallet-auth.decorator';
import { AuthenticatedRequest } from '../wallet.module';
import { BillingMethodService } from './billing-method.service';
import { CmsMemberService } from '../cms/cms-member.service';
import { CmsRegistrationService } from '../cms/cms-registration.service';
import { isCmsOperationError } from '../cms/cms-errors';
import {
  BillingMethodResponseDto,
  CmsBankAccountDto,
  CmsBillingMethodStatusDto,
  RegisterCmsBillingMethodDto,
  RegisterCmsWithAgreementResponseDto,
} from './dto';
import { BillingMethod } from '../types';
import {
  FastifyMultipartInterceptor,
  FastifyUploadedFile,
  UploadedFastifyFile,
} from '../common/fastify-multipart.interceptor';

@ApiTags('Billing Methods')
@Controller('v1/billing-methods')
export class BillingMethodController {
  constructor(
    private readonly service: BillingMethodService,
    private readonly cmsMemberService: CmsMemberService,
    private readonly cmsRegistrationService: CmsRegistrationService,
  ) {}

  private mapCmsError(error: unknown): never {
    if (isCmsOperationError(error)) {
      throw new HttpException({ code: error.code, message: error.customerMessage }, error.statusCode);
    }

    const message = error instanceof Error ? error.message : 'CMS 처리 중 오류가 발생했습니다.';
    throw new InternalServerErrorException(message);
  }

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
      this.mapCmsError(e);
    }
  }

  @Post('cms/register')
  @HttpCode(201)
  @WalletJwtAuth()
  @ApiOperation({
    summary: 'CMS 은행 계좌 등록 (Deprecated — register-with-agreement 사용 권장)',
    description:
      '동의자료 없이 회원만 등록합니다. ' +
      'wallet-web 하위 호환을 위해 유지 중이며 wallet-web 이전 완료 후 제거 예정입니다. ' +
      '신규 고객 플로우는 POST /v1/billing-methods/cms/register-with-agreement 를 사용하세요.',
    deprecated: true,
  })
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
      this.mapCmsError(e);
    }
  }

  @Post('cms/register-with-agreement')
  @HttpCode(201)
  @WalletJwtAuth()
  @UseInterceptors(new FastifyMultipartInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'CMS 계좌 등록 + 전자서명 동의자료 업로드 통합 — 효성 회원등록 후 동의자료 연속 제출' })
  async registerCmsBankAccountWithAgreement(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CmsBankAccountDto,
    @UploadedFastifyFile() file: FastifyUploadedFile,
  ): Promise<RegisterCmsWithAgreementResponseDto> {
    if (!file?.buffer) {
      throw new BadRequestException('전자서명 파일이 필요합니다');
    }
    const userId = req.jwtUserId!;
    const fileExtension = (file.originalname.split('.').pop() ?? 'png').toLowerCase();
    try {
      const result = await this.cmsRegistrationService.registerWithAgreement(userId, dto, file.buffer, fileExtension);
      return {
        id: result.billingMethod.id,
        userId: result.billingMethod.userId,
        providerType: result.billingMethod.providerType,
        displayName: result.billingMethod.displayName,
        status: result.billingMethod.status,
        createdAt: result.billingMethod.createdAt,
        cmsMemberId: result.cmsMember.cmsMemberId,
        cmsMemberStatus: result.cmsMember.status,
        agreementStatus: result.agreement?.status ?? null,
        agreementUploadFailed: result.agreementUploadFailed,
      };
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('already')) throw new BadRequestException(e.message);
      this.mapCmsError(e);
    }
  }

  @Put('cms/:id/with-agreement')
  @WalletJwtAuth()
  @UseInterceptors(new FastifyMultipartInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'CMS 계좌 변경 + 전자서명 동의자료 업로드 — 기존 동의자료 무효화 후 새 동의자료 제출' })
  async updateCmsBankAccountWithAgreement(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: CmsBankAccountDto,
    @UploadedFastifyFile() file: FastifyUploadedFile,
  ): Promise<RegisterCmsWithAgreementResponseDto> {
    if (!file?.buffer) {
      throw new BadRequestException('전자서명 파일이 필요합니다');
    }
    const userId = req.jwtUserId!;
    const fileExtension = (file.originalname.split('.').pop() ?? 'png').toLowerCase();
    try {
      const result = await this.cmsRegistrationService.updateWithAgreement(id, userId, dto, file.buffer, fileExtension);
      return {
        id: result.billingMethod.id,
        userId: result.billingMethod.userId,
        providerType: result.billingMethod.providerType,
        displayName: result.billingMethod.displayName,
        status: result.billingMethod.status,
        createdAt: result.billingMethod.createdAt,
        cmsMemberId: result.cmsMember.cmsMemberId,
        cmsMemberStatus: result.cmsMember.status,
        agreementStatus: result.agreement?.status ?? null,
        agreementUploadFailed: result.agreementUploadFailed,
      };
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found') || msg.includes('access denied')) throw new NotFoundException(e.message);
      this.mapCmsError(e);
    }
  }

  @Put('cms/:id')
  @WalletJwtAuth()
  @ApiOperation({
    summary: 'CMS 은행 계좌 변경 (Deprecated — with-agreement 사용 권장)',
    description:
      '동의자료 없이 계좌만 변경합니다. 호출 시 기존 동의자료가 "변경됨"으로 무효화되어 ' +
      'isSelectableForRecurringBilling=false 상태가 되며, 새 서명 업로드 없이는 정기결제 불가 상태가 유지됩니다. ' +
      '신규 변경 플로우는 PUT /v1/billing-methods/cms/:id/with-agreement 를 사용하세요.',
    deprecated: true,
  })
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
      this.mapCmsError(e);
    }
  }

  @Get('cms')
  @WalletJwtAuth()
  @ApiOperation({
    summary: 'CMS 결제수단 심사 상태 목록 — PENDING/FAILED 포함, 고객 결제수단 관리 화면용',
  })
  async listCmsStatuses(@Req() req: AuthenticatedRequest): Promise<CmsBillingMethodStatusDto[]> {
    const userId = req.jwtUserId!;
    const rows = await this.service.getUserCmsBillingMethodStatuses(userId);
    return rows.map((r) => ({
      billingMethodId: r.billingMethodId,
      userId: r.userId,
      providerType: r.providerType,
      displayName: r.displayName,
      billingMethodStatus: r.billingMethodStatus,
      cmsMemberId: r.cmsMemberId,
      cmsMemberStatus: r.cmsMemberStatus,
      agreementStatus: r.agreementStatus,
      isSelectableForRecurringBilling: r.isSelectableForRecurringBilling,
      statusLabel: r.statusLabel,
      resultCode: r.resultCode,
      resultMessage: r.resultMessage,
      paymentCompany: r.paymentCompany,
      payerName: r.payerName,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  @Get()
  @WalletJwtAuth()
  @ApiOperation({ summary: 'List billing methods for the authenticated user' })
  async list(@Req() req: AuthenticatedRequest): Promise<BillingMethodResponseDto[]> {
    const userId = req.jwtUserId!;
    const [methods, cmsStatuses] = await Promise.all([
      this.service.getUserBillingMethods(userId),
      this.service.getUserCmsBillingMethodStatuses(userId),
    ]);
    // CMS_BATCH는 REGISTERED + 동의자료 등록(agreementStatus=등록)까지 확인 — 미달 수단은 결제 불가
    const selectableCmsIds = new Set(
      cmsStatuses.filter((s) => s.isSelectableForRecurringBilling).map((s) => s.billingMethodId),
    );
    return methods
      .filter((m) => m.providerType !== 'CMS_BATCH' || selectableCmsIds.has(m.id))
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
      if (msg.includes('not found') || msg.includes('inactive')) throw new NotFoundException(e.message);
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
