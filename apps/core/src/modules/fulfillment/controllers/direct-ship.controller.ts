import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  UsePipes,
  Res,
  Req,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import type { FastifyRequest } from 'fastify';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody, ApiConsumes } from '@nestjs/swagger';
import { DirectShipService, DirectShipOrder } from '../services/direct-ship.service';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { z } from 'zod';
import { DirectShipCancelNoticeService } from '../direct-ship-cancel-notice/direct-ship-cancel-notice.service';
import { SupplierShipmentQueueReader } from '../supplier-shipment/supplier-shipment-queue.reader';
import { SupplierQueueShipmentDto, SupplierQueueSummaryDto } from '../dto/supplier-shipment-queue.dto';
import { RequirePermission, User, PiiResponse, PiiExport, OPEN_WITH_RECIPIENT } from '@app/authorization';
import { SupplierHandoffService, type SupplierSheet } from '../supplier-shipment/supplier-handoff.service';
import { SupplierSheetApplyResultDto, SupplierSheetDto, SupplierSheetPreviewDto } from '../dto/supplier-sheet.dto';
import {
  SupplierSheetApplyService,
  type SupplierSheetApplyResult,
  type SupplierSheetPreview,
} from '../supplier-shipment/supplier-sheet-apply.service';
import { readWorkbookUpload } from '../../catalog/operations/bulk-session/services/bulk-upload.multipart';

const ForwardOrdersSchema = z.object({
  fulfillmentOrderIds: z.array(z.string().uuid()).min(1),
  companyName: z.string().min(1),
});

const CancelNoticeExportSchema = z.object({
  supplierId: z.string().uuid(),
  noticeIds: z.array(z.string().uuid()).min(1).max(500),
});

const CancelNoticeNotifiedSchema = z.object({
  supplierId: z.string().uuid(),
  noticeIds: z.array(z.string().uuid()).min(1).max(500),
});

type AuthenticatedUser = { id?: string; userId?: string };

const CompleteOrdersSchema = z.object({
  fulfillmentOrderIds: z.array(z.string().uuid()).min(1),
  completedBy: z.string().min(1),
});

/** 직배 시트의 개인정보 칸 — 넘김과 다시 받기가 같은 응답이다 */
const SUPPLIER_SHEET_PII = {
  fields: {
    'rows[].recipientName': 'name',
    'rows[].recipientPhone': 'phone',
    'rows[].address': 'address',
    'rows[].entrancePassword': 'secret',
    'rows[].deliveryMemo': 'text',
  },
  subjects: [{ path: 'rows[].salesOrderId', type: 'sales_order' }],
  rawWithByField: {
    'rows[].recipientName': OPEN_WITH_RECIPIENT,
    'rows[].recipientPhone': OPEN_WITH_RECIPIENT,
    'rows[].address': OPEN_WITH_RECIPIENT,
    'rows[].entrancePassword': OPEN_WITH_RECIPIENT,
    'rows[].deliveryMemo': OPEN_WITH_RECIPIENT,
  },
} as const;

const ExportOrdersSchema = z.object({
  companyName: z.string().min(1),
  format: z.enum(['csv', 'xlsx']).default('csv'),
});

@ApiTags('Direct Ship')
@Controller('direct-ship')
export class DirectShipController {
  constructor(
    private readonly directShipService: DirectShipService,
    private readonly cancelNotices: DirectShipCancelNoticeService,
    private readonly supplierQueue: SupplierShipmentQueueReader,
    private readonly supplierHandoffs: SupplierHandoffService,
    private readonly supplierUploads: SupplierSheetApplyService,
  ) {}

  @RequirePermission('fulfillment.order.read')
  @Get('supplier-queue')
  @ApiOperation({ summary: '직배 목록 — 입점사별 대기·넘긴 상자 수와 못 보냄 라인 수' })
  @ApiResponse({ status: 200, type: [SupplierQueueSummaryDto] })
  async getSupplierQueue(): Promise<SupplierQueueSummaryDto[]> {
    return this.supplierQueue.summaryBySupplier();
  }

