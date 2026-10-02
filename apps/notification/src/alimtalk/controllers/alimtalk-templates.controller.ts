import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '@app/authorization';
import { CurrentUser } from '../../shared/decorators/user.decorator';
import {
  AlimtalkTemplateCommentDto,
  AlimtalkTestSendDto,
  CreateAlimtalkTemplateDto,
  UpdateAlimtalkTemplateDto,
} from '../dto';
import { AlimtalkTemplatesService } from '../services/alimtalk-templates.service';

// 조회는 직원 전역 가드(AdminRealmGuard)로 충분하다. 카카오에 등록·수정하거나 실제로 보내는 라우트는
// 직원 역할이 넓어져도 admin·master 로 남도록 역할을 명시한다.
const AdminOnly = () => UseGuards(RolesGuard('admin', 'master'));

@ApiTags('alimtalk')
@Controller('alimtalk/templates')
export class AlimtalkTemplatesController {
  constructor(private readonly service: AlimtalkTemplatesService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get('categories')
  categories() {
    return this.service.categories();
  }

  @Get(':code')
  get(@Param('code') code: string) {
    return this.service.get(code);
  }

  @Post()
  @AdminOnly()
  create(@Body() dto: CreateAlimtalkTemplateDto) {
    return this.service.create(dto);
  }

  @Put(':code')
  @AdminOnly()
  update(@Param('code') code: string, @Body() dto: UpdateAlimtalkTemplateDto) {
    return this.service.update(code, dto);
  }

  @Post(':code/comments')
  @AdminOnly()
  comment(@Param('code') code: string, @Body() dto: AlimtalkTemplateCommentDto) {
    return this.service.comment(code, dto.comment);
  }

  @Post(':code/test-send')
  @AdminOnly()
  @HttpCode(HttpStatus.OK)
  testSend(@Param('code') code: string, @Body() dto: AlimtalkTestSendDto, @CurrentUser() user: { userId: string }) {
    return this.service.testSend(code, user.userId, dto);
  }
}
