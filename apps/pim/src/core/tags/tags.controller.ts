import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { TagsService } from './tags.service';
import {
  CreateTagGroupDto,
  UpdateTagGroupDto,
  TagGroupResponseDto,
  TagGroupDetailResponseDto,
  TagGroupQueryDto,
  CreateTagValueDto,
  CreateTagValueBodyDto,
  UpdateTagValueDto,
  TagValueResponseDto,
} from './dto';

@ApiTags('Tags')
@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  // ===== TAG GROUPS =====

  @Post('groups')
  @ApiOperation({
    summary: '태그 그룹 생성',
    description: '새로운 태그 그룹을 생성합니다.',
  })
  @ApiBody({ type: CreateTagGroupDto, description: '태그 그룹 생성 정보' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: '태그 그룹 생성 성공',
    type: TagGroupResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: '잘못된 요청',
  })
  async createTagGroup(
    @Body() dto: CreateTagGroupDto,
  ): Promise<TagGroupResponseDto> {
    return this.tagsService.createTagGroup(dto);
  }

  @Get('groups')
  @ApiOperation({
    summary: '태그 그룹 목록 조회',
    description: '모든 태그 그룹을 조회합니다. 필터링 옵션을 지원합니다.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '태그 그룹 목록 조회 성공',
    type: [TagGroupResponseDto],
  })
  async listTagGroups(
    @Query() query: TagGroupQueryDto,
  ): Promise<TagGroupResponseDto[]> {
    const filters = query.isActive !== undefined ? { isActive: query.isActive } : undefined;
    return this.tagsService.listTagGroups(filters);
  }

  @Get('groups/:id')
  @ApiOperation({
    summary: '태그 그룹 단일 조회',
    description: '특정 태그 그룹의 정보를 조회합니다. 태그 값 개수를 포함합니다.',
  })
  @ApiParam({
    name: 'id',
    description: '태그 그룹 ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '태그 그룹 조회 성공',
    type: TagGroupResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: '태그 그룹을 찾을 수 없음',
  })
  async getTagGroup(@Param('id') id: string): Promise<TagGroupResponseDto> {
    return this.tagsService.getTagGroup(id);
  }

  @Get('groups/:id/detail')
  @ApiOperation({
    summary: '태그 그룹 상세 조회 (값 포함)',
    description:
      '특정 태그 그룹의 정보와 모든 태그 값을 함께 조회합니다.',
  })
  @ApiParam({
    name: 'id',
    description: '태그 그룹 ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '태그 그룹 상세 조회 성공',
    type: TagGroupDetailResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: '태그 그룹을 찾을 수 없음',
  })
  async getTagGroupWithValues(
    @Param('id') id: string,
  ): Promise<TagGroupDetailResponseDto> {
    return this.tagsService.getTagGroupWithValues(id);
  }

  @Put('groups/:id')
  @ApiOperation({
    summary: '태그 그룹 수정',
    description: '특정 태그 그룹의 정보를 수정합니다.',
  })
  @ApiParam({
    name: 'id',
    description: '태그 그룹 ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({ type: UpdateTagGroupDto, description: '태그 그룹 수정 정보' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '태그 그룹 수정 성공',
    type: TagGroupResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: '태그 그룹을 찾을 수 없음',
  })
  async updateTagGroup(
    @Param('id') id: string,
    @Body() dto: UpdateTagGroupDto,
  ): Promise<TagGroupResponseDto> {
    return this.tagsService.updateTagGroup(id, dto);
  }

  @Delete('groups/:id')
  @ApiOperation({
    summary: '태그 그룹 삭제',
    description:
      '특정 태그 그룹을 삭제합니다. 태그 값이 있는 경우 삭제할 수 없습니다.',
  })
  @ApiParam({
    name: 'id',
    description: '태그 그룹 ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: '태그 그룹 삭제 성공',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: '태그 그룹을 찾을 수 없음',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: '태그 값이 있어 삭제할 수 없음',
  })
  async deleteTagGroup(@Param('id') id: string): Promise<void> {
    return this.tagsService.deleteTagGroup(id);
  }

  // ===== TAG VALUES =====

  @Post('groups/:groupId/values')
  @ApiOperation({
    summary: '태그 값 생성',
    description: '특정 태그 그룹에 새로운 태그 값을 생성합니다.',
  })
  @ApiParam({
    name: 'groupId',
    description: '태그 그룹 ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({ type: CreateTagValueBodyDto, description: '태그 값 생성 정보' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: '태그 값 생성 성공',
    type: TagValueResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: '잘못된 요청 또는 중복된 태그 값',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: '태그 그룹을 찾을 수 없음',
  })
  async createTagValue(
    @Param('groupId') groupId: string,
    @Body() body: CreateTagValueBodyDto,
  ): Promise<TagValueResponseDto> {
    const dto: CreateTagValueDto = { ...body, groupId };
    return this.tagsService.createTagValue(dto);
  }

  @Get('groups/:groupId/values')
  @ApiOperation({
    summary: '태그 값 목록 조회',
    description: '특정 태그 그룹의 모든 태그 값을 조회합니다.',
  })
  @ApiParam({
    name: 'groupId',
    description: '태그 그룹 ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '태그 값 목록 조회 성공',
    type: [TagValueResponseDto],
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: '태그 그룹을 찾을 수 없음',
  })
  async listTagValuesByGroup(
    @Param('groupId') groupId: string,
  ): Promise<TagValueResponseDto[]> {
    return this.tagsService.listTagValuesByGroup(groupId);
  }

  @Get('values/:id')
  @ApiOperation({
    summary: '태그 값 단일 조회',
    description: '특정 태그 값의 정보를 조회합니다. 태그 그룹 이름을 포함합니다.',
  })
  @ApiParam({
    name: 'id',
    description: '태그 값 ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '태그 값 조회 성공',
    type: TagValueResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: '태그 값을 찾을 수 없음',
  })
  async getTagValue(@Param('id') id: string): Promise<TagValueResponseDto> {
    return this.tagsService.getTagValue(id);
  }

  @Put('values/:id')
  @ApiOperation({
    summary: '태그 값 수정',
    description: '특정 태그 값의 정보를 수정합니다.',
  })
  @ApiParam({
    name: 'id',
    description: '태그 값 ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({ type: UpdateTagValueDto, description: '태그 값 수정 정보' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '태그 값 수정 성공',
    type: TagValueResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: '태그 값을 찾을 수 없음',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: '중복된 태그 값',
  })
  async updateTagValue(
    @Param('id') id: string,
    @Body() dto: UpdateTagValueDto,
  ): Promise<TagValueResponseDto> {
    return this.tagsService.updateTagValue(id, dto);
  }

  @Delete('values/:id')
  @ApiOperation({
    summary: '태그 값 삭제',
    description: '특정 태그 값을 삭제합니다.',
  })
  @ApiParam({
    name: 'id',
    description: '태그 값 ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: '태그 값 삭제 성공',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: '태그 값을 찾을 수 없음',
  })
  async deleteTagValue(@Param('id') id: string): Promise<void> {
    return this.tagsService.deleteTagValue(id);
  }
}

