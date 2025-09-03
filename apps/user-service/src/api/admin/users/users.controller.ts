import { AuthorizationGuard, RequireScopes } from '@app/roles';
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../commons/guards/jwt-auth.guard';
import { UsersService } from './users.service';

@ApiTags('사용자 관리')
@ApiBearerAuth('access-token')
@Controller('admin/users')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequireScopes(['master'])
  async getUsers(
    @Query()
    query: {
      page?: number;
      limit?: number;
      userId?: string;
      username?: string;
      email?: string;
      sort?: 'createdAt' | 'username' | 'email' | 'lastActivityAt';
      order?: 'asc' | 'desc';
    },
  ) {
    const filters = {
      page: query.page,
      limit: query.limit,
      userId: query.userId,
      username: query.username,
      email: query.email,
      sort: query.sort,
      order: query.order,
    };

    return this.usersService.getUsers(filters);
  }
}
