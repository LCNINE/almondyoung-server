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
    HttpStatus
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { PurchaseOrderService } from '../services/purchase-order.service';
import {
    CreatePurchaseOrderDto,
    UpdatePurchaseOrderStatusDto,
    AddToCartDto,
    UpdateCartItemDto,
    CreatePurchaseOrderFromCartDto,
    PurchaseOrderResponse,
    CartItemResponse,
    StockReorderSuggestion,
    PurchaseOrderStatus,
    PurchaseOrderType
} from '../dto/purchase-order.dto';

@ApiTags('Purchase Orders')
@Controller('wms/purchase-orders')
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
    async createPurchaseOrder(
        @Body() createDto: CreatePurchaseOrderDto
    ): Promise<PurchaseOrderResponse> {
        return this.purchaseOrderService.createPurchaseOrder(createDto);
    }

    @Post('from-cart')
    @ApiOperation({ summary: '장바구니에서 발주 생성' })
    @ApiResponse({
        status: 201,
        description: '장바구니 아이템들로부터 발주가 생성됨',
    })
    async createPurchaseOrderFromCart(
        @Body() createDto: CreatePurchaseOrderFromCartDto
    ): Promise<PurchaseOrderResponse> {
        return this.purchaseOrderService.createPurchaseOrderFromCart(createDto);
    }

    @Get()
    @ApiOperation({ summary: '발주 목록 조회' })
    @ApiQuery({ name: 'status', enum: PurchaseOrderStatus, required: false })
    @ApiQuery({ name: 'type', enum: PurchaseOrderType, required: false })
    @ApiQuery({ name: 'limit', type: Number, required: false, description: '조회 개수 (기본: 50)' })
    @ApiQuery({ name: 'offset', type: Number, required: false, description: '오프셋 (기본: 0)' })
    async getPurchaseOrders(
        @Query('status') status?: PurchaseOrderStatus,
        @Query('type') type?: PurchaseOrderType,
        @Query('limit') limit?: number,
        @Query('offset') offset?: number
    ): Promise<PurchaseOrderResponse[]> {
        return this.purchaseOrderService.getPurchaseOrders(status, type, limit, offset);
    }

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
        @Body() updateDto: UpdatePurchaseOrderStatusDto
    ): Promise<PurchaseOrderResponse> {
        return this.purchaseOrderService.updatePurchaseOrderStatus(id, updateDto);
    }

    // ========== 발주대기리스트 (Cart) 관리 ==========

    @Post('cart')
    @ApiOperation({ summary: '발주대기리스트에 아이템 추가' })
    @ApiResponse({
        status: 201,
        description: '아이템이 발주대기리스트에 추가됨',
    })
    async addToCart(@Body() addDto: AddToCartDto): Promise<CartItemResponse> {
        return this.purchaseOrderService.addToCart(addDto);
    }

    @Get('cart')
    @ApiOperation({ summary: '발주대기리스트 조회' })
    @ApiQuery({ name: 'type', enum: PurchaseOrderType, required: false })
    async getCartItems(@Query('type') type?: PurchaseOrderType): Promise<CartItemResponse[]> {
        return this.purchaseOrderService.getCartItems(type);
    }

    @Put('cart/:itemId')
    @ApiOperation({ summary: '발주대기리스트 아이템 수정' })
    @ApiResponse({
        status: 200,
        description: '아이템이 성공적으로 수정됨',
    })
    async updateCartItem(
        @Param('itemId') itemId: string,
        @Body() updateDto: UpdateCartItemDto
    ): Promise<CartItemResponse> {
        return this.purchaseOrderService.updateCartItem(itemId, updateDto);
    }

    @Delete('cart/:itemId')
    @ApiOperation({ summary: '발주대기리스트에서 아이템 제거' })
    @ApiResponse({
        status: 204,
        description: '아이템이 성공적으로 제거됨',
    })
    @HttpCode(HttpStatus.NO_CONTENT)
    async removeFromCart(@Param('itemId') itemId: string): Promise<void> {
        return this.purchaseOrderService.removeFromCart(itemId);
    }

    @Delete('cart')
    @ApiOperation({ summary: '발주대기리스트 비우기' })
    @ApiQuery({ name: 'type', enum: PurchaseOrderType, required: false })
    @ApiResponse({
        status: 204,
        description: '발주대기리스트가 성공적으로 비워짐',
    })
    @HttpCode(HttpStatus.NO_CONTENT)
    async clearCart(@Query('type') type?: PurchaseOrderType): Promise<void> {
        return this.purchaseOrderService.clearCart(type);
    }

    // ========== 재주문 제안 ==========

    @Get('suggestions/reorder')
    @ApiOperation({
        summary: '재주문 제안 조회',
        description: '안전재고 미만으로 떨어진 상품들의 재주문 제안 목록을 조회합니다'
    })
    @ApiQuery({ name: 'warehouseId', type: String, required: false, description: '창고 ID (선택사항)' })
    @ApiResponse({
        status: 200,
        description: '재주문 제안 목록이 성공적으로 조회됨',
        type: [Object], // StockReorderSuggestion would be defined here
    })
    async getReorderSuggestions(
        @Query('warehouseId') warehouseId?: string
    ): Promise<StockReorderSuggestion[]> {
        return this.purchaseOrderService.getReorderSuggestions(warehouseId);
    }
}