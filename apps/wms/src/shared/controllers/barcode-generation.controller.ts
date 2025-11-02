import {
    Controller,
    Post,
    Body,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { BarcodeService } from '../services/barcode.service';
import { 
    GenerateBarcodeImageDto,
    GenerateSkuBarcodeDto,
    GenerateLocationBarcodeDto,
    GenerateFulfillmentOrderBarcodeDto,
    BarcodeImageResponseDto
} from '../dto/generate-barcode.dto';

@ApiTags('Barcode Generation')
@Controller('wms/barcode-generation')
export class BarcodeGenerationController {
    constructor(private readonly barcodeService: BarcodeService) {}

    @Post('custom')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ 
        summary: '사용자 정의 바코드 이미지 생성 (Generate custom barcode image)',
        description: 'Generate a barcode image for any custom value with specified format'
    })
    @ApiResponse({
        status: 200,
        description: 'Barcode image generated successfully (Base64 PNG)',
        type: BarcodeImageResponseDto,
    })
    @ApiResponse({
        status: 400,
        description: 'Invalid barcode value or format',
    })
    async generateCustomBarcode(
        @Body() dto: GenerateBarcodeImageDto
    ): Promise<BarcodeImageResponseDto> {
        return this.barcodeService.generateCustomBarcodeImage(
            dto.value,
            dto.format ?? 'CODE128',
            {
                scale: dto.scale,
                height: dto.height,
                includetext: dto.includetext,
            }
        );
    }

    @Post('sku')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ 
        summary: 'SKU 바코드 이미지 생성 (Generate SKU barcode image)',
        description: 'Generate a barcode image for a SKU with format SKU-{uuid}'
    })
    @ApiResponse({
        status: 200,
        description: 'SKU barcode image generated successfully',
        type: BarcodeImageResponseDto,
    })
    @ApiResponse({
        status: 400,
        description: 'Invalid SKU ID',
    })
    async generateSkuBarcode(
        @Body() dto: GenerateSkuBarcodeDto
    ): Promise<BarcodeImageResponseDto> {
        return this.barcodeService.generateSkuBarcodeImage(
            dto.skuId,
            dto.format ?? 'CODE128'
        );
    }

    @Post('location')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ 
        summary: '로케이션 바코드 이미지 생성 (Generate location barcode image)',
        description: 'Generate a barcode image for a location with format LOC-{code}'
    })
    @ApiResponse({
        status: 200,
        description: 'Location barcode image generated successfully',
        type: BarcodeImageResponseDto,
    })
    @ApiResponse({
        status: 400,
        description: 'Invalid location code',
    })
    async generateLocationBarcode(
        @Body() dto: GenerateLocationBarcodeDto
    ): Promise<BarcodeImageResponseDto> {
        return this.barcodeService.generateLocationBarcodeImage(
            dto.locationCode,
            dto.format ?? 'CODE128'
        );
    }

    @Post('fulfillment-order')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ 
        summary: '풀필먼트 오더 바코드 이미지 생성 (Generate FO barcode image)',
        description: 'Generate a barcode image for a fulfillment order with format FO-{uuid}'
    })
    @ApiResponse({
        status: 200,
        description: 'Fulfillment order barcode image generated successfully',
        type: BarcodeImageResponseDto,
    })
    @ApiResponse({
        status: 400,
        description: 'Invalid fulfillment order ID',
    })
    async generateFulfillmentOrderBarcode(
        @Body() dto: GenerateFulfillmentOrderBarcodeDto
    ): Promise<BarcodeImageResponseDto> {
        return this.barcodeService.generateFulfillmentOrderBarcodeImage(
            dto.fulfillmentOrderId,
            dto.format ?? 'CODE128'
        );
    }

    @Post('validate')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ 
        summary: '바코드 포맷 검증 (Validate barcode format)',
        description: 'Validate if a value is compatible with a specific barcode format'
    })
    @ApiResponse({
        status: 200,
        description: 'Validation result',
        schema: {
            type: 'object',
            properties: {
                value: { type: 'string', example: 'TEST-123' },
                format: { type: 'string', example: 'CODE128' },
                isValid: { type: 'boolean', example: true },
                message: { type: 'string', example: 'Valid barcode format' }
            }
        }
    })
    async validateBarcode(
        @Body() body: { value: string; format: string }
    ): Promise<{
        value: string;
        format: string;
        isValid: boolean;
        message: string;
    }> {
        const isValid = this.barcodeService.validateBarcodeFormat(body.value, body.format);

        return {
            value: body.value,
            format: body.format,
            isValid,
            message: isValid 
                ? `Valid barcode format for ${body.format}` 
                : `Invalid barcode value for format ${body.format}`,
        };
    }
}

