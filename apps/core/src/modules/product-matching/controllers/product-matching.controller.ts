import {
  Controller,
  Get,
  Query,
  Patch,
  Param,
  Body,
  Post,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBody } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { ProductMatchingService } from '../services/product-matching.service';
import { ResolveLegacyIgnoredMatchingDto, ResolveMatchingDto, StockPolicyDto } from '../dto/resolve-matching.dto';
import { SetMatchingPriorityDto } from '../dto/set-matching-priority.dto';
import { ChangeStrategyDto } from '../dto/change-strategy.dto';
import { VariantSkuLookupDto } from '../dto/variant-sku-lookup.dto';
import { matchingStatusEnum } from '../schema/matching.schema';

@ApiTags('Product Matching')
@Controller('matchings')
export class ProductMatchingController {
  constructor(private readonly productMatchingService: ProductMatchingService) {}

  @Get()
  @ApiOperation({ summary: '상품매칭 목록 조회' })
  @ApiQuery({ name: 'status', required: false, enum: matchingStatusEnum.enumValues })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({ status: 200, description: '상품매칭 목록을 반환합니다.' })
  async getMatchings(
    @Query('status') status?: 'pending' | 'matched' | 'ignored',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    try {
      return await this.productMatchingService.getMatchings({
        status,
        limit: limit ? parseInt(limit, 10) : 50,
        offset: offset ? parseInt(offset, 10) : 0,
      });
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      throw new InternalServerErrorException(e.message);
    }
  }

