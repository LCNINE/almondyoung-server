import { Body, Controller, Get, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import {
  AlmondDesignCreatedResponseDto,
  AlmondDesignResponseDto,
  CreateAlmondDesignDto,
} from '../dto/almond-design.dto';
import { AlmondDesignsService } from '../services/almond-designs.service';

@ApiTags('Almond Designs')
@ApiBearerAuth()
@Controller('almond-designs')
export class AlmondDesignsController {
  constructor(private readonly service: AlmondDesignsService) {}

  @Post()
  @ApiOperation({
    summary: '주문용 시안 저장',
    description: '저장본은 불변이다 — 주문이 이 id 를 스냅샷으로 가리킨다. 본문 상한은 이 라우트만 5MB',
  })
  @ApiBody({ type: CreateAlmondDesignDto })
  @ApiResponse({ status: HttpStatus.CREATED, type: AlmondDesignCreatedResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST })
  create(@User('userId') userId: string, @Body() dto: CreateAlmondDesignDto): Promise<AlmondDesignCreatedResponseDto> {
    return this.service.create(dto, userId);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '내 시안 조회 (남의 것은 404)' })
  @ApiResponse({ status: HttpStatus.OK, type: AlmondDesignResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  get(@User('userId') userId: string, @Param('id', ParseUUIDPipe) id: string): Promise<AlmondDesignResponseDto> {
    return this.service.getMine(id, userId);
  }
}
