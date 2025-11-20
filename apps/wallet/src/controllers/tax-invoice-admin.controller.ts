import {
  Controller,
  Post,
  Get,
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
import { JwtAuthGuard } from '../../../../libs/auth-core/src/guards/jwt-auth.guard';
import { User } from '../../../../libs/auth-core/src/decorators/user.decorator';
import { TaxInvoiceAdminService } from '../services/tax/tax-invoice-admin.service';
import {
  MarkExportedSchema,
  ConfirmIssuedSchema,
  MarkFailedSchema,
  CancelInvoiceSchema,
  GetAdminInvoicesSchema,
  type MarkExportedDto,
  type ConfirmIssuedDto,
  type MarkFailedDto,
  type CancelInvoiceDto,
  type GetAdminInvoicesDto,
} from '../shared/zods/tax-invoices.zod';

/**
 * TaxInvoiceAdminController (관리자용)
 *
 * 책임: 세금계산서 발행 관리 (엑셀 내보내기, 발행 완료/실패, 취소)
 */
@Controller('admin/tax-invoices')
@UseGuards(JwtAuthGuard)
export class TaxInvoiceAdminController {
  private readonly logger = new Logger(TaxInvoiceAdminController.name);

  constructor(private readonly adminService: TaxInvoiceAdminService) {}

  /**
   * GET /admin/tax-invoices/requested
   * 발행 대기 목록 조회 (REQUESTED 상태)
   */
  @Get('requested')
  async getRequested(
    @Query('limit') limit = 50,
    @Query('offset') offset = 0,
  ) {
    try {
      const invoices = await this.adminService.getRequested(
        Number(limit),
        Number(offset),
      );

      return {
        success: true,
        data: invoices,
        pagination: {
          limit: Number(limit),
          offset: Number(offset),
          total: invoices.length,
        },
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * GET /admin/tax-invoices
   * 전체 세금계산서 조회 (필터/페이지네이션)
   */
  @Get()
  async getAll(@Query() query: GetAdminInvoicesDto) {
    try {
      // Validation
      const dto = GetAdminInvoicesSchema.parse(query);

      // 비즈니스 로직
      const invoices = await this.adminService.getAll({
        status: dto.status,
        userId: dto.userId,
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
   * GET /admin/tax-invoices/:id
   * 세금계산서 상세 조회
   */
  @Get(':id')
  async getInvoiceDetail(@Param('id') invoiceId: string) {
    try {
      const invoice = await this.adminService.getInvoiceById(invoiceId);

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
   * POST /admin/tax-invoices/mark-exported
   * 엑셀 내보내기 처리 (일괄)
   * REQUESTED -> EXPORTED
   */
  @Post('mark-exported')
  @HttpCode(HttpStatus.OK)
  async markExported(
    @Body() body: MarkExportedDto,
    @User('userId') operatorId: string,
  ) {
    try {
      // Validation
      const dto = MarkExportedSchema.parse(body);

      // 비즈니스 로직
      const result = await this.adminService.markExported(
        dto.invoiceIds,
        operatorId,
      );

      return {
        success: true,
        data: result,
        message: `${result.success.length}건 내보내기 완료, ${result.failed.length}건 실패`,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * POST /admin/tax-invoices/:id/confirm-issued
   * 발행 완료 처리
   * EXPORTED -> ISSUED_CONFIRMED
   */
  @Post(':id/confirm-issued')
  @HttpCode(HttpStatus.OK)
  async confirmIssued(
    @Param('id') invoiceId: string,
    @Body() body: ConfirmIssuedDto,
    @User('userId') operatorId: string,
  ) {
    try {
      // Validation
      const dto = ConfirmIssuedSchema.parse(body);

      // 비즈니스 로직
      await this.adminService.confirmIssued(
        invoiceId,
        dto.hometaxIssueNo,
        dto.hometaxIssueDate,
        operatorId,
      );

      return {
        success: true,
        message: '발행 완료 처리되었습니다',
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * POST /admin/tax-invoices/:id/mark-failed
   * 발행 실패 처리
   * EXPORTED -> FAILED
   */
  @Post(':id/mark-failed')
  @HttpCode(HttpStatus.OK)
  async markFailed(
    @Param('id') invoiceId: string,
    @Body() body: MarkFailedDto,
    @User('userId') operatorId: string,
  ) {
    try {
      // Validation
      const dto = MarkFailedSchema.parse(body);

      // 비즈니스 로직
      await this.adminService.markFailed(
        invoiceId,
        dto.failReason,
        dto.errorCode,
        operatorId,
      );

      return {
        success: true,
        message: '발행 실패 처리되었습니다',
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * POST /admin/tax-invoices/:id/cancel
   * 취소 처리
   * REQUESTED -> CANCELLED
   */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id') invoiceId: string,
    @Body() body: CancelInvoiceDto,
    @User('userId') operatorId: string,
  ) {
    try {
      // Validation
      const dto = CancelInvoiceSchema.parse(body);

      // 비즈니스 로직
      await this.adminService.cancel(invoiceId, dto.cancelReason, operatorId);

      return {
        success: true,
        message: '취소 처리되었습니다',
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * 에러 처리
   */
  private handleError(error: any): never {
    this.logger.error(
      `세금계산서 관리 실패: ${error.message}`,
      error.stack,
    );

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
      message.includes('Invalid') ||
      message.includes('잘못된') ||
      message.includes('required') ||
      message.includes('필요합니다')
    ) {
      throw new BadRequestException(message);
    }

    // 기타 에러는 500
    throw new BadRequestException(message);
  }
}

