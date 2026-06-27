import { Controller, Get, Post, Put, Delete, Body, Param, Query, HttpStatus, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
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
} from './dto';
import { TagGroupWithValues, TagMapper } from './mappers';
import { DbService, InjectDb } from '@app/db';
import { type PimSchema } from '../../schema/catalog.schema';
import { TagValueWithGroupNameDto } from './dto/tag-value-with-group-name.dto';

@ApiTags('Tags')
@Controller('tags')
export class TagsController {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly tagsService: TagsService,
  ) {}

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
  async createTagGroup(@Body() dto: CreateTagGroupDto): Promise<TagGroupResponseDto> {
    const tagGroup = await this.tagsService.createTagGroup(dto);
    return TagMapper.toGroupDto(tagGroup);
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
  async listTagGroups(@Query() query: TagGroupQueryDto): Promise<TagGroupResponseDto[]> {
    const filters = query.isActive !== undefined ? { isActive: query.isActive } : undefined;
    const tagGroups = await this.tagsService.listTagGroups(filters);
    return tagGroups.map(TagMapper.toGroupDto);
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
    const tagGroup = await this.tagsService.getTagGroup(id);
    return TagMapper.toGroupDto(tagGroup);
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
  async updateTagGroup(@Param('id') id: string, @Body() dto: UpdateTagGroupDto): Promise<TagGroupResponseDto> {
    return await this.db.run(async (tx) => {
      await this.tagsService.updateTagGroup(id, dto, tx);
      const tagGroup = await this.tagsService.getTagGroup(id, tx);
      return TagMapper.toGroupDto(tagGroup);
    });
  }

  @Delete('groups/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '태그 그룹 삭제',
    description: '특정 태그 그룹을 삭제합니다. 태그 값이 있는 경우 삭제할 수 없습니다.',
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
    type: TagValueWithGroupNameDto,
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
  ): Promise<TagValueWithGroupNameDto> {
    const dto: CreateTagValueDto = { ...body, groupId };
    return await this.db.run(async (tx) => {
      const tagValue = await this.tagsService.createTagValue(dto, tx);
      const tagGroup = await this.tagsService.getTagGroup(tagValue.groupId, tx);
      return TagMapper.toValueWithGroupDto({ ...tagValue, group: tagGroup });
    });
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
    type: TagValueWithGroupNameDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: '태그 값을 찾을 수 없음',
  })
  async getTagValue(@Param('id') id: string): Promise<TagValueWithGroupNameDto> {
    return await this.db.run(async (tx) => {
      const tagValue = await this.tagsService.getTagValue(id, tx);
      const tagGroup = await this.tagsService.getTagGroup(tagValue.groupId, tx);
      return TagMapper.toValueWithGroupDto({ ...tagValue, group: tagGroup });
    });
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
    type: TagValueWithGroupNameDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: '태그 값을 찾을 수 없음',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: '중복된 태그 값',
  })
  async updateTagValue(@Param('id') id: string, @Body() dto: UpdateTagValueDto): Promise<TagValueWithGroupNameDto> {
    return await this.db.run(async (tx) => {
      await this.tagsService.updateTagValue(id, dto, tx);
      const tagValue = await this.tagsService.getTagValue(id, tx);
      const tagGroup = await this.tagsService.getTagGroup(tagValue.groupId, tx);
      return TagMapper.toValueWithGroupDto({ ...tagValue, group: tagGroup });
    });
  }

  @Delete('values/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
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
