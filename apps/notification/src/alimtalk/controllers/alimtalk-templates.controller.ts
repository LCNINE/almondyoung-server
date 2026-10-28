import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@app/authorization';
import { CurrentUser } from '../../shared/decorators/user.decorator';
import {
  AlimtalkTemplateCommentDto,
  AlimtalkTestSendDto,
  CreateAlimtalkTemplateDto,
  UpdateAlimtalkTemplateDto,
} from '../dto';
import { AlimtalkTemplatesService } from '../services/alimtalk-templates.service';

@ApiTags('alimtalk')
@Controller('alimtalk/templates')
export class AlimtalkTemplatesController {
  constructor(private readonly service: AlimtalkTemplatesService) {}

  @RequirePermission('messaging.message.read')
  @Get()
  list() {
    return this.service.list();
  }

  @RequirePermission('messaging.message.read')
  @Get('categories')
  categories() {
    return this.service.categories();
  }

  @RequirePermission('messaging.message.read')
  @Get(':code')
  get(@Param('code') code: string) {
    return this.service.get(code);
  }

  @RequirePermission('messaging.template.write')
  @Post()
  create(@Body() dto: CreateAlimtalkTemplateDto) {
    return this.service.create(dto);
  }

  @RequirePermission('messaging.template.write')
  @Put(':code')
  update(@Param('code') code: string, @Body() dto: UpdateAlimtalkTemplateDto) {
    return this.service.update(code, dto);
  }

  @RequirePermission('messaging.template.write')
  @Post(':code/comments')
  comment(@Param('code') code: string, @Body() dto: AlimtalkTemplateCommentDto) {
    return this.service.comment(code, dto.comment);
  }

  @RequirePermission('messaging.message.send')
  @Post(':code/test-send')
  @HttpCode(HttpStatus.OK)
  testSend(@Param('code') code: string, @Body() dto: AlimtalkTestSendDto, @CurrentUser() user: { userId: string }) {
    return this.service.testSend(code, user.userId, dto);
  }
}
