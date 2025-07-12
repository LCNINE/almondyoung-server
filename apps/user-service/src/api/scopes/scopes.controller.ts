import { Body, Controller, Post, ValidationPipe } from '@nestjs/common';
import { ScopesService } from './scopes.service';
import { SetUserScopesDto } from './dto/set-user-scopes.dto';
import { RequireScopes } from '../../commons/decorators/require-scopes.decorator';

@Controller('scopes')
export class ScopesController {
  constructor(private readonly scopesService: ScopesService) {}

  @Post('/create-scopes')
  @RequireScopes(['admin'])
  async createScopes(@Body(ValidationPipe) setUserScopesDto: SetUserScopesDto) {
    return this.scopesService.createScopes(setUserScopesDto);
  }
}
