import {
  Body,
  Controller,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { SetUserScopesDto } from './dto/set-user-scopes.dto';
import { RolesService } from './roles.service';
import { RolesGuard } from '../../commons/guards/roles.guard';
import { RequireScopes } from '../../commons/decorators/require-scopes.decorator';

@Controller('roles')
@UseGuards(RolesGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post('/admin/set-scopes')
  @RequireScopes(['admin'])
  async setUsersScopes(
    @Body(ValidationPipe) setUserScopesDto: SetUserScopesDto,
  ) {
    return this.rolesService.setUsersScopes(setUserScopesDto);
  }
}
