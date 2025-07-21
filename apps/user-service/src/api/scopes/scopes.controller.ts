import { Body, Controller, Post, ValidationPipe } from '@nestjs/common';
import { ScopesService } from './scopes.service';
import { SetUserScopesDto } from './dto/set-user-scopes.dto';
import { RequireScopes } from '@app/roles';

@Controller('scopes')
export class ScopesController {
  constructor(private readonly scopesService: ScopesService) {}

  @Post('/create-scopes')
  @RequireScopes(['master'])
  async createScopes(@Body(ValidationPipe) setUserScopesDto: SetUserScopesDto) {
    return this.scopesService.createScopes(setUserScopesDto);
  }
}
