import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
  Logger,
  Res,
  BadRequestException,
  Headers,
} from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';

import { TaxInvoiceService } from '../services/tax-invoice.service';
import { IdempotencyService } from '../services/idempotency.service';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { runInTransaction } from '../shared/database';

import {
  CreateTaxInvoiceSchema,
  TaxInvoiceFilterSchema,
  ExportBatchSchema,
  UpdateBatchResultSchema,
  CreateTaxInvoiceDto,
  TaxInvoiceFilterDto,
  ExportBatchDto,
  UpdateBatchResultDto,
} from '../shared/zods/tax-invoices.zod';

/**
 * TaxInvoiceController - 세금계산서 API 엔드포인트
 *
 * 책임:
 * - HTTP 요청/응답 처리
 * - DTO 유효성 검증 (Zod)
 * - 서비스 계층 호출 및 에러 변환
 * - 멱등성 키 처리
 */
@ApiTags('Tax Invoices')
@Controller('v2/tax-invoices')
export class TaxInvoiceController {
  private readonly logger = new Logger(TaxInvoiceController.name);

  constructor(
    private readonly taxInvoiceService: TaxInvoiceService,
    private readonly idempotencyService: IdempotencyService,
    private readonly db: DbService<typeof schema>,
  ) {}

  /**
   * 새로운 세금계산서를 생성합니다.
   * 주로 주문 확정/배송 완료 이벤트에서 호출됩니다.
   */
  @Post()
  @ApiOperation({
    summary: '세금계산서 생성',
    description: '주문 확정 시 세금계산서를 생성합니다.',
  })
  @ApiResponse({
    status: 201,
    description: '세금계산서 생성 성공',
  })
  async createTaxInvoice(
    @Body(new ZodValidationPipe(CreateTaxInvoiceSchema))
    dto: CreateTaxInvoiceDto,
    @Headers('Idempotency-Key') idemKey?: string,
  ) {
    try {
      this.logger.log(`세금계산서 생성 요청: ${dto.externalOrderId}`);

      return runInTransaction(this.db, async (tx) => {
        // 멱등성 키 처리
        const { hit, response } = await this.idempotencyService.checkOrCreate(
          tx,
          idemKey,
          dto.userId,
          dto,
          'v2/tax-invoices',
        );
        if (hit) return response;

        const taxInvoice = await this.taxInvoiceService.createTaxInvoice(
          dto,
          tx,
        );

        await this.idempotencyService.complete(tx, idemKey, taxInvoice);
        return taxInvoice;
      });
    } catch (error) {
      this.handleError(error, '세금계산서 생성');
    }
  }

  /**
   * 세금계산서 목록을 조회합니다.
   */
  @Get()
  @ApiOperation({
    summary: '세금계산서 목록 조회',
    description: '필터 조건에 따라 세금계산서 목록을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '세금계산서 목록 조회 성공',
  })
  async getTaxInvoices(
    @Query(new ZodValidationPipe(TaxInvoiceFilterSchema))
    filter: TaxInvoiceFilterDto,
  ) {
    try {
      this.logger.log(`세금계산서 목록 조회: ${JSON.stringify(filter)}`);

      const invoices = await this.taxInvoiceService.findTaxInvoices(filter);

      return {
        data: invoices,
        pagination: {
          limit: filter.limit,
          offset: filter.offset,
          total: invoices.length, // 실제로는 별도 count 쿼리 필요
        },
      };
    } catch (error) {
      this.handleError(error, '세금계산서 목록 조회');
    }
  }

  /**
   * 특정 세금계산서를 조회합니다.
   */
  @Get(':invoiceId')
  @ApiOperation({
    summary: '세금계산서 상세 조회',
    description: 'ID로 특정 세금계산서의 상세 정보를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '세금계산서 조회 성공',
  })
  async getTaxInvoice(@Param('invoiceId') invoiceId: string) {
    try {
      this.logger.log(`세금계산서 조회: ${invoiceId}`);

      const invoice =
        await this.taxInvoiceService.findTaxInvoiceById(invoiceId);

      if (!invoice) {
        throw new HttpException(
          `Tax invoice not found: ${invoiceId}`,
          HttpStatus.NOT_FOUND,
        );
      }

      return invoice;
    } catch (error) {
      this.handleError(error, '세금계산서 조회');
    }
  }

  /**
   * PENDING 상태의 세금계산서들을 엑셀로 export합니다.
   */
  @Post('export/batch')
  @ApiOperation({
    summary: '세금계산서 배치 export',
    description:
      'PENDING 상태의 세금계산서들을 홈택스 업로드용 엑셀 파일로 생성합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '엑셀 파일 생성 성공',
  })
  async exportBatch(
    @Body(new ZodValidationPipe(ExportBatchSchema)) dto: ExportBatchDto,
    @Res() reply: FastifyReply,
  ) {
    try {
      this.logger.log(`세금계산서 배치 export: ${dto.batchPeriod}`);

      const result =
        await this.taxInvoiceService.exportPendingInvoicesToExcel(dto);

      // 엑셀 파일을 HTTP 응답으로 전송
      reply.header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      reply.header(
        'Content-Disposition',
        `attachment; filename="${result.fileName}"`,
      );
      reply.header('X-Batch-Id', result.batchId);
      reply.header('X-Record-Count', result.recordCount.toString());

      return reply.send(Buffer.from(result.fileBuffer));
    } catch (error) {
      this.handleError(error, '세금계산서 배치 export');
    }
  }

