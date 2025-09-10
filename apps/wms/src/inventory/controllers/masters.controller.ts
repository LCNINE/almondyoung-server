import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MasterService } from '../services/master.service';
import { ConfigService } from '@nestjs/config';

@ApiTags('Masters')
@Controller('wms/masters')
export class MastersController {
  constructor(private readonly masterService: MasterService, private readonly config: ConfigService) {}

  @Post()
  @ApiOperation({ summary: '마스터 생성' })
  create(@Body() body: any) {
    return this.masterService.createMaster(body);
  }

  @Put(':id')
  @ApiOperation({ summary: '마스터 수정' })
  update(@Param('id') id: string, @Body() body: any) {
    return this.masterService.updateMaster(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: '마스터 삭제' })
  remove(@Param('id') id: string) {
    return this.masterService.deleteMaster(id);
  }

  @Post(':id/generate-skus')
  @ApiOperation({ summary: '옵션 조합으로 SKU 생성' })
  generateSkus(@Param('id') id: string) {
    return this.masterService.generateSkusFromOptions(id);
  }

  @Post(':id/pim-sync')
  @ApiOperation({ summary: 'PIM 동기화(마스터/변형 생성) 트리거' })
  triggerPimSync(@Param('id') id: string) {
    return this.masterService.syncWithPim(id);
  }
}


