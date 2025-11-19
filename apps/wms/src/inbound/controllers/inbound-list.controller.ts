import {
    Controller,
    Get,
    Post,
    Param,
    Query,
    Body,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';
import { InboundListService } from '../services/inbound-list.service';
import { InboundListFiltersDto } from '../dto/inbound-list/inbound-list-filters.dto';
import { ApplyInboundDto } from '../dto/inbound-list/apply-inbound.dto';
import { ImmediateReceiveDto } from '../dto/inbound-list/immediate-receive.dto';
import { InboundListResponseDto, InboundListItemDto } from '../dto/inbound-list/inbound-list-response.dto';

@ApiTags('Inbound Lists')
@Controller('inbound/lists')
export class InboundListController {
    constructor(private readonly inboundListService: InboundListService) {}

    @Get()
    @ApiOperation({ summary: '입고 리스트 조회 (List inbound items with filters)' })
    @ApiResponse({
        status: 200,
        description: 'Inbound list retrieved successfully',
        type: InboundListResponseDto,
    })
    async listInboundLists(
        @Query() filters: InboundListFiltersDto
    ): Promise<InboundListResponseDto> {
        return this.inboundListService.listInboundLists(filters);
    }

    @Get(':id')
    @ApiOperation({ summary: '입고 리스트 상세 조회 (Get inbound list item detail)' })
    @ApiParam({ name: 'id', description: 'Inbound list item ID' })
    @ApiResponse({
        status: 200,
        description: 'Inbound list item detail',
        type: InboundListItemDto,
    })
    @ApiResponse({ status: 404, description: 'Inbound list item not found' })
    async getInboundListDetail(
        @Param('id') id: string
    ): Promise<InboundListItemDto> {
        return this.inboundListService.getInboundListDetail(id);
    }

    @Post(':id/apply')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: '입고 신청 (Apply for inbound - status: pending → applied)' })
    @ApiParam({ name: 'id', description: 'Inbound list item ID' })
    @ApiResponse({
        status: 200,
        description: 'Inbound application successful',
        schema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                status: { type: 'string', example: 'applied' },
                appliedAt: { type: 'string', format: 'date-time' },
                message: { type: 'string', example: '입고신청이 완료되었습니다.' }
            }
        }
    })
    @ApiResponse({ status: 400, description: 'Invalid status transition' })
    @ApiResponse({ status: 404, description: 'Inbound list item not found' })
    async applyInbound(
        @Param('id') id: string,
        @Body() dto: ApplyInboundDto
    ): Promise<any> {
        return this.inboundListService.applyInbound(id, dto);
    }

    @Post(':id/receive')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: '즉시 입고 (Immediate receive - creates receipt and updates stock)' })
    @ApiParam({ name: 'id', description: 'Inbound list item ID' })
    @ApiResponse({
        status: 200,
        description: 'Immediate receive successful',
        schema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                receiptId: { type: 'string' },
                status: { type: 'string', example: 'confirmed' },
                message: { type: 'string', example: '입고가 완료되었습니다.' }
            }
        }
    })
    @ApiResponse({ status: 400, description: 'Invalid status or missing data' })
    @ApiResponse({ status: 404, description: 'Inbound list item not found' })
    async immediateReceive(
        @Param('id') id: string,
        @Body() dto: ImmediateReceiveDto
    ): Promise<any> {
        return this.inboundListService.immediateReceive(id, dto);
    }

    @Get(':id/barcode')
    @ApiOperation({ summary: '바코드 생성 (Generate barcode for inbound item)' })
    @ApiParam({ name: 'id', description: 'Inbound list item ID' })
    @ApiResponse({
        status: 200,
        description: 'Barcode generated successfully',
        schema: {
            type: 'object',
            properties: {
                barcodeValue: { type: 'string', example: '1234567890123' },
                format: { type: 'string', example: 'CODE128' },
                message: { type: 'string', example: '바코드가 생성되었습니다.' }
            }
        }
    })
    @ApiResponse({ status: 404, description: 'Inbound list item not found' })
    async generateBarcode(
        @Param('id') id: string
    ): Promise<any> {
        return this.inboundListService.generateBarcode(id);
    }
}



