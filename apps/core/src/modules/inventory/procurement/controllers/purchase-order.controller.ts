import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard, User } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
import { PurchaseOrderService } from '../services/purchase-order.service';
import { PurchaseOrderCartService } from '../services/purchase-order-cart.service';
import { ReorderSuggestionReader } from '../services/reorder-suggestion.reader';
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
import { PurchaseOrderResponseDto } from '../dto/purchase-order/purchase-order-response.dto';
import { OrderPurchaseOrderLineDto, MarkLineUnavailableDto } from '../dto/purchase-order/execute-line.dto';

interface JwtPayload {
  userId: string;
  email: string;
  roles: string[];
}

@ApiTags('Purchase Orders')
@Controller('purchase-orders')
@UseGuards(ScopeGuard)
export class PurchaseOrderController {
  constructor(
    private readonly purchaseOrderService: PurchaseOrderService,
    private readonly cartService: PurchaseOrderCartService,
    private readonly reorderReader: ReorderSuggestionReader,
  ) {}

  // ========== 발주 관리 ==========

  @Post()
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '발주 생성' })
  @ApiResponse({
    status: 201,
    description: '발주가 성공적으로 생성됨',
    type: PurchaseOrderResponseDto,
  })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async createPurchaseOrder(@Body() createDto: CreatePurchaseOrderDto): Promise<PurchaseOrderResponse> {
    return this.purchaseOrderService.createPurchaseOrder(createDto);
  }

  @Post('from-cart')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '장바구니에서 발주 생성' })
  @ApiResponse({
    status: 201,
    description: '장바구니 아이템들로부터 발주가 생성됨',
    type: PurchaseOrderResponseDto,
  })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async createPurchaseOrderFromCart(
    @Body() createDto: CreatePurchaseOrderFromCartDto,
    @User() user: JwtPayload,
  ): Promise<PurchaseOrderResponse> {
    return this.purchaseOrderService.createPurchaseOrderFromCart(createDto, user.userId);
  }

  @Get()
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
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
  @ApiResponse({ status: 200, description: '발주 목록', type: [PurchaseOrderResponseDto] })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
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
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '발주대기리스트에 아이템 추가' })
  @ApiResponse({
    status: 201,
    description: '아이템이 발주대기리스트에 추가됨',
  })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async addToCart(@Body() addDto: AddToCartDto, @User() user: JwtPayload): Promise<CartItemResponse> {
    return this.cartService.addToCart(addDto, user.userId);
  }

  @Get('cart')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '발주대기리스트 조회' })
  @ApiQuery({ name: 'type', enum: PurchaseOrderType, required: false })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async getCartItems(
    @Query('type') type: PurchaseOrderType | undefined,
    @User() user: JwtPayload,
  ): Promise<CartItemResponse[]> {
    return this.cartService.getCartItems(type, user.userId);
  }

  @Put('cart/:itemId')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '발주대기리스트 아이템 수정' })
  @ApiResponse({
    status: 200,
    description: '아이템이 성공적으로 수정됨',
  })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async updateCartItem(
    @Param('itemId') itemId: string,
    @Body() updateDto: UpdateCartItemDto,
    @User() user: JwtPayload,
  ): Promise<CartItemResponse> {
    return this.cartService.updateCartItem(itemId, user.userId, updateDto);
  }

  @Delete('cart/:itemId')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '발주대기리스트에서 아이템 제거' })
  @ApiResponse({
    status: 204,
    description: '아이템이 성공적으로 제거됨',
  })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeFromCart(@Param('itemId') itemId: string, @User() user: JwtPayload): Promise<void> {
    return this.cartService.removeFromCart(itemId, user.userId);
  }

  @Delete('cart')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '발주대기리스트 비우기' })
  @ApiQuery({ name: 'type', enum: PurchaseOrderType, required: false })
  @ApiResponse({
    status: 204,
    description: '발주대기리스트가 성공적으로 비워짐',
  })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearCart(@Query('type') type: PurchaseOrderType | undefined, @User() user: JwtPayload): Promise<void> {
    return this.cartService.clearCart(type, user.userId);
  }

  // ========== 재주문 제안 ==========

  @Get('suggestions/reorder')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
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
    type: [StockReorderSuggestion],
  })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async getReorderSuggestions(@Query('warehouseId') warehouseId?: string): Promise<StockReorderSuggestion[]> {
    return this.reorderReader.getSuggestions(warehouseId);
  }

  // ========== 발주 상세 조회 및 관리 (동적 라우트) ==========

  @Get(':id')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '발주 상세 조회' })
  @ApiResponse({
    status: 200,
    description: '발주 정보가 성공적으로 조회됨',
    type: PurchaseOrderResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '발주를 찾을 수 없음',
  })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async getPurchaseOrderById(@Param('id') id: string): Promise<PurchaseOrderResponse> {
    return this.purchaseOrderService.getPurchaseOrderById(id);
  }

  @Put(':id/status')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '발주 종결 (입고 완료)' })
  @ApiResponse({
    status: 200,
    description: '발주가 종결됨',
    type: PurchaseOrderResponseDto,
  })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  @ApiResponse({
    status: 409,
    description: '아직 실행되지 않은 라인이 남았거나 이미 종결된 발주입니다.',
  })
  async updatePurchaseOrderStatus(
    @Param('id') id: string,
    @Body() updateDto: UpdatePurchaseOrderStatusDto,
    @User() user: JwtPayload,
  ): Promise<PurchaseOrderResponse> {
    // @User() 를 실제로 넘긴다 — 누가 종결했는지 로그에 남는다. (과거 심사
    // 엔드포인트들은 이걸 빠뜨려 submitted_for_audit_by / audited_by 가 라이브에서
    // 영원히 NULL 로 남았다 — 그 엔드포인트는 이후 제거됨.)
    return this.purchaseOrderService.updatePurchaseOrderStatus(id, updateDto, user.userId);
  }

  @Put(':id/lines')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '발주 라인 수정 (created/confirmed 상태)' })
  @ApiResponse({
    status: 200,
    description: '발주 라인이 성공적으로 수정됨',
    type: PurchaseOrderResponseDto,
  })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  async updatePurchaseOrderLines(
    @Param('id') id: string,
    @Body() updateDto: UpdatePurchaseOrderLinesDto,
  ): Promise<PurchaseOrderResponse> {
    return this.purchaseOrderService.updatePurchaseOrderLines(id, updateDto);
  }

  // ========== 라인 실행 (하나씩 실제로 발주) ==========
  // 경로 순서: 위의 @Get(':id') 와 세그먼트 수가 달라 충돌하지 않는다.

  @Post(':poId/lines/:skuId/order')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '발주 라인 실행 (실제로 발주함)' })
  @ApiParam({ name: 'poId', description: '발주 ID' })
  @ApiParam({ name: 'skuId', description: 'SKU ID — 라인 주소' })
  @ApiResponse({ status: 200, description: '라인이 실행됨', type: PurchaseOrderResponseDto })
  @ApiResponse({ status: 409, description: '이미 종결된 라인' })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  @HttpCode(HttpStatus.OK)
  async orderLine(
    @Param('poId') poId: string,
    @Param('skuId') skuId: string,
    @Body() dto: OrderPurchaseOrderLineDto,
    @User() user: JwtPayload,
  ): Promise<PurchaseOrderResponse> {
    return this.purchaseOrderService.orderLine(poId, skuId, dto, user.userId);
  }

  @Post(':poId/lines/:skuId/unavailable')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '발주 라인 종결 (끝내 발주 못 함)' })
  @ApiParam({ name: 'poId', description: '발주 ID' })
  @ApiParam({ name: 'skuId', description: 'SKU ID — 라인 주소' })
  @ApiResponse({ status: 200, description: '라인이 종결됨', type: PurchaseOrderResponseDto })
  @ApiResponse({ status: 409, description: '이미 종결된 라인' })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  @HttpCode(HttpStatus.OK)
  async markLineUnavailable(
    @Param('poId') poId: string,
    @Param('skuId') skuId: string,
    @Body() dto: MarkLineUnavailableDto,
    @User() user: JwtPayload,
  ): Promise<PurchaseOrderResponse> {
    return this.purchaseOrderService.markLineUnavailable(poId, skuId, dto, user.userId);
  }
}
