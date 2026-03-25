import { RequireScopes, JwtPayload } from '@app/authorization';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BlacklistsService } from './blacklists.service';
import { BlacklistsCreateDto } from './dto/blacklists-create.dto';
import { BlacklistsResponseDto } from './dto/blacklists-response.dto';
import { BlacklistsNotFoundException } from './exceptions/blacklists.exceptions';

@ApiTags('블랙리스트 관리')
@ApiBearerAuth('access-token')
@Controller('admin/blacklists')
export class BlacklistsController {
  constructor(private readonly blacklistsService: BlacklistsService) {}

  @ApiOperation({
    summary: '블랙리스트 조회',
    description: '블랙리스트를 조회합니다.',
  })
  @ApiQuery({ name: 'page', description: '페이지', required: false })
  @ApiQuery({ name: 'limit', description: '페이지 크기', required: false })
  @ApiQuery({ name: 'userId', description: '사용자 ID', required: false })
  @ApiResponse({ status: 200, description: '블랙리스트 조회 성공' })
  @Get()
  @RequireScopes('master', 'admin:users:read')
  async getBlacklists(@Query() query: { page?: string; limit?: string; userId?: string }): Promise<{
    data: BlacklistsResponseDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const filters = {
      page: query.page ? parseInt(query.page) : undefined,
      limit: query.limit ? parseInt(query.limit) : undefined,
      userId: query.userId,
    };

    return await this.blacklistsService.getBlacklists(filters);
  }
  @ApiOperation({
    summary: '블랙리스트 조회(사용자 ID)',
    description: '블랙리스트를 조회합니다.',
  })
  @ApiParam({ name: 'userId', description: '블랙리스트 ID' })
  @ApiResponse({ status: 200, description: '블랙리스트 조회 성공' })
  @ApiResponse({ status: 404, description: '블랙리스트를 찾을 수 없음' })
  @Get(':userId')
  @RequireScopes('master', 'admin:users:read')
  async getBlacklistByUserId(@Param('userId') userId: string): Promise<BlacklistsResponseDto> {
    const blacklist = await this.blacklistsService.getBlacklistByUserId(userId);
    if (!blacklist) {
      throw new BlacklistsNotFoundException('해당 블랙리스트 정보를 찾을 수 없습니다.');
    }
    return blacklist;
  }
  @ApiOperation({
    summary: '블랙리스트 생성',
    description: '블랙리스트를 생성합니다.',
  })
  @ApiBody({ type: BlacklistsCreateDto })
  @ApiResponse({ status: 200, description: '블랙리스트 생성 성공' })
  @ApiResponse({ status: 400, description: '블랙리스트 생성 실패' })
  @Post()
  @RequireScopes('master', 'admin:users:modify')
  async createBlacklist(@Body() blacklistsCreateDto: BlacklistsCreateDto, @CurrentUser() user: JwtPayload) {
    const adminId = user.id;
    return await this.blacklistsService.createBlacklist(blacklistsCreateDto, adminId);
  }

  @ApiOperation({
    summary: '블랙리스트 소프트 삭제',
    description: '블랙리스트를 삭제합니다.',
  })
  @ApiParam({ name: 'userId', description: '블랙리스트 ID' })
  @ApiResponse({ status: 200, description: '블랙리스트 삭제 성공' })
  @ApiResponse({ status: 404, description: '블랙리스트를 찾을 수 없음' })
  @Delete(':userId')
  @RequireScopes('master', 'admin:users:modify')
  async deleteBlacklist(@Param('userId') userId: string, @CurrentUser() user: JwtPayload) {
    const adminId = user.id;
    return await this.blacklistsService.deleteBlacklist(userId, adminId);
  }
}
