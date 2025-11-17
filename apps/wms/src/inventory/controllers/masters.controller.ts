import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import {
  ApiOperation,
  ApiTags,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { MasterService } from '../services/master.service';
import { ConfigService } from '@nestjs/config';
import { CreateMasterDto } from '../dto/master/create-master.dto';
import { UpdateMasterDto } from '../dto/master/update-master.dto';

// DEPRECATED: OptionSchema는 UI 호환성을 위해 타입만 유지
type OptionSchema = { options?: Array<{ name: string; values: string[] }> };

@ApiTags('Masters')
@Controller('wms/masters')
export class MastersController {
  constructor(
    private readonly masterService: MasterService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @ApiOperation({
    summary: '마스터 생성',
    description: '새로운 제품 마스터를 생성합니다.',
  })
  @ApiBody({ type: CreateMasterDto })
  @ApiResponse({ status: 201, description: '마스터 생성 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  create(@Body() createMasterDto: CreateMasterDto) {
    return this.masterService.createMaster(createMasterDto);
  }

  @Put(':id')
  @ApiOperation({
    summary: '마스터 수정',
    description: '기존 제품 마스터 정보를 수정합니다.',
  })
  @ApiParam({ name: 'id', description: '마스터 ID (UUID)' })
  @ApiBody({ type: UpdateMasterDto })
  @ApiResponse({ status: 200, description: '마스터 수정 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 404, description: '마스터를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  update(@Param('id') id: string, @Body() updateMasterDto: UpdateMasterDto) {
    return this.masterService.updateMaster(id, updateMasterDto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: '마스터 삭제',
    description: '제품 마스터를 삭제합니다.',
  })
  @ApiParam({ name: 'id', description: '마스터 ID (UUID)' })
  @ApiResponse({ status: 200, description: '마스터 삭제 성공' })
  @ApiResponse({ status: 404, description: '마스터를 찾을 수 없음' })
  @ApiResponse({ status: 409, description: '사용 중인 마스터로 삭제할 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  remove(@Param('id') id: string) {
    return this.masterService.deleteMaster(id);
  }

  @Post(':id/pim-sync')
  @ApiOperation({
    summary: 'PIM 동기화 트리거',
    description: 'PIM 서비스와 동기화하여 마스터 및 변형을 생성합니다.',
  })
  @ApiParam({ name: 'id', description: '마스터 ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'PIM 동기화 트리거 성공',
  })
  @ApiResponse({ status: 404, description: '마스터를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  triggerPimSync(@Param('id') id: string) {
    return this.masterService.syncWithPim(id);
  }

  @Put(':id/options')
  @ApiOperation({
    summary: '옵션 스키마 설정/수정',
    description: '마스터의 옵션 스키마를 설정하거나 수정합니다.',
  })
  @ApiParam({ name: 'id', description: '마스터 ID (UUID)' })
  @ApiBody({
    description: '옵션 스키마 데이터',
    schema: {
      type: 'object',
      properties: {
        options: {
          type: 'array',
          description: '옵션 목록',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '옵션 이름 (예: 색상, 사이즈)' },
              values: {
                type: 'array',
                items: { type: 'string' },
                description: '옵션 값 목록',
              },
            },
            required: ['name', 'values'],
          },
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: '옵션 스키마 설정/수정 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 404, description: '마스터를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  updateOptions(
    @Param('id') id: string,
    @Body() optionSchema: OptionSchema,
  ) {
    return this.masterService.updateMasterOptions(id, optionSchema);
  }

  @Get(':id/skus')
  @ApiOperation({
    summary: '마스터의 SKU 목록 조회',
    description: '특정 마스터에 연결된 모든 SKU 목록을 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '마스터 ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'SKU 목록 조회 성공',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          code: { type: 'string' },
          name: { type: 'string' },
          // 기타 SKU 필드들...
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: '마스터를 찾을 수 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  getMasterSkus(@Param('id') id: string) {
    return this.masterService.getSkusByMaster(id);
  }
}