  @Get('legacy-ignored')
  @ApiOperation({ summary: '레거시 ignored 상품매칭 감사 목록 조회' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({ status: 200, description: '레거시 ignored 상품매칭 목록을 반환합니다.' })
  async getLegacyIgnoredMatchings(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    try {
      return await this.productMatchingService.getLegacyIgnoredMatchings({
        limit: limit ? parseInt(limit, 10) : 50,
        offset: offset ? parseInt(offset, 10) : 0,
      });
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      throw new InternalServerErrorException(e.message);
    }
  }

  @Get('order-lines')
  @ApiOperation({ summary: '주문 라인별 매칭 현황 조회' })
  @ApiQuery({ name: 'matchingStatus', required: false, enum: [...matchingStatusEnum.enumValues, 'unregistered'] })
  @ApiQuery({ name: 'excludeMatched', required: false, type: Boolean })
  @ApiQuery({ name: 'salesChannel', required: false, type: String })
  @ApiQuery({ name: 'startDate', required: false, type: String, description: 'ISO 날짜 (YYYY-MM-DD)' })
  @ApiQuery({ name: 'endDate', required: false, type: String, description: 'ISO 날짜 (YYYY-MM-DD)' })
  @ApiQuery({ name: 'keyword', required: false, type: String })
  @ApiQuery({ name: 'keywordType', required: false, enum: ['productName', 'orderNumber', 'customerName'] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({ status: 200, description: '주문 라인별 매칭 현황을 반환합니다.' })
  async getOrderLines(
    @Query('matchingStatus') matchingStatus?: 'pending' | 'matched' | 'ignored' | 'unregistered',
    @Query('excludeMatched') excludeMatched?: string,
    @Query('salesChannel') salesChannel?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('keyword') keyword?: string,
    @Query('keywordType') keywordType?: 'productName' | 'orderNumber' | 'customerName',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    try {
      return await this.productMatchingService.getOrderLines({
        matchingStatus,
        excludeMatched: excludeMatched === 'true',
        salesChannel,
        startDate,
        endDate,
        keyword,
        keywordType,
        limit: limit ? parseInt(limit, 10) : 50,
        offset: offset ? parseInt(offset, 10) : 0,
      });
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      throw new InternalServerErrorException(e.message);
    }
  }

  @Patch(':id/resolve')
  @ApiOperation({ summary: '매칭 대기 해소 (SKU 구성 매칭 또는 void 전략)' })
  @ApiResponse({ status: 200, description: '매칭 대기가 성공적으로 해소되었습니다.' })
  async resolveMatchingPending(@Param('id') matchingId: string, @Body() resolveDto: ResolveMatchingDto) {
    try {
      return await this.productMatchingService.resolveMatchingPending(matchingId, resolveDto);
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException(e.message);
      if (msg.match(/already|invalid|failed|required|exceed/)) throw new BadRequestException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  @Post(':id/legacy-ignored/resolve')
  @ApiOperation({ summary: '레거시 ignored 상품매칭 정리' })
  @ApiBody({ type: ResolveLegacyIgnoredMatchingDto })
  @ApiResponse({ status: 200, description: '레거시 ignored 상품매칭이 명시적으로 정리되었습니다.' })
  async resolveLegacyIgnoredMatching(
    @Param('id') matchingId: string,
    @Body() dto: ResolveLegacyIgnoredMatchingDto,
    @User() user: { userId?: string; sub?: string } | undefined,
  ) {
    try {
      return await this.productMatchingService.resolveLegacyIgnoredMatching(matchingId, dto, {
        userId: user?.userId ?? user?.sub,
      });
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException(e.message);
      if (msg.match(/already|invalid|failed|required|exceed|legacy|ignored/)) {
        throw new BadRequestException(e.message);
      }
      throw new InternalServerErrorException(e.message);
    }
  }

  @Patch(':id/priority')
  @ApiOperation({ summary: '매칭 대기 우선순위 설정' })
  @ApiResponse({ status: 200, description: '매칭 우선순위가 설정되었습니다.' })
  async setMatchingPriority(@Param('id') matchingId: string, @Body() priorityDto: SetMatchingPriorityDto) {
    try {
      return await this.productMatchingService.setMatchingPriority(matchingId, priorityDto.priority);
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  @Patch(':id/strategy')
  @ApiOperation({ summary: '매칭 전략 변경' })
  @ApiResponse({ status: 200, description: '매칭 전략이 변경되었습니다.' })
  async changeMatchingStrategy(@Param('id') matchingId: string, @Body() changeStrategyDto: ChangeStrategyDto) {
    try {
      return await this.productMatchingService.changeMatchingStrategy(matchingId, changeStrategyDto.strategy);
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException(e.message);
      if (msg.match(/already|invalid|failed|required|exceed/)) throw new BadRequestException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  @Patch(':id/stock-policy')
  @ApiOperation({ summary: '매칭의 재고 정책 업데이트' })
  @ApiBody({ type: StockPolicyDto })
  @ApiResponse({ status: 200, description: '재고 정책이 성공적으로 업데이트되었습니다.' })
  @ApiResponse({ status: 404, description: '매칭을 찾을 수 없습니다.' })
  async updateStockPolicy(@Param('id') matchingId: string, @Body() stockPolicyDto: StockPolicyDto) {
    try {
      return await this.productMatchingService.updateStockPolicy(matchingId, stockPolicyDto);
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  @Get('variants/:variantId/stock-policy')
  @ApiOperation({ summary: 'Variant의 재고 정책 조회' })
  @ApiResponse({ status: 200, description: '재고 정책을 반환합니다.' })
  @ApiResponse({ status: 404, description: 'Variant에 대한 매칭이 없습니다.' })
  async getStockPolicyForVariant(@Param('variantId') variantId: string) {
    const policy = await this.productMatchingService.getStockPolicyForVariant(variantId);
    if (!policy) {
      throw new NotFoundException(`No matching found for variant ${variantId}`);
    }
    return policy;
  }

  @Post('variants/:variantId/sku-lookup')
  @ApiOperation({ summary: 'Variant의 SKU 조합 조회' })
  @ApiResponse({ status: 200, description: '선택된 옵션에 따른 SKU 목록을 반환합니다.' })
  async getSkusForVariant(@Param('variantId') variantId: string, @Body() lookupDto: VariantSkuLookupDto) {
    try {
      return await this.productMatchingService.getSkusForVariant(variantId, lookupDto.selectedOptions);
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }
}
