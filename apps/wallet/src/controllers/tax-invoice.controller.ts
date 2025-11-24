import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, User } from '@app/authorization';
import { TaxInvoiceService } from '../services/tax/tax-invoice.service';
import { TaxInvoicePreferenceService } from '../services/tax/tax-invoice-preference.service';
import {
  CreateIntentSchema,
  UpdatePreferenceSchema,
  GetMyInvoicesSchema,
  type CreateIntentDto,
  type UpdatePreferenceDto,
  type GetMyInvoicesDto,
} from '../shared/zods/tax-invoices.zod';

/**
 * TaxInvoiceController (사용자용)
 *
 * 책임: 세금계산서 신청, 조회, 기본 설정 관리
 */
@Controller('tax-invoices')
@UseGuards(JwtAuthGuard)
export class TaxInvoiceController {
  private readonly logger = new Logger(TaxInvoiceController.name);

  constructor(
    private readonly taxInvoiceService: TaxInvoiceService,
    private readonly preferenceService: TaxInvoicePreferenceService,
  ) {}

  /**
   * POST /tax-invoices/intent
   * 세금계산서 신청
   */
  @Post('intent')
  @HttpCode(HttpStatus.CREATED)
  async createIntent(
    @Body() body: CreateIntentDto,
    @User('userId') userId: string,
  ) {
    try {
      // Validation
      const dto = CreateIntentSchema.parse(body);

      // 비즈니스 로직
      const invoice = await this.taxInvoiceService.createIntent(userId, dto);

      return {
        success: true,
        data: invoice,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * GET /tax-invoices/my
   * 내 세금계산서 목록 조회
   */
  @Get('my')
  async getMyInvoices(
    @Query() query: GetMyInvoicesDto,
    @User('userId') userId: string,
  ) {
    try {
      // Validation
      const dto = GetMyInvoicesSchema.parse(query);

      // 비즈니스 로직
      const invoices = await this.taxInvoiceService.getMyInvoices({
        userId,
        status: dto.status,
        fromDate: dto.fromDate,
        toDate: dto.toDate,
        limit: dto.limit,
        offset: dto.offset,
      });

      return {
        success: true,
        data: invoices,
        pagination: {
          limit: dto.limit,
          offset: dto.offset,
          total: invoices.length,
        },
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * GET /tax-invoices/:id
   * 세금계산서 상세 조회 (스냅샷 포함)
   */
  @Get(':id')
  async getInvoiceDetail(@Param('id') invoiceId: string) {
    try {
      const invoice =
        await this.taxInvoiceService.getInvoiceWithSnapshot(invoiceId);

      if (!invoice) {
        throw new NotFoundException('세금계산서를 찾을 수 없습니다');
      }

      return {
        success: true,
        data: invoice,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * GET /tax-invoices/preferences
   * 기본 설정 조회
   */
  @Get('preferences')
  async getPreferences(@User('userId') userId: string) {
    try {
      const preference =
        await this.preferenceService.getPreferenceOrDefault(userId);

      return {
        success: true,
        data: preference,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * PATCH /tax-invoices/preferences
   * 기본 설정 업데이트
   */
  @Patch('preferences')
  async updatePreferences(
    @Body() body: UpdatePreferenceDto,
    @User('userId') userId: string,
  ) {
    try {
      // Validation
      const dto = UpdatePreferenceSchema.parse(body);

      // 비즈니스 로직
      const preference = await this.preferenceService.updatePreference(
        userId,
        dto.defaultEnabled,
        dto.defaultBusinessInfo,
      );

      return {
        success: true,
        data: preference,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * 에러 처리 (NestJS 레이어 패턴)
   * Service에서 던진 Error를 HTTP Exception으로 변환
   */
  private handleError(error: any): never {
    this.logger.error(`세금계산서 처리 실패: ${error.message}`, error.stack);

    const message = error.message || '세금계산서 처리 중 오류가 발생했습니다';

    // 문자열 패턴 기반 에러 매핑
    if (
      message.includes('not found') ||
      message.includes('찾을 수 없습니다')
    ) {
      throw new NotFoundException(message);
    }

    if (
      message.includes('already') ||
      message.includes('이미') ||
      message.includes('중복')
    ) {
      throw new ConflictException(message);
    }

    if (
      message.includes('required') ||
      message.includes('필요합니다') ||
      message.includes('invalid') ||
      message.includes('올바르지') ||
      message.includes('형식') ||
      message.includes('취소된') ||
      message.includes('실패') ||
      message.includes('만원 이상')
    ) {
      throw new BadRequestException(message);
    }

    // 기타 에러는 500
    throw new BadRequestException(message);
  }
}

