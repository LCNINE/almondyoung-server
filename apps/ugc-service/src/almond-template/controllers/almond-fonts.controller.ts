import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public, RequirePermission, RequireScopes, User } from '@app/authorization';
import { AlmondFontResponseDto, CreateAlmondFontDto } from '../dto/almond-font.dto';
import { AlmondFontsService } from '../services/almond-fonts.service';

@ApiTags('Almond Fonts')
@Controller()
export class AlmondFontsController {
  constructor(private readonly service: AlmondFontsService) {}

  @Public()
  @Get('almond-fonts')
  @ApiOperation({ summary: '시안 디자이너가 올린 글꼴 목록', description: '지운 글꼴은 빠진다. 이름순' })
  @ApiResponse({ status: 200, type: [AlmondFontResponseDto] })
  list(): Promise<AlmondFontResponseDto[]> {
    return this.service.list();
  }

  @RequirePermission('marketing.almond_template.write')
  @Post('admin/almond-fonts')
  @ApiBearerAuth()
  @RequireScopes('admin:template:write')
  @ApiOperation({
    summary: '글꼴 등록',
    description: 'file-service 에 올린 글꼴 파일을 목록에 넣는다. 파일 앞머리로 TTF·OTF·WOFF·WOFF2 인지 확인한다',
  })
  @ApiBody({ type: CreateAlmondFontDto })
  @ApiResponse({ status: 201, type: AlmondFontResponseDto })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 409 })
  create(@Body() dto: CreateAlmondFontDto, @User('userId') userId: string): Promise<AlmondFontResponseDto> {
    return this.service.create(dto, userId);
  }

  @RequirePermission('marketing.almond_template.write')
  @Delete('admin/almond-fonts/:id')
  @HttpCode(204)
  @ApiBearerAuth()
  @RequireScopes('admin:template:write')
  @ApiOperation({ summary: '글꼴 목록에서 빼기', description: '이미 그 글꼴을 쓴 시안은 그대로 보이고 인쇄된다' })
  @ApiResponse({ status: 204 })
  async remove(@Param('id', ParseUUIDPipe) id: string, @User('userId') userId: string): Promise<void> {
    await this.service.remove(id, userId);
  }
}
