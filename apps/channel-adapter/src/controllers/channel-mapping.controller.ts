import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBody, ApiParam } from '@nestjs/swagger';
import {
  ChannelProductMappingService,
  SalesChannelType,
  CreateMappingDto,
} from '../services/channel-product-mapping.service';
import { PendingOrderService, PendingOrderStatus } from '../services/pending-order.service';
import { OrderEventPublisher } from '../services/order-event.publisher';

// ===== DTO 정의 =====

class CreateMappingRequestDto {
  salesChannel: SalesChannelType;
  channelProductId: string;
  channelProductName?: string;
  pimVariantId: string;
  pimVariantCode?: string;
  mappedBy?: string;
}

class UpdateMappingRequestDto {
  pimVariantId?: string;
  pimVariantCode?: string;
  channelProductName?: string;
}

class MappingListQueryDto {
  salesChannel?: SalesChannelType;
  limit?: number;
  offset?: number;
}

class PendingOrderListQueryDto {
  salesChannel?: SalesChannelType;
  status?: PendingOrderStatus;
  channelProductId?: string;
  limit?: number;
  offset?: number;
}

/**
 * 채널 상품 매핑 및 계류 주문 관리 API
 *
 * 관리자가 채널 상품을 PIM variant에 매핑하고,
 * 계류된 주문을 재처리할 수 있습니다.
 */
@ApiTags('Channel Mapping')
@Controller('admin/channel-mapping')
export class ChannelMappingController {
  private readonly logger = new Logger(ChannelMappingController.name);

  constructor(
    private readonly mappingService: ChannelProductMappingService,
    private readonly pendingOrderService: PendingOrderService,
    private readonly orderEventPublisher: OrderEventPublisher,
  ) {}

  // ===== 매핑 관리 API =====

  @Get('mappings')
  @ApiOperation({ summary: '매핑 목록 조회' })
  @ApiQuery({ name: 'salesChannel', required: false, enum: ['coupang', 'naver', 'medusa'] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async listMappings(@Query() query: MappingListQueryDto) {
    const result = await this.mappingService.findAll({
      salesChannel: query.salesChannel,
      limit: query.limit,
      offset: query.offset,
    });

    return {
      success: true,
      data: result.mappings,
      meta: {
        total: result.total,
        limit: query.limit ?? 50,
        offset: query.offset ?? 0,
      },
    };
  }

  @Get('mappings/:id')
  @ApiOperation({ summary: '매핑 상세 조회' })
  @ApiParam({ name: 'id', description: '매핑 ID' })
  async getMapping(@Param('id') id: string) {
    // ID로 조회하는 메소드가 필요하지만, 일단 findByVariantId로 대체
    const mappings = await this.mappingService.findAll({ limit: 1000 });
    const mapping = mappings.mappings.find((m) => m.id === id);

    if (!mapping) {
      throw new NotFoundException('매핑을 찾을 수 없습니다');
    }

    return {
      success: true,
      data: mapping,
    };
  }

  @Get('mappings/by-variant/:variantId')
  @ApiOperation({ summary: 'PIM Variant ID로 매핑된 채널 상품들 조회' })
  @ApiParam({ name: 'variantId', description: 'PIM Variant ID' })
  async getMappingsByVariant(@Param('variantId') variantId: string) {
    const mappings = await this.mappingService.findByVariantId(variantId);

    return {
      success: true,
      data: {
        variantId,
        mappings,
        count: mappings.length,
      },
    };
  }

  @Post('mappings')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '매핑 생성 (+ 계류 주문 자동 재처리)' })
  @ApiBody({ type: CreateMappingRequestDto })
  async createMapping(@Body() dto: CreateMappingRequestDto) {
    // 1. 매핑 생성
    const mapping = await this.mappingService.createMapping(dto);

    // 2. 해당 상품의 계류 주문 자동 재처리
    const pendingOrders = await this.pendingOrderService.findByProductId(
      dto.salesChannel,
      dto.channelProductId,
      'pending',
    );

    let reprocessedCount = 0;
    const errors: Array<{ orderId: string; error: string }> = [];

    for (const order of pendingOrders) {
      try {
        // 주문 이벤트 재발행
        const channelForPublish = dto.salesChannel === 'naver' ? 'naver_smartstore' : 'coupang';
        await this.orderEventPublisher.publishOrderCreated(
          channelForPublish,
          order.orderData as any,
          this.mappingService.createVariantIdMapper(dto.salesChannel),
        );

        // 처리 완료 표시
        await this.pendingOrderService.markAsProcessed(order.id, dto.mappedBy);
        reprocessedCount++;
      } catch (error) {
        errors.push({
          orderId: order.channelOrderId,
          error: error.message,
        });
        this.logger.error(
          `❌ 계류 주문 재처리 실패: ${order.channelOrderId}`,
          error.message,
        );
      }
    }

    this.logger.log(
      `✅ 매핑 생성 완료: ${dto.salesChannel}/${dto.channelProductId} → ${dto.pimVariantId}, 재처리: ${reprocessedCount}건`,
    );

    return {
      success: true,
      data: {
        mapping,
        reprocessed: {
          count: reprocessedCount,
          errors: errors.length > 0 ? errors : undefined,
        },
      },
    };
  }

