import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public, RequireScopes, User } from '@app/authorization';
import { ApiOkResponsePaginated } from '@app/shared/decorators/api-paginated-response.decorator';
import { PaginatedResponseDto } from '@app/shared/dto';
import { LOGO_CONTEST_TOP_LIMIT } from '../constants/logo-contest.constants';
import {
  AdminLogoContestEntryListQueryDto,
  AdminLogoContestEntryResponseDto,
  CreateLogoContestEntryDto,
  LogoContestEntryListQueryDto,
  LogoContestEntryResponseDto,
  LogoContestStatusResponseDto,
  MyLogoContestStateResponseDto,
  UpdateLogoContestEntryStatusDto,
} from '../dto/logo-contest.dto';
import { AlreadySubmittedError } from '../errors/already-submitted.error';
import { LogoContestMapper } from '../mappers/logo-contest.mapper';
import { LogoContestPeriodService } from '../services/logo-contest-period.service';
import { LogoContestService } from '../services/logo-contest.service';

@ApiTags('Logo Contest')
@Controller('logo-contest')
export class LogoContestController {
  constructor(
    private readonly service: LogoContestService,
    private readonly period: LogoContestPeriodService,
  ) {}

  @Get('status')
  @Public()
  @ApiOperation({ summary: '공모전 기간·진행 상태' })
  @ApiResponse({ status: HttpStatus.OK, type: LogoContestStatusResponseDto })
  getStatus(): LogoContestStatusResponseDto {
    return {
      startsAt: this.period.startsAt.toISOString(),
      endsAt: this.period.endsAt.toISOString(),
      isOpen: this.period.isOpen(),
      isClosed: this.period.isClosed(),
    };
  }

  // ─── 어드민 (와일드카드 `entries/:id` 보다 먼저 선언해야 한다) ───

  @Get('admin/entries')
  @RequireScopes('admin:ugc:read')
  @ApiOperation({ summary: '[관리자] 출품작 목록 (상태·검색·정렬)' })
  @ApiOkResponsePaginated(AdminLogoContestEntryResponseDto)
  async listForAdmin(
    @Query() query: AdminLogoContestEntryListQueryDto,
  ): Promise<PaginatedResponseDto<AdminLogoContestEntryResponseDto>> {
    const result = await this.service.listForAdmin(query);
    return { ...result, data: result.data.map((entry) => LogoContestMapper.toAdminResponse(entry)) };
  }

  @Patch('admin/entries/:id/status')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '[관리자] 출품작 숨김/공개. 숨기면 그 작품의 표가 지워진다' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminLogoContestEntryResponseDto })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLogoContestEntryStatusDto,
  ): Promise<AdminLogoContestEntryResponseDto> {
    return LogoContestMapper.toAdminResponse(await this.service.updateStatus(id, dto.status));
  }

  @Post('admin/entries/:id/winner')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '[관리자] 대상 지정. 기존 대상은 해제된다' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminLogoContestEntryResponseDto })
  @HttpCode(HttpStatus.OK)
  async designateWinner(@Param('id', ParseUUIDPipe) id: string): Promise<AdminLogoContestEntryResponseDto> {
    return LogoContestMapper.toAdminResponse(await this.service.designateWinner(id));
  }

  // ─── 고객 ───

  @Get('entries')
  @Public()
  @ApiOperation({ summary: '출품작 목록. 기본 최신순, `sort=popular` 는 득표순' })
  @ApiOkResponsePaginated(LogoContestEntryResponseDto)
  async list(@Query() query: LogoContestEntryListQueryDto): Promise<PaginatedResponseDto<LogoContestEntryResponseDto>> {
    const result = await this.service.listVisible(query);
    return { ...result, data: result.data.map((entry) => LogoContestMapper.toResponse(entry)) };
  }

  @Get('entries/top')
  @Public()
  @ApiOperation({ summary: `득표 상위 ${LOGO_CONTEST_TOP_LIMIT}개 (메인 섹션)` })
  @ApiResponse({ status: HttpStatus.OK, type: [LogoContestEntryResponseDto] })
  async listTop(): Promise<LogoContestEntryResponseDto[]> {
    const entries = await this.service.listTop();
    return entries.map((entry) => LogoContestMapper.toResponse(entry));
  }

  @Get('me')
  @ApiOperation({ summary: '내 출품작과 내가 던진 표' })
  @ApiResponse({ status: HttpStatus.OK, type: MyLogoContestStateResponseDto })
  async getMyState(@User('userId') userId: string): Promise<MyLogoContestStateResponseDto> {
    const { entry, votedEntryId } = await this.service.getMyState(userId);
    return { entry: entry ? LogoContestMapper.toResponse(entry) : null, votedEntryId };
  }

  @Get('entries/:id')
  @Public()
  @ApiOperation({ summary: '출품작 상세' })
  @ApiResponse({ status: HttpStatus.OK, type: LogoContestEntryResponseDto })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<LogoContestEntryResponseDto> {
    return LogoContestMapper.toResponse(await this.service.getVisible(id));
  }

  @Post('entries')
  @ApiOperation({ summary: '출품. 한 계정 한 번, 수정 없음' })
  @ApiResponse({ status: HttpStatus.CREATED, type: LogoContestEntryResponseDto })
  async create(
    @User('userId') userId: string,
    @Body() dto: CreateLogoContestEntryDto,
  ): Promise<LogoContestEntryResponseDto> {
    try {
      return LogoContestMapper.toResponse(await this.service.create(userId, dto));
    } catch (error) {
      if (error instanceof AlreadySubmittedError) {
        throw new ConflictException({ code: 'CONFLICT', message: error.message });
      }
      throw error;
    }
  }

  @Delete('entries/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '내 출품작 삭제. 받은 표도 같이 지워진다' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  async remove(@User('userId') userId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.service.remove(userId, id);
  }

  @Post('entries/:id/vote')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '투표. 한 계정 한 표, 다른 작품을 고르면 기존 표를 옮긴다' })
  @ApiResponse({ status: HttpStatus.CREATED, description: '투표 후 그 작품의 득표수' })
  async vote(@User('userId') userId: string, @Param('id', ParseUUIDPipe) id: string): Promise<{ voteCount: number }> {
    return this.service.vote(userId, id);
  }

  @Delete('entries/:id/vote')
  @ApiOperation({ summary: '내 투표 취소' })
  @ApiResponse({ status: HttpStatus.OK, description: '취소 후 그 작품의 득표수' })
  async unvote(@User('userId') userId: string, @Param('id', ParseUUIDPipe) id: string): Promise<{ voteCount: number }> {
    return this.service.unvote(userId, id);
  }
}
