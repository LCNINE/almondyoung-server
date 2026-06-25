import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RolesGuard, User } from '@app/authorization';
import { CreateBusinessLinkDto } from '../../sales-order/dto/create-business-link.dto';
import { AssignCsCaseDto, CreateCsCaseDto, CsCaseResponseDto, UpdateCsCaseStatusDto } from '../dto';
import { CsCasesService } from '../services/cs-cases.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string } | undefined;

@ApiTags('CS Cases')
@ApiBearerAuth()
@UseGuards(RolesGuard('master', 'admin'))
@Controller('cs-cases')
export class CsCasesController {
  constructor(private readonly service: CsCasesService) {}

  @Post()
  @ApiOperation({ summary: 'CS Case 생성' })
  @ApiResponse({ status: 201, type: CsCaseResponseDto })
  create(@Body() dto: CreateCsCaseDto, @User() user: AuthenticatedUser) {
    return this.service.create(dto, this.getUserId(user));
  }

  @Get()
  @ApiOperation({ summary: 'CS Case 목록 조회' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  list(@Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number) {
    return this.service.list(limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'CS Case 단건 조회(타임라인 포함)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: CsCaseResponseDto })
  getOne(@Param('id') id: string) {
    return this.service.getOne(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'CS Case 상태 변경(재오픈 포함)' })
  @ApiParam({ name: 'id' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateCsCaseStatusDto, @User() user: AuthenticatedUser) {
    return this.service.updateStatus(id, dto.status, this.getUserId(user));
  }

  @Patch(':id/assignee')
  @ApiOperation({ summary: 'CS Case 담당자 배정/해제' })
  @ApiParam({ name: 'id' })
  assign(@Param('id') id: string, @Body() dto: AssignCsCaseDto, @User() user: AuthenticatedUser) {
    return this.service.assign(id, dto.assigneeId, this.getUserId(user));
  }

  @Post(':id/business-links')
  @ApiOperation({ summary: 'CS Case 업무 연결 생성' })
  @ApiParam({ name: 'id' })
  createBusinessLink(@Param('id') id: string, @Body() dto: CreateBusinessLinkDto) {
    return this.service.createBusinessLink(id, dto);
  }

  private getUserId(user: AuthenticatedUser): string | undefined {
    return user?.id ?? user?.userId ?? user?.sub;
  }
}
