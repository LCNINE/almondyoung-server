import { Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { CreateBusinessLinkDto } from '../../sales-order/dto/create-business-link.dto';
import { CreateCsCaseDto, CsCaseResponseDto } from '../dto';
import { CsCasesService } from '../services/cs-cases.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string } | undefined;

@ApiTags('CS Cases')
@Controller('cs-cases')
export class CsCasesController {
  constructor(private readonly service: CsCasesService) {}

  @Post()
  @ApiOperation({ summary: 'CS Case 생성' })
  @ApiResponse({ status: 201, description: 'CS Case 생성 성공', type: CsCaseResponseDto })
  create(@Body() dto: CreateCsCaseDto, @User() user: AuthenticatedUser) {
    return this.service.create(dto, this.getUserId(user));
  }

  @Get()
  @ApiOperation({ summary: 'CS Case 목록 조회' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'CS Case 목록 조회 성공', type: [CsCaseResponseDto] })
  list(@Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number) {
    return this.service.list(limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'CS Case 단건 조회' })
  @ApiParam({ name: 'id', description: 'CS Case ID' })
  @ApiResponse({ status: 200, description: 'CS Case 조회 성공', type: CsCaseResponseDto })
  getOne(@Param('id') id: string) {
    return this.service.getOne(id);
  }

  @Post(':id/business-links')
  @ApiOperation({ summary: 'CS Case 업무 연결 생성' })
  @ApiParam({ name: 'id', description: 'CS Case ID' })
  @ApiResponse({ status: 201, description: '업무 연결 생성 성공' })
  createBusinessLink(@Param('id') id: string, @Body() dto: CreateBusinessLinkDto) {
    return this.service.createBusinessLink(id, dto);
  }

  private getUserId(user: AuthenticatedUser): string | undefined {
    return user?.id ?? user?.userId ?? user?.sub;
  }
}