  @Put('mappings/:id')
  @ApiOperation({ summary: '매핑 수정' })
  @ApiParam({ name: 'id', description: '매핑 ID' })
  @ApiBody({ type: UpdateMappingRequestDto })
  async updateMapping(
    @Param('id') id: string,
    @Body() dto: UpdateMappingRequestDto,
  ) {
    const mapping = await this.mappingService.updateMapping(id, dto);

    return {
      success: true,
      data: mapping,
    };
  }

  @Delete('mappings/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '매핑 삭제' })
  @ApiParam({ name: 'id', description: '매핑 ID' })
  async deleteMapping(@Param('id') id: string) {
    await this.mappingService.deleteMapping(id);
  }

  // ===== 계류 주문 관리 API =====

  @Get('pending-orders')
  @ApiOperation({ summary: '계류 주문 목록 조회' })
  @ApiQuery({ name: 'salesChannel', required: false, enum: ['coupang', 'naver', 'medusa'] })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'processed', 'cancelled'] })
  @ApiQuery({ name: 'channelProductId', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async listPendingOrders(@Query() query: PendingOrderListQueryDto) {
    const result = await this.pendingOrderService.findAll({
      salesChannel: query.salesChannel,
      status: query.status,
      channelProductId: query.channelProductId,
      limit: query.limit,
      offset: query.offset,
    });

    return {
      success: true,
      data: result.orders,
      meta: {
        total: result.total,
        limit: query.limit ?? 50,
        offset: query.offset ?? 0,
      },
    };
  }

  @Get('pending-orders/stats')
  @ApiOperation({ summary: '미매핑 상품별 계류 주문 통계' })
  @ApiQuery({ name: 'salesChannel', required: false, enum: ['coupang', 'naver', 'medusa'] })
  async getPendingOrderStats(@Query('salesChannel') salesChannel?: SalesChannelType) {
    const stats = await this.pendingOrderService.getUnmappedProductStats(salesChannel);

    return {
      success: true,
      data: stats,
      meta: {
        totalUnmappedProducts: stats.length,
        totalPendingOrders: stats.reduce((sum, s) => sum + s.pendingCount, 0),
      },
    };
  }

  @Get('pending-orders/:id')
  @ApiOperation({ summary: '계류 주문 상세 조회' })
  @ApiParam({ name: 'id', description: '계류 주문 ID' })
  async getPendingOrder(@Param('id') id: string) {
    const order = await this.pendingOrderService.findById(id);

    if (!order) {
      throw new NotFoundException('계류 주문을 찾을 수 없습니다');
    }

    return {
      success: true,
      data: order,
    };
  }

  @Post('pending-orders/:id/reprocess')
  @ApiOperation({ summary: '계류 주문 재처리 (매핑이 있는 경우)' })
  @ApiParam({ name: 'id', description: '계류 주문 ID' })
  async reprocessPendingOrder(
    @Param('id') id: string,
    @Body('processedBy') processedBy?: string,
  ) {
    const order = await this.pendingOrderService.findById(id);

    if (!order) {
      throw new NotFoundException('계류 주문을 찾을 수 없습니다');
    }

    if (order.status !== 'pending') {
      throw new BadRequestException(`이미 처리된 주문입니다: ${order.status}`);
    }

    // 매핑 확인
    const mapping = await this.mappingService.findMapping(
      order.salesChannel as SalesChannelType,
      order.channelProductId,
    );

    if (!mapping) {
      throw new BadRequestException(
        `매핑이 없습니다. 먼저 채널 상품을 PIM variant에 매핑해주세요: ${order.channelProductId}`,
      );
    }

    // 주문 이벤트 재발행
    const channelType = order.salesChannel === 'naver' ? 'naver_smartstore' : order.salesChannel;
    await this.orderEventPublisher.publishOrderCreated(
      channelType as 'naver_smartstore' | 'coupang',
      order.orderData as any,
      this.mappingService.createVariantIdMapper(order.salesChannel as SalesChannelType),
    );

    // 처리 완료 표시
    const updated = await this.pendingOrderService.markAsProcessed(id, processedBy);

    this.logger.log(`✅ 계류 주문 재처리 완료: ${order.channelOrderId}`);

    return {
      success: true,
      data: updated,
    };
  }

  @Post('pending-orders/:id/cancel')
  @ApiOperation({ summary: '계류 주문 취소' })
  @ApiParam({ name: 'id', description: '계류 주문 ID' })
  async cancelPendingOrder(
    @Param('id') id: string,
    @Body('processedBy') processedBy?: string,
  ) {
    const order = await this.pendingOrderService.findById(id);

    if (!order) {
      throw new NotFoundException('계류 주문을 찾을 수 없습니다');
    }

    if (order.status !== 'pending') {
      throw new BadRequestException(`이미 처리된 주문입니다: ${order.status}`);
    }

    const updated = await this.pendingOrderService.cancel(id, processedBy);

    this.logger.log(`🚫 계류 주문 취소: ${order.channelOrderId}`);

    return {
      success: true,
      data: updated,
    };
  }
}

