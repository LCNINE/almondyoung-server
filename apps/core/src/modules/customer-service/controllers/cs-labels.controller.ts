import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '@app/authorization';
import { CreateCsLabelDto } from '../dto/cs-label.dto';
import { CsLabelsService } from '../services/cs-labels.service';

@ApiTags('CS Labels')
@ApiBearerAuth()
@UseGuards(RolesGuard('master', 'admin'))
@Controller('cs-labels')
export class CsLabelsController {
  constructor(private readonly service: CsLabelsService) {}

  @Get()
  @ApiOperation({ summary: '라벨 taxonomy 목록' })
  list() {
    return this.service.listLabels();
  }

  @Post()
  @ApiOperation({ summary: '라벨 생성(관리자)' })
  create(@Body() dto: CreateCsLabelDto) {
    return this.service.createLabel(dto);
  }
}