  @RequirePermission('fulfillment.order.read')
  @Get('supplier-queue/:supplierId/shipments')
  @ApiOperation({ summary: '직배 목록 — 한 입점사의 열린 상자와 라인' })
  @ApiQuery({ name: 'stage', enum: ['pending', 'forwarded'] })
  @ApiResponse({ status: 200, type: [SupplierQueueShipmentDto] })
  async getSupplierQueueShipments(
    @Param('supplierId', new ParseUUIDPipe()) supplierId: string,
    @Query('stage') stage?: string,
  ): Promise<SupplierQueueShipmentDto[]> {
    if (stage !== 'pending' && stage !== 'forwarded') {
      throw new BadRequestException("stage must be 'pending' or 'forwarded'");
    }
    return this.supplierQueue.openShipments(supplierId, stage);
  }

  @PiiResponse(SUPPLIER_SHEET_PII)
  @PiiExport()
  @RequirePermission('order.order.export')
  @Post('suppliers/:supplierId/handoffs')
  @ApiOperation({ summary: '넘김 — 입점사의 넘기지 않은 상자에 묶음을 찍고 시트를 JSON 으로 돌려준다' })
  @ApiResponse({ status: 201, type: SupplierSheetDto })
  async handOffToSupplier(
    @Param('supplierId', new ParseUUIDPipe()) supplierId: string,
    @User() user: AuthenticatedUser,
  ): Promise<SupplierSheet> {
    const actor = user?.id ?? user?.userId;
    if (!actor) throw new BadRequestException('Authenticated actor is required');
    return this.supplierHandoffs.handOff(supplierId, actor);
  }

  @PiiResponse(SUPPLIER_SHEET_PII)
  @PiiExport()
  @RequirePermission('order.order.export')
  @Get('handoffs/:handoffId/sheet')
  @ApiOperation({ summary: '시트 다시 받기 — 그 묶음의 아직 발송 전인 줄' })
  @ApiResponse({ status: 200, type: SupplierSheetDto })
  async getHandoffSheet(@Param('handoffId', new ParseUUIDPipe()) handoffId: string): Promise<SupplierSheet> {
    return this.supplierHandoffs.sheet(handoffId);
  }

