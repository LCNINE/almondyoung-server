import {
    Controller,
    Get,
    Post,
    Put,
    Param,
    Body,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { StocktakingService } from '../services/stocktaking.service';
import { CreateStocktakingSessionDto } from '../dto/create-session.dto';
import { ScanLocationDto } from '../dto/scan-location.dto';
import { ScanProductDto } from '../dto/scan-product.dto';
import { UpdateCountDto } from '../dto/update-count.dto';
import { GenerateAdjustmentsDto } from '../dto/generate-adjustments.dto';

@ApiTags('Stocktaking')
@Controller('wms/stocktaking')
export class StocktakingController {
    constructor(private readonly stocktakingService: StocktakingService) {}

    @Post('sessions')
    @ApiOperation({ summary: '재고 실사 세션 생성 (Create stocktaking session)' })
    @ApiResponse({ status: 201, description: 'Session created successfully' })
    async createSession(@Body() dto: CreateStocktakingSessionDto) {
        return this.stocktakingService.createSession(dto);
    }

    @Post('sessions/:id/start')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: '재고 실사 시작 (Start stocktaking session)' })
    @ApiParam({ name: 'id', description: 'Session ID' })
    @ApiResponse({ status: 200, description: 'Session started' })
    async startSession(@Param('id') id: string) {
        return this.stocktakingService.startSession(id);
    }

    @Post('scan-location')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: '위치 바코드 스캔 (Scan location barcode)' })
    @ApiResponse({ status: 200, description: 'Location scanned, expected items loaded' })
    async scanLocation(@Body() dto: ScanLocationDto) {
        return this.stocktakingService.scanLocation(dto);
    }

    @Post('scan-product')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: '상품 바코드 스캔 (Scan product barcode)' })
    @ApiResponse({ status: 200, description: 'Product scanned, count updated' })
    async scanProduct(@Body() dto: ScanProductDto) {
        return this.stocktakingService.scanProduct(dto);
    }

    @Put('lines/:id/count')
    @ApiOperation({ summary: '수량 수동 입력 (Update count manually)' })
    @ApiParam({ name: 'id', description: 'Line ID' })
    @ApiResponse({ status: 200, description: 'Count updated' })
    async updateCount(
        @Param('id') id: string,
        @Body() dto: UpdateCountDto
    ) {
        return this.stocktakingService.updateCount(id, dto);
    }

    @Get('sessions/:id/variances')
    @ApiOperation({ summary: '차이 조회 (Get variances/discrepancies)' })
    @ApiParam({ name: 'id', description: 'Session ID' })
    @ApiResponse({ status: 200, description: 'List of variances' })
    async getVariances(@Param('id') id: string) {
        return this.stocktakingService.getVariances(id);
    }

    @Post('sessions/:id/generate-adjustments')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: '조정 자동 생성 (Generate stock adjustments)' })
    @ApiParam({ name: 'id', description: 'Session ID' })
    @ApiResponse({ status: 200, description: 'Adjustments generated' })
    async generateAdjustments(
        @Param('id') id: string,
        @Body() dto: GenerateAdjustmentsDto
    ) {
        return this.stocktakingService.generateAdjustments(id, dto);
    }

    @Post('sessions/:id/complete')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: '재고 실사 완료 (Complete stocktaking session)' })
    @ApiParam({ name: 'id', description: 'Session ID' })
    @ApiResponse({ status: 200, description: 'Session completed with summary' })
    async completeSession(@Param('id') id: string) {
        return this.stocktakingService.completeSession(id);
    }
}


