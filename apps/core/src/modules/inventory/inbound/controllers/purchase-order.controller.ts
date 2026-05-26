import { Controller, Post, Get, Put, Delete, Param, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { PurchaseOrderService } from '../services/purchase-order.service';
import {
  CreatePurchaseOrderDto,
  UpdatePurchaseOrderStatusDto,
  UpdatePurchaseOrderLinesDto,
  AddToCartDto,
  UpdateCartItemDto,
  CreatePurchaseOrderFromCartDto,
  PurchaseOrderResponse,
  CartItemResponse,
  StockReorderSuggestion,
  PurchaseOrderStatus,
  PurchaseOrderType,
} from '../dto/purchase-order.dto';
import { SubmitForAuditDto, ApprovePoDto, RejectPoDto } from '../dto/purchase-order/audit-po.dto';

interface JwtPayload {
  userId: string;
  email: string;
  roles: string[];
}

@ApiTags('Purchase Orders')
@Controller('purchase-orders')
export class PurchaseOrderController {
  constructor(private readonly purchaseOrderService: PurchaseOrderService) {}

  // ========== 발주 관리 ==========

  @Post()
  @ApiOperation({ summary: '발주 생성' })
  @ApiResponse({
    status: 201,
    description: '발주가 성공적으로 생성됨',
    type: 'object', // PurchaseOrderResponse type would be defined here
  })
  async createPurchaseOrder(@Body() createDto: CreatePurchaseOrderDto): Promise<PurchaseOrderResponse> {
    return this.purchaseOrderService.createPurchaseOrder(createDto);
  }

  @Post('from-cart')
  @ApiOperation({ summary: '장바구니에서 발주 생성' })
  @ApiResponse({
    status: 201,
    description: '장바구니 아이템들로부터 발주가 생성됨',
  })
  async createPurchaseOrderFromCart(
    @Body() createDto: CreatePurchaseOrderFromCartDto,
    @User() user: JwtPayload,
  ): Promise<PurchaseOrderResponse> {
    return this.purchaseOrderService.createPurchaseOrderFromCart(createDto, user.userId);
  }

  @Get()
  @ApiOperation({ summary: '발주 목록 조회' })
  @ApiQuery({ name: 'status', enum: PurchaseOrderStatus, required: false })
  @ApiQuery({ name: 'type', enum: PurchaseOrderType, required: false })
  @ApiQuery({
    name: 'limit',
    type: Number,
    required: false,
    description: '조회 개수 (기본: 50)',
  })
  @ApiQuery({
    name: 'offset',
    type: Number,
    required: false,
    description: '오프셋 (기본: 0)',
  })
  async getPurchaseOrders(
    @Query('status') status?: PurchaseOrderStatus,
    @Query('type') type?: PurchaseOrderType,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<PurchaseOrderResponse[]> {
    return this.purchaseOrderService.getPurchaseOrders(status, type, limit, offset);
  }

  // ========== 발주대기리스트 (Cart) 관리 ==========

  @Post('cart')
  @ApiOperation({ summary: '발주대기리스트에 아이템 추가' })
  @ApiResponse({
    status: 201,
    description: '아이템이 발주대기리스트에 추가됨',
  })
  async addToCart(@Body() addDto: AddToCartDto, @User() user: JwtPayload): Promise<CartItemResponse> {
    return this.purchaseOrderService.addToCart(addDto, user.userId);
  }

  @Get('cart')
  @ApiOperation({ summary: '발주대기리스트 조회' })
  @ApiQuery({ name: 'type', enum: PurchaseOrderType, required: false })
  async getCartItems(
    @Query('type') type: PurchaseOrderType | undefined,
    @User() user: JwtPayload,
  ): Promise<CartItemResponse[]> {
    return this.purchaseOrderService.getCartItems(type, user.userId);
  }

  @Put('cart/:itemId')
  @ApiOperation({ summary: '발주대기리스트 아이템 수정' })
  @ApiResponse({
    status: 200,
    description: '아이템이 성공적으로 수정됨',
  })
  async updateCartItem(
    @Param('itemId') itemId: string,
    @Body() updateDto: UpdateCartItemDto,
    @User() user: JwtPayload,
  ): Promise<CartItemResponse> {
    return this.purchaseOrderService.updateCartItem(itemId, user.userId, updateDto);
  }

  @Delete('cart/:itemId')
  @ApiOperation({ summary: '발주대기리스트에서 아이템 제거' })
  @ApiResponse({
    status: 204,
    description: '아이템이 성공적으로 제거됨',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeFromCart(@Param('itemId') itemId: string, @User() user: JwtPayload): Promise<void> {
    return this.purchaseOrderService.removeFromCart(itemId, user.userId);
  }

  @Delete('cart')
  @ApiOperation({ summary: '발주대기리스트 비우기' })
  @ApiQuery({ name: 'type', enum: PurchaseOrderType, required: false })
  @ApiResponse({
    status: 204,
    description: '발주대기리스트가 성공적으로 비워짐',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearCart(@Query('type') type: PurchaseOrderType | undefined, @User() user: JwtPayload): Promise<void> {
    return this.purchaseOrderService.clearCart(type, user.userId);
  }

  // ========== 재주문 제안 ==========

  @Get('suggestions/reorder')
  @ApiOperation({
    summary: '재주문 제안 조회',
    description: '안전재고 미만으로 떨어진 상품들의 재주문 제안 목록을 조회합니다',
  })
  @ApiQuery({
    name: 'warehouseId',
    type: String,
    required: false,
    description: '창고 ID (선택사항)',
  })
  @ApiResponse({
    status: 200,
    description: '재주문 제안 목록이 성공적으로 조회됨',
    type: [Object], // StockReorderSuggestion would be defined here
  })
  async getReorderSuggestions(@Query('warehouseId') warehouseId?: string): Promise<StockReorderSuggestion[]> {
    return this.purchaseOrderService.getReorderSuggestions(warehouseId);
  }

  // ========== 발주 상세 조회 및 관리 (동적 라우트) ==========

  @Get(':id')
  @ApiOperation({ summary: '발주 상세 조회' })
  @ApiResponse({
    status: 200,
    description: '발주 정보가 성공적으로 조회됨',
  })
  @ApiResponse({
    status: 404,
    description: '발주를 찾을 수 없음',
  })
  async getPurchaseOrderById(@Param('id') id: string): Promise<PurchaseOrderResponse> {
    return this.purchaseOrderService.getPurchaseOrderById(id);
  }

  @Put(':id/status')
  @ApiOperation({ summary: '발주 상태 업데이트' })
  @ApiResponse({
    status: 200,
    description: '발주 상태가 성공적으로 업데이트됨',
  })
  async updatePurchaseOrderStatus(
    @Param('id') id: string,
    @Body() updateDto: UpdatePurchaseOrderStatusDto,
  ): Promise<PurchaseOrderResponse> {
    return this.purchaseOrderService.updatePurchaseOrderStatus(id, updateDto);
  }

  @Put(':id/lines')
  @ApiOperation({ summary: '발주 라인 수정 (created/confirmed 상태)' })
  @ApiResponse({
    status: 200,
    description: '발주 라인이 성공적으로 수정됨',
  })
  async updatePurchaseOrderLines(
    @Param('id') id: string,
    @Body() updateDto: UpdatePurchaseOrderLinesDto,
  ): Promise<PurchaseOrderResponse> {
    return this.purchaseOrderService.updatePurchaseOrderLines(id, updateDto);
  }

  // ========== Audit Workflow ==========

  @Put(':id/submit-for-audit')
  @ApiOperation({ summary: '검토 제출 (Submit PO for audit)' })
  @ApiParam({ name: 'id', description: 'Purchase Order ID' })
  @ApiResponse({
    status: 200,
    description: '검토 요청 제출 완료',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'uuid' },
        auditStatus: { type: 'string', example: 'pending_audit' },
        submittedAt: { type: 'string', format: 'date-time' },
        message: {
          type: 'string',
          example: '검토 요청이 제출되었습니다. (Submitted for audit)',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 상태 (현재 상태가 draft가 아님)',
  })
  @ApiResponse({ status: 404, description: '발주를 찾을 수 없습니다.' })
  async submitForAudit(@Param('id') id: string, @Body() dto: SubmitForAuditDto): Promise<any> {
    return this.purchaseOrderService.submitForAudit(id, dto);
  }

  @Put(':id/approve')
  @ApiOperation({ summary: '발주 승인 (Approve purchase order)' })
  @ApiParam({ name: 'id', description: 'Purchase Order ID' })
  @ApiResponse({
    status: 200,
    description: '발주 승인 완료',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'uuid' },
        auditStatus: { type: 'string', example: 'approved' },
        approvedAt: { type: 'string', format: 'date-time' },
        message: {
          type: 'string',
          example: '발주가 승인되었습니다. (Purchase order approved)',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 상태 (현재 상태가 pending_audit가 아님)',
  })
  @ApiResponse({ status: 404, description: '발주를 찾을 수 없습니다.' })
  async approvePo(@Param('id') id: string, @Body() dto: ApprovePoDto): Promise<any> {
    return this.purchaseOrderService.approvePo(id, dto);
  }

  @Put(':id/reject')
  @ApiOperation({ summary: '발주 거부 (Reject purchase order)' })
  @ApiParam({ name: 'id', description: 'Purchase Order ID' })
  @ApiResponse({
    status: 200,
    description: '발주 거부 완료 (상태가 draft로 재설정됨)',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'uuid' },
        auditStatus: { type: 'string', example: 'draft' },
        rejectedAt: { type: 'string', format: 'date-time' },
        reason: {
          type: 'string',
          example: 'SKU quantities exceed budget limits',
        },
        message: {
          type: 'string',
          example: '발주가 거부되었습니다. 수정 후 재제출하세요. (Purchase order rejected, please revise and resubmit)',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 상태 (현재 상태가 pending_audit가 아님)',
  })
  @ApiResponse({ status: 404, description: '발주를 찾을 수 없습니다.' })
  async rejectPo(@Param('id') id: string, @Body() dto: RejectPoDto): Promise<any> {
    return this.purchaseOrderService.rejectPo(id, dto);
  }
}
