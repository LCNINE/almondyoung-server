import { AuthorizationGuard, RequireScopes } from '@app/roles';
import {
  Body,
  Controller,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../commons/guards/jwt-auth.guard';
import { SetUserScopesDto } from './dto/set-user-scopes.dto';
import { ScopesService } from './scopes.service';

@ApiTags('Admin/Scopes')
@ApiBearerAuth('access-token')
@Controller('admin/scopes')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class ScopesController {
  constructor(private readonly scopesService: ScopesService) {}

  @ApiOperation({ summary: '권한 범위 생성' })
  @ApiResponse({ status: 201, description: '권한 범위 생성 성공' })
  @Post('/create-scopes')
  @RequireScopes(['master'])
  async createScopes(
    @Body(ValidationPipe) setUserScopesDto: SetUserScopesDto,
  ): Promise<void> {
    return this.scopesService.createScopes(setUserScopesDto);
  }
}
