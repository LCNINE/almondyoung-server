import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RolesGuard, User } from '@app/authorization';
import { UnauthorizedError } from '@app/shared';
import { ArchiveService } from './archive.service';
import type { ArchiveSpace } from './schema/archive.schema';
import {
  ArchivePageDetailDto,
  ArchivePageNodeDto,
  ArchivePageSaveResultDto,
  ArchivePageVersionDetailDto,
  ArchivePageVersionDto,
  ArchiveSearchResultDto,
  ArchiveTrashItemDto,
  CreateArchivePageDto,
  MoveArchivePageDto,
  UpdateArchivePageDto,
} from './dto/archive-page.dto';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string } | undefined;

@ApiTags('Archive')
@ApiBearerAuth()
@UseGuards(RolesGuard('master', 'admin'))
@Controller('archive')
export class ArchiveController {
  constructor(private readonly service: ArchiveService) {}

  @Get('pages')
  @ApiOperation({ summary: '스페이스의 페이지 트리(평면 목록)' })
  @ApiQuery({ name: 'space', required: false, enum: ['team', 'private'] })
  @ApiResponse({ status: 200, type: [ArchivePageNodeDto] })
  listTree(@Query('space') space: string | undefined, @User() user: AuthenticatedUser) {
    return this.service.listTree(toSpace(space), this.actorId(user));
  }

  @Get('search')
  @ApiOperation({ summary: '제목·본문 검색' })
  @ApiQuery({ name: 'q', required: true })
  @ApiResponse({ status: 200, type: ArchiveSearchResultDto })
  search(@Query('q') query: string, @User() user: AuthenticatedUser) {
    return this.service.search(query ?? '', this.actorId(user));
  }

  @Get('favorites')
  @ApiOperation({ summary: '즐겨찾기한 페이지' })
  @ApiResponse({ status: 200, type: [ArchivePageNodeDto] })
  listFavorites(@User() user: AuthenticatedUser) {
    return this.service.listFavorites(this.actorId(user));
  }

  @Get('recent')
  @ApiOperation({ summary: '최근 수정된 페이지' })
  @ApiResponse({ status: 200, type: [ArchivePageNodeDto] })
  listRecent(@User() user: AuthenticatedUser) {
    return this.service.listRecent(this.actorId(user));
  }

  @Get('trash')
  @ApiOperation({ summary: '휴지통(삭제의 뿌리만)' })
  @ApiResponse({ status: 200, type: [ArchiveTrashItemDto] })
  listTrash(@User() user: AuthenticatedUser) {
    return this.service.listTrash(this.actorId(user));
  }

  @Post('pages')
  @ApiOperation({ summary: '페이지 생성' })
  @ApiResponse({ status: 201, type: ArchivePageDetailDto })
  create(@Body() dto: CreateArchivePageDto, @User() user: AuthenticatedUser) {
    return this.service.create(dto, this.actorId(user));
  }

  @Get('pages/:id')
  @ApiOperation({ summary: '페이지 단건 조회(본문 포함)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: ArchivePageDetailDto })
  getOne(@Param('id') id: string, @User() user: AuthenticatedUser) {
    return this.service.getPage(id, this.actorId(user));
  }

  @Patch('pages/:id')
  @ApiOperation({ summary: '페이지 저장(자동 저장)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: ArchivePageSaveResultDto })
  update(@Param('id') id: string, @Body() dto: UpdateArchivePageDto, @User() user: AuthenticatedUser) {
    return this.service.update(id, dto, this.actorId(user));
  }

  @Post('pages/:id/move')
  @ApiOperation({ summary: '페이지 이동·정렬. 변경 후 트리를 돌려준다' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: [ArchivePageNodeDto] })
  move(@Param('id') id: string, @Body() dto: MoveArchivePageDto, @User() user: AuthenticatedUser) {
    return this.service.move(id, dto, this.actorId(user));
  }

  @Delete('pages/:id')
  @ApiOperation({ summary: '페이지를 휴지통으로(하위 포함)' })
  @ApiParam({ name: 'id' })
  remove(@Param('id') id: string, @User() user: AuthenticatedUser) {
    return this.service.remove(id, this.actorId(user));
  }

  @Post('pages/:id/restore')
  @ApiOperation({ summary: '휴지통에서 복원' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: ArchivePageDetailDto })
  restore(@Param('id') id: string, @User() user: AuthenticatedUser) {
    return this.service.restore(id, this.actorId(user));
  }

  @Delete('pages/:id/purge')
  @ApiOperation({ summary: '영구 삭제(하위·스냅샷 포함)' })
  @ApiParam({ name: 'id' })
  purge(@Param('id') id: string, @User() user: AuthenticatedUser) {
    return this.service.purge(id, this.actorId(user));
  }

  @Post('pages/:id/favorite')
  @ApiOperation({ summary: '즐겨찾기 추가' })
  @ApiParam({ name: 'id' })
  addFavorite(@Param('id') id: string, @User() user: AuthenticatedUser) {
    return this.service.setFavorite(id, this.actorId(user), true);
  }

  @Delete('pages/:id/favorite')
  @ApiOperation({ summary: '즐겨찾기 해제' })
  @ApiParam({ name: 'id' })
  removeFavorite(@Param('id') id: string, @User() user: AuthenticatedUser) {
    return this.service.setFavorite(id, this.actorId(user), false);
  }

  @Get('pages/:id/versions')
  @ApiOperation({ summary: '저장 이력' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: [ArchivePageVersionDto] })
  listVersions(@Param('id') id: string, @User() user: AuthenticatedUser) {
    return this.service.listVersions(id, this.actorId(user));
  }

  @Get('pages/:id/versions/:versionId')
  @ApiOperation({ summary: '저장 이력 단건(본문 포함)' })
  @ApiParam({ name: 'id' })
  @ApiParam({ name: 'versionId' })
  @ApiResponse({ status: 200, type: ArchivePageVersionDetailDto })
  getVersion(@Param('id') id: string, @Param('versionId') versionId: string, @User() user: AuthenticatedUser) {
    return this.service.getVersion(id, versionId, this.actorId(user));
  }

  @Post('pages/:id/versions/:versionId/restore')
  @ApiOperation({ summary: '해당 시점으로 되돌리기' })
  @ApiParam({ name: 'id' })
  @ApiParam({ name: 'versionId' })
  @ApiResponse({ status: 200, type: ArchivePageDetailDto })
  restoreVersion(@Param('id') id: string, @Param('versionId') versionId: string, @User() user: AuthenticatedUser) {
    return this.service.restoreVersion(id, versionId, this.actorId(user));
  }

  /**
   * 개인 스페이스가 «누구의 것인지»를 이 값으로 가르므로, 없으면 요청을 진행시키면 안 된다.
   * 가드를 통과했는데 여기서 비는 건 토큰 모양이 바뀐 것이다.
   */
  private actorId(user: AuthenticatedUser): string {
    const id = user?.id ?? user?.userId ?? user?.sub;
    if (!id) throw new UnauthorizedError('사용자를 식별할 수 없습니다.');
    return id;
  }
}

function toSpace(value: string | undefined): ArchiveSpace {
  return value === 'private' ? 'private' : 'team';
}
