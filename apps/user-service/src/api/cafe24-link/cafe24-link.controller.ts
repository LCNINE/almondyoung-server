import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Public } from '../../commons/decorator/public.decorator';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import { JwtPayload } from '@app/authorization';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Cafe24LinkService } from './cafe24-link.service';
import {
  Cafe24MemberInfoRequestDto,
  Cafe24MemberInfoResponseDto,
} from './dto/member-info.dto';
import {
  Cafe24MigrationItemDto,
  Cafe24MigrationListResponseDto,
} from './dto/migration.dto';
import {
  Cafe24LinkRequestDto,
  Cafe24LinkResponseDto,
} from './dto/link.dto';

@ApiTags('Cafe24 Link')
@ApiBearerAuth('access-token')
@Controller('cafe24')
export class Cafe24LinkController {
  constructor(private readonly cafe24LinkService: Cafe24LinkService) { }

  @Post('member-info')
  @Public()
  @ApiOperation({
    summary: 'Cafe24 회원 정보 조회',
    description: '암호화 id 토큰으로 Cafe24 회원 정보를 조회합니다.',
  })
  @ApiBody({ type: Cafe24MemberInfoRequestDto })
  @ApiResponse({
    status: 200,
    description: '회원 정보 조회 성공',
    type: Cafe24MemberInfoResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  async getMemberInfo(
    @Body()
    body: Cafe24MemberInfoRequestDto,
  ): Promise<Cafe24MemberInfoResponseDto> {
    return this.cafe24LinkService.fetchMemberInfo(
      body.encryptedIdToken,
    );
  }

  @Post('link')
  @ApiOperation({
    summary: 'Cafe24 계정 연결',
    description: '암호화 id 토큰으로 계정을 연결합니다.',
  })
  @ApiBody({ type: Cafe24LinkRequestDto })
  @ApiResponse({
    status: 200,
    description: '연결 성공',
    type: Cafe24LinkResponseDto,
  })
  async linkCafe24Account(
    @Body() body: Cafe24LinkRequestDto & { encrypted_id_token?: string },
    @CurrentUser() user: JwtPayload,
  ): Promise<Cafe24LinkResponseDto> {
    const encryptedIdToken =
      body.encryptedIdToken ?? body.encrypted_id_token;

    if (!encryptedIdToken) {
      throw new BadRequestException('암호화 id 토큰이 필요합니다.');
    }

    const link = await this.cafe24LinkService.linkCafe24Account(
      user.id,
      encryptedIdToken,
    );

    return {
      linkId: link.id,
      mallId: link.mallId,
      cafe24MemberId: link.cafe24MemberId,
      linkedAt: link.linkedAt.toISOString(),
    };
  }

  @Get('link')
  @ApiOperation({
    summary: 'Cafe24 연결 정보 조회',
    description: '현재 로그인한 사용자의 Cafe24 연결 정보를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '연결 정보 조회 성공',
    type: Cafe24LinkResponseDto,
  })
  async getLinkedCafe24Account(
    @CurrentUser() user: JwtPayload,
  ): Promise<Cafe24LinkResponseDto | null> {
    const link = await this.cafe24LinkService.getLinkedCafe24Account(user.id);
    if (!link) {
      return null;
    }

    return {
      linkId: link.id,
      mallId: link.mallId,
      cafe24MemberId: link.cafe24MemberId,
      linkedAt: link.linkedAt.toISOString(),
    };
  }

  @Post('unlink')
  @ApiOperation({
    summary: 'Cafe24 계정 연결 해제',
    description: '연결된 Cafe24 계정을 해제합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '연결 해제 성공',
    type: Cafe24LinkResponseDto,
  })
  async unlinkCafe24Account(
    @CurrentUser() user: JwtPayload,
  ): Promise<Cafe24LinkResponseDto> {
    const link = await this.cafe24LinkService.unlinkCafe24Account(user.id);

    return {
      linkId: link.id,
      mallId: link.mallId,
      cafe24MemberId: link.cafe24MemberId,
      linkedAt: link.linkedAt.toISOString(),
    };
  }

  @Get('migration')
  @ApiOperation({
    summary: 'Cafe24 이관 항목 전체 조회',
    description: '이관 항목 전체 lookup 결과를 반환합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '이관 항목 조회 성공',
    type: Cafe24MigrationListResponseDto,
  })
  async getMigrationItems(
    @CurrentUser() user: JwtPayload,
  ): Promise<Cafe24MigrationListResponseDto> {
    const items = await this.cafe24LinkService.getMigrationItems(user.id);
    return { items };
  }

  @Get('migration/:key')
  @ApiOperation({
    summary: 'Cafe24 이관 항목 단건 조회',
    description: '단일 이관 항목 lookup 결과를 반환합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '이관 항목 조회 성공',
    type: Cafe24MigrationItemDto,
  })
  async getMigrationItem(
    @Param('key') key: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<Cafe24MigrationItemDto> {
    this.assertMigrationKey(key);
    return this.cafe24LinkService.lookupMigrationItem(
      user.id,
      key as any,
    );
  }

  @Post('migration/:key')
  @ApiOperation({
    summary: 'Cafe24 이관 항목 단건 이관',
    description: '단일 이관 항목을 이관합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '이관 완료',
    type: Cafe24MigrationItemDto,
  })
  async migrateMigrationItem(
    @Param('key') key: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<Cafe24MigrationItemDto> {
    this.assertMigrationKey(key);
    return this.cafe24LinkService.migrateItem(user.id, key as any);
  }

  private assertMigrationKey(key: string) {
    const allowed = ['email', 'name', 'birthday', 'phone'];
    if (!allowed.includes(key)) {
      throw new BadRequestException('지원하지 않는 이관 항목입니다.');
    }
  }

  // ===== Internal Endpoints (channel-adapter 전용) =====

  @Get('internal/link-info')
  @Public()
  @ApiOperation({
    summary: '[Internal] Cafe24 회원 ID로 링크 정보 조회',
    description: 'mallId와 cafe24MemberId로 userId와 email을 조회합니다.',
  })
  async getLinkInfo(
    @Query('mallId') mallId: string,
    @Query('cafe24MemberId') cafe24MemberId: string,
  ): Promise<{ userId: string; email: string }> {
    if (!mallId || !cafe24MemberId) {
      throw new BadRequestException('mallId와 cafe24MemberId가 필요합니다.');
    }
    const result = await this.cafe24LinkService.getLinkInfoByCafe24MemberId(mallId, cafe24MemberId);
    if (!result) {
      throw new NotFoundException('연결된 계정을 찾을 수 없습니다.');
    }
    return { userId: result.userId, email: result.email };
  }

  @Get('internal/links')
  @Public()
  @ApiOperation({
    summary: '[Internal] mallId 기준 전체 연동 목록 조회',
    description: '활성 연동 전체 목록을 반환합니다.',
  })
  async getAllLinks(
    @Query('mallId') mallId: string,
  ): Promise<Array<{ userId: string; cafe24MemberId: string; email: string }>> {
    if (!mallId) {
      throw new BadRequestException('mallId가 필요합니다.');
    }
    return this.cafe24LinkService.getAllLinksByMallId(mallId);
  }
}
