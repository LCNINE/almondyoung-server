import { Body, Controller, Post, ValidationPipe } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ScopesService } from './scopes.service';
import { SetUserScopesDto } from './dto/set-user-scopes.dto';
import { RequireScopes } from '@app/roles';

@ApiTags('권한 범위')
@ApiBearerAuth()
@Controller('scopes')
export class ScopesController {
  constructor(private readonly scopesService: ScopesService) {}

  @ApiOperation({ summary: '권한 범위 생성' })
  @ApiResponse({ status: 201, description: '권한 범위 생성 성공' })
  @Post('/create-scopes')
  @RequireScopes(['master'])
  async createScopes(@Body(ValidationPipe) setUserScopesDto: SetUserScopesDto) {
    return this.scopesService.createScopes(setUserScopesDto);
  }
}