  /**
   * 홈택스 발급 결과를 반영합니다.
   */
  @Post('batch/:batchId/results')
  @ApiOperation({
    summary: '홈택스 발급 결과 반영',
    description:
      '홈택스에서 발급된 세금계산서의 승인번호와 결과를 시스템에 반영합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '발급 결과 반영 성공',
  })
  async updateBatchResults(
    @Param('batchId') batchId: string,
    @Body(new ZodValidationPipe(UpdateBatchResultSchema))
    dto: UpdateBatchResultDto,
    @Headers('Idempotency-Key') idemKey?: string,
  ) {
    try {
      this.logger.log(
        `홈택스 발급 결과 반영: batch ${batchId}, ${dto.results.length}건`,
      );

      // batchId 일치 검증
      if (dto.batchId !== batchId) {
        throw new BadRequestException('Batch ID mismatch');
      }

      return runInTransaction(this.db, async (tx) => {
        // 멱등성 키 처리
        const { hit, response } = await this.idempotencyService.checkOrCreate(
          tx,
          idemKey,
          'system', // 시스템 작업이므로 고정값
          dto,
          `v2/tax-invoices/batch/${batchId}/results`,
        );
        if (hit) return response;

        await this.taxInvoiceService.updateBatchResults(dto, tx);

        const result = {
          success: true,
          batchId,
          processedCount: dto.results.length,
          successCount: dto.results.filter((r) => r.approved).length,
          errorCount: dto.results.filter((r) => !r.approved).length,
        };

        await this.idempotencyService.complete(tx, idemKey, result);
        return result;
      });
    } catch (error) {
      this.handleError(error, '홈택스 발급 결과 반영');
    }
  }

  /**
   * 환불/취소를 위한 수정세금계산서를 생성합니다.
   */
  @Post(':invoiceId/refund')
  @ApiOperation({
    summary: '수정세금계산서 생성 (환불)',
    description: '환불/취소 시 수정세금계산서를 생성합니다.',
  })
  @ApiResponse({
    status: 201,
    description: '수정세금계산서 생성 성공',
  })
  async createRefundInvoice(
    @Param('invoiceId') invoiceId: string,
    @Body()
    body: {
      refundAmount: number;
      reason: string;
    },
    @Headers('Idempotency-Key') idemKey?: string,
  ) {
    try {
      this.logger.log(
        `수정세금계산서 생성: ${invoiceId}, 환불액: ${body.refundAmount}`,
      );

      // 간단한 유효성 검증
      if (!body.refundAmount || body.refundAmount <= 0) {
        throw new BadRequestException('Invalid refund amount');
      }
      if (!body.reason || body.reason.trim().length === 0) {
        throw new BadRequestException('Refund reason is required');
      }

      return runInTransaction(this.db, async (tx) => {
        // 멱등성 키 처리
        const { hit, response } = await this.idempotencyService.checkOrCreate(
          tx,
          idemKey,
          'system', // 환불은 시스템에서 처리
          body,
          `v2/tax-invoices/${invoiceId}/refund`,
        );
        if (hit) return response;

        const refundInvoice = await this.taxInvoiceService.createRefundInvoice(
          invoiceId,
          body.refundAmount,
          body.reason,
          tx,
        );

        await this.idempotencyService.complete(tx, idemKey, refundInvoice);
        return refundInvoice;
      });
    } catch (error) {
      this.handleError(error, '수정세금계산서 생성');
    }
  }

  /**
   * 배치별 세금계산서 목록을 조회합니다.
   */
  @Get('batch/:batchId')
  @ApiOperation({
    summary: '배치별 세금계산서 조회',
    description: '특정 배치에 포함된 세금계산서 목록을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '배치 세금계산서 조회 성공',
  })
  async getBatchInvoices(@Param('batchId') batchId: string) {
    try {
      this.logger.log(`배치 세금계산서 조회: ${batchId}`);

      const filter: TaxInvoiceFilterDto = {
        batchId,
        limit: 1000, // 배치는 최대 1000건
        offset: 0,
      };

      const invoices = await this.taxInvoiceService.findTaxInvoices(filter);

      return {
        batchId,
        invoices,
        totalCount: invoices.length,
      };
    } catch (error) {
      this.handleError(error, '배치 세금계산서 조회');
    }
  }

  /**
   * 컨트롤러에서 발생하는 에러를 중앙에서 처리하여 HTTP 응답으로 변환합니다.
   * CTO 스타일: error.message 패턴 매칭으로 HTTP 상태 코드 결정
   */
  private handleError(error: unknown, context: string): never {
    this.logger.error(
      `❌ ${context} 실패: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error.stack : undefined,
    );

    if (error instanceof HttpException) {
      // 이미 HTTP 에러인 경우 그대로 다시 던짐
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);

    // CTO 스타일: 에러 메시지 패턴으로 HTTP 상태 코드 매핑
    if (message.includes('not found')) {
      throw new HttpException(message, HttpStatus.NOT_FOUND);
    }

    if (
      message.includes('already exists') ||
      message.includes('exceeds') ||
      message.includes('required') ||
      message.includes('invalid') ||
      message.includes('failed') ||
      message.includes('mismatch')
    ) {
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }

    // 예측하지 못한 모든 에러는 500 서버 에러로 처리
    throw new HttpException(
      '서버 내부 오류가 발생했습니다.',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
