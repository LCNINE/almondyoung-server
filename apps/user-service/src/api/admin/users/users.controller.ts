import { AuthorizationGuard, RequireScopes } from '@app/roles';
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../commons/guards/jwt-auth.guard';
import { UserResponseDto } from '../../users/dto/user.response.dto';
import { GetUsersQueryDto } from './dto/get-users-query.dto';
import { UsersService } from './users.service';

@ApiTags('사용자 관리')
@ApiBearerAuth('access-token')
@Controller('admin/users')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequireScopes(['master', 'admin:users:read'])
  @ApiOperation({
    summary: '사용자 목록 조회',
    description: '사용자 목록을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '사용자 목록 조회 성공',
    type: UserResponseDto,
    isArray: true,
  })
  async getUsers(@Query() query: GetUsersQueryDto) {
    return this.usersService.getUsers(query);
  }
}