  // 올리기 두 라우트는 `@UploadedFile()` 이 아니라 요청을 직접 받는다 — core 는 Fastify 라 multer 가 죽는다(`readWorkbookUpload`).
  // 응답은 줄 판정(행 키·주문번호·택배사·송장번호)뿐이라 개인정보가 없다 — 파일의 개인정보 칸은 파서가 읽지 않는다.
  @RequirePermission('fulfillment.order.write')
  @Post('suppliers/:supplierId/uploads/preview')
  @HttpCode(200)
  @ApiOperation({ summary: '직배 시트 올리기 미리보기 — 줄마다 판정과 적용에 쓸 토큰. 아무것도 쓰지 않는다' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] },
  })
  @ApiResponse({ status: 200, type: SupplierSheetPreviewDto })
  @ApiResponse({ status: 400, description: '파일 오류(머리글 없음·줄 상한 초과·xlsx 아님)' })
  async previewSupplierUpload(
    @Param('supplierId', new ParseUUIDPipe()) supplierId: string,
    @Req() request: FastifyRequest,
  ): Promise<SupplierSheetPreview> {
    const { buffer } = await readWorkbookUpload(request);
    return this.supplierUploads.preview(supplierId, buffer);
  }

  @RequirePermission('fulfillment.order.write')
  @Post('suppliers/:supplierId/uploads/apply')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '직배 시트 적용 — 미리보기와 같은 파일·토큰일 때만, 파일 하나를 한 트랜잭션으로 나누기·합포장·발송·정정·못 보냄',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' }, previewToken: { type: 'string' } },
      required: ['file', 'previewToken'],
    },
  })
  @ApiResponse({ status: 200, type: SupplierSheetApplyResultDto })
  @ApiResponse({ status: 400, description: '파일 오류 또는 previewToken 없음' })
  @ApiResponse({
    status: 409,
    description: 'SUPPLIER_UPLOAD_PREVIEW_STALE — 미리보기 뒤 판정이 바뀌었다, 다시 미리보기',
  })
  async applySupplierUpload(
    @Param('supplierId', new ParseUUIDPipe()) supplierId: string,
    @Req() request: FastifyRequest,
    @User() user: AuthenticatedUser,
  ): Promise<SupplierSheetApplyResult> {
    // multipart 를 먼저 끝까지 읽는다 — 남긴 채 응답하면 스트림이 매달릴 수 있다(`readWorkbookUpload`)
    const { buffer, fields } = await readWorkbookUpload(request, { fields: ['previewToken'] });
    const previewToken = fields?.previewToken?.trim();
    if (!previewToken) throw new BadRequestException('previewToken is required');
    const actor = user?.id ?? user?.userId;
    if (!actor) throw new BadRequestException('Authenticated actor is required');
    return this.supplierUploads.apply(supplierId, buffer, previewToken, actor);
  }

  @RequirePermission('fulfillment.order.read')
  @Get('dashboard')
  @ApiOperation({ summary: '직송 대시보드' })
  async getDashboard() {
    return this.directShipService.getDashboard();
  }

  @RequirePermission('fulfillment.order.read')
  @Get('companies')
  @ApiOperation({ summary: '직송 회사 목록' })
  async getCompanyList() {
    return this.directShipService.getCompanyList();
  }

  @PiiResponse({
    fields: {
      '[].customerInfo.customerName': 'name',
      '[].customerInfo.customerEmail': 'email',
      '[].customerInfo.customerPhone': 'phone',
      '[].customerInfo.shippingAddress.recipientName': 'name',
      '[].customerInfo.shippingAddress.phone': 'phone',
      '[].customerInfo.shippingAddress.postalCode': 'postal',
      '[].customerInfo.shippingAddress.roadAddress': 'address',
      '[].customerInfo.shippingAddress.detailAddress': 'text',
      '[].customerInfo.shippingAddress.deliveryNote': 'text',
      '[].customerInfo.shippingAddress.personalCustomsCode': 'secret',
    },
    subjects: [
      { path: '[].salesOrderId', type: 'sales_order' },
    ],
    rawWithByField: {
      '[].customerInfo.customerName': OPEN_WITH_RECIPIENT,
      '[].customerInfo.customerPhone': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.recipientName': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.phone': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.postalCode': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.roadAddress': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.detailAddress': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.deliveryNote': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.personalCustomsCode': OPEN_WITH_RECIPIENT,
    },
  })
  @RequirePermission('fulfillment.order.read')
  @Get('orders')
  @ApiOperation({ summary: '직송 주문 목록' })
  @ApiQuery({ name: 'companyName', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'forwarded', 'completed', 'canceled'] })
  @ApiQuery({ name: 'warehouseId', required: false })
  async getDirectShipOrders(
    @Query('companyName') companyName?: string,
    @Query('status') status?: 'pending' | 'forwarded' | 'completed' | 'canceled',
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.directShipService.getDirectShipOrders({ companyName, status, warehouseId });
  }

  @PiiResponse({
    fields: {
      '*[].customerInfo.customerName': 'name',
      '*[].customerInfo.customerEmail': 'email',
      '*[].customerInfo.customerPhone': 'phone',
      '*[].customerInfo.shippingAddress.recipientName': 'name',
      '*[].customerInfo.shippingAddress.phone': 'phone',
      '*[].customerInfo.shippingAddress.postalCode': 'postal',
      '*[].customerInfo.shippingAddress.roadAddress': 'address',
      '*[].customerInfo.shippingAddress.detailAddress': 'text',
      '*[].customerInfo.shippingAddress.deliveryNote': 'text',
      '*[].customerInfo.shippingAddress.personalCustomsCode': 'secret',
    },
    subjects: [
      { path: '*[].salesOrderId', type: 'sales_order' },
    ],
    rawWithByField: {
      '*[].customerInfo.customerName': OPEN_WITH_RECIPIENT,
      '*[].customerInfo.customerPhone': OPEN_WITH_RECIPIENT,
      '*[].customerInfo.shippingAddress.recipientName': OPEN_WITH_RECIPIENT,
      '*[].customerInfo.shippingAddress.phone': OPEN_WITH_RECIPIENT,
      '*[].customerInfo.shippingAddress.postalCode': OPEN_WITH_RECIPIENT,
      '*[].customerInfo.shippingAddress.roadAddress': OPEN_WITH_RECIPIENT,
      '*[].customerInfo.shippingAddress.detailAddress': OPEN_WITH_RECIPIENT,
      '*[].customerInfo.shippingAddress.deliveryNote': OPEN_WITH_RECIPIENT,
      '*[].customerInfo.shippingAddress.personalCustomsCode': OPEN_WITH_RECIPIENT,
    },
  })
  @RequirePermission('fulfillment.order.read')
  @Get('orders/by-company')
  async getDirectShipOrdersByCompany() {
    const ordersByCompany = await this.directShipService.getDirectShipOrdersByCompany();
    const result: Record<string, DirectShipOrder[]> = {};
    for (const [companyName, orders] of ordersByCompany.entries()) {
      result[companyName] = orders;
    }
    return result;
  }

  @RequirePermission('fulfillment.order.write')
  @Post('orders/forward')
  @ApiOperation({ summary: '주문 전달' })
  @UsePipes(new ZodValidationPipe(ForwardOrdersSchema))
  async forwardOrders(@Body() dto: z.infer<typeof ForwardOrdersSchema>) {
    await this.directShipService.forwardOrdersToCompany(dto.fulfillmentOrderIds, dto.companyName);
    return { message: `Successfully forwarded ${dto.fulfillmentOrderIds.length} orders to ${dto.companyName}` };
  }

  @RequirePermission('fulfillment.order.write')
  @Put('orders/complete')
  @ApiOperation({ summary: '주문 완료 처리' })
  @UsePipes(new ZodValidationPipe(CompleteOrdersSchema))
  async completeOrders(@Body() dto: z.infer<typeof CompleteOrdersSchema>) {
    await this.directShipService.markOrdersAsCompleted(dto.fulfillmentOrderIds, dto.completedBy);
    return { message: `Successfully completed ${dto.fulfillmentOrderIds.length} orders` };
  }

  @PiiResponse({
    fields: {
      'orders[].customerInfo.customerName': 'name',
      'orders[].customerInfo.customerEmail': 'email',
      'orders[].customerInfo.customerPhone': 'phone',
      'orders[].customerInfo.shippingAddress.recipientName': 'name',
      'orders[].customerInfo.shippingAddress.phone': 'phone',
      'orders[].customerInfo.shippingAddress.postalCode': 'postal',
      'orders[].customerInfo.shippingAddress.roadAddress': 'address',
      'orders[].customerInfo.shippingAddress.detailAddress': 'text',
      'orders[].customerInfo.shippingAddress.deliveryNote': 'text',
      'orders[].customerInfo.shippingAddress.personalCustomsCode': 'secret',
    },
    subjects: [
      { path: 'orders[].salesOrderId', type: 'sales_order' },
    ],
  })
  @RequirePermission('order.order.export')
  @Get('export/:companyName')
  @ApiOperation({ summary: '주문 데이터 내보내기' })
  @ApiParam({ name: 'companyName', description: '회사명' })
  async exportOrdersData(@Param('companyName') companyName: string) {
    return this.directShipService.exportOrdersForCompany(companyName);
  }

  @RequirePermission('order.order.export')
  @Post('export/file')
  @ApiOperation({ summary: '주문 파일 내보내기' })
  @UsePipes(new ZodValidationPipe(ExportOrdersSchema))
  async exportOrdersFile(@Body() dto: z.infer<typeof ExportOrdersSchema>, @Res() res: Response) {
    const fileData = await this.directShipService.generateExportFile(dto.companyName, dto.format);
    res.setHeader('Content-Type', fileData.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileData.fileName}"`);
    res.send(fileData.content);
  }

  @PiiResponse({
    fields: {
      '[].customerInfo.customerName': 'name',
      '[].customerInfo.customerEmail': 'email',
      '[].customerInfo.customerPhone': 'phone',
      '[].customerInfo.shippingAddress.recipientName': 'name',
      '[].customerInfo.shippingAddress.phone': 'phone',
      '[].customerInfo.shippingAddress.postalCode': 'postal',
      '[].customerInfo.shippingAddress.roadAddress': 'address',
      '[].customerInfo.shippingAddress.detailAddress': 'text',
      '[].customerInfo.shippingAddress.deliveryNote': 'text',
      '[].customerInfo.shippingAddress.personalCustomsCode': 'secret',
    },
    subjects: [
      { path: '[].salesOrderId', type: 'sales_order' },
    ],
    rawWithByField: {
      '[].customerInfo.customerName': OPEN_WITH_RECIPIENT,
      '[].customerInfo.customerPhone': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.recipientName': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.phone': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.postalCode': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.roadAddress': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.detailAddress': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.deliveryNote': OPEN_WITH_RECIPIENT,
      '[].customerInfo.shippingAddress.personalCustomsCode': OPEN_WITH_RECIPIENT,
    },
  })
  @RequirePermission('fulfillment.order.read')
  @Get('companies/:companyName/orders')
  async getCompanyOrders(
    @Param('companyName') companyName: string,
    @Query('status') status?: 'pending' | 'forwarded' | 'completed' | 'canceled',
  ) {
    return this.directShipService.getDirectShipOrders({ companyName, status });
  }

  @RequirePermission('fulfillment.order.read')
  @Get('companies/:companyName/summary')
  async getCompanySummary(@Param('companyName') companyName: string) {
    const orders = await this.directShipService.getDirectShipOrders({ companyName });
    return {
      companyName,
      totalOrders: orders.length,
      pendingOrders: orders.filter((o) => o.status === 'pending').length,
      forwardedOrders: orders.filter((o) => o.status === 'forwarded').length,
      completedOrders: orders.filter((o) => o.status === 'completed').length,
      totalItems: orders.reduce((sum, order) => sum + order.totalItems, 0),
      lastOrderDate: orders.length > 0 ? orders[0].createdAt : null,
    };
  }

  @RequirePermission('fulfillment.order.read')
  @Get('cancel-notices')
  @ApiOperation({ summary: '입점사에 알릴 취소 대기함' })
  @ApiQuery({ name: 'supplierId', required: false })
  async getCancelNotices(@Query('supplierId') supplierId?: string) {
    if (supplierId !== undefined && !z.string().uuid().safeParse(supplierId).success) {
      throw new BadRequestException('supplierId must be a UUID');
    }
    return this.cancelNotices.listOpen({ supplierId });
  }

  @RequirePermission('order.order.export')
  @Post('cancel-notices/export/file')
  @ApiOperation({ summary: '알릴 취소 CSV 내려받기' })
  async exportCancelNoticesFile(
    @Body(new ZodValidationPipe(CancelNoticeExportSchema)) dto: z.infer<typeof CancelNoticeExportSchema>,
    @Res() res: Response,
  ) {
    const fileData = await this.cancelNotices.exportFile(dto.supplierId, dto.noticeIds);
    res.setHeader('Content-Type', fileData.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileData.fileName)}`);
    res.send(fileData.content);
  }

  @RequirePermission('fulfillment.order.write')
  @Post('cancel-notices/notified')
  @ApiOperation({ summary: '알릴 취소 알림 완료' })
  // 파이프는 본문에만 건다 — 메서드 단위 @UsePipes 는 @User() 까지 지나가 사용자 객체를 본문 스키마로 파싱한다
  async markCancelNoticesNotified(
    @Body(new ZodValidationPipe(CancelNoticeNotifiedSchema)) dto: z.infer<typeof CancelNoticeNotifiedSchema>,
    @User() user: AuthenticatedUser,
  ) {
    const actor = user?.id ?? user?.userId;
    if (!actor) throw new BadRequestException('Authenticated actor is required');
    return this.cancelNotices.markNotified(dto.supplierId, dto.noticeIds, actor);
  }
}
