import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Public } from '../../commons/decorator/public.decorator';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import { JwtPayload } from '@app/roles';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Cafe24LinkService } from './cafe24-link.service';
import {
  IssueCafe24LinkTokenDto,
  IssueCafe24LinkTokenResponseDto,
} from './dto/issue-link-token.dto';
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

  @Post('link-token')
  @Public()
  @ApiOperation({
    summary: 'Cafe24 링크 토큰 발급',
    description: '암호화 id 토큰을 cafe24_link_token으로 교환합니다.',
  })
  @ApiBody({ type: IssueCafe24LinkTokenDto })
  @ApiResponse({
    status: 201,
    description: '토큰 발급 성공',
    type: IssueCafe24LinkTokenResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  async issueLinkToken(
    @Body() body: IssueCafe24LinkTokenDto & { encrypted_id_token?: string; mall_id?: string },
    @Req() req: any,
  ): Promise<IssueCafe24LinkTokenResponseDto> {
    const encryptedIdToken =
      body.encryptedIdToken ?? body.encrypted_id_token;
    const mallId = body.mallId ?? body.mall_id;

    if (!encryptedIdToken) {
      throw new BadRequestException('암호화 id 토큰이 필요합니다.');
    }

    const result = await this.cafe24LinkService.issueCafe24LinkToken(
      encryptedIdToken,
      mallId,
      {
        ip: req?.ip,
        userAgent: req?.headers?.['user-agent'],
      },
    );

    return {
      cafe24LinkToken: result.cafe24LinkToken,
      expiresAt: result.expiresAt.toISOString(),
    };
  }

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
    return this.cafe24LinkService.fetchMemberInfo(body.encryptedIdToken);
  }

  @Post('link')
  @ApiOperation({
    summary: 'Cafe24 계정 연결',
    description: 'cafe24_link_token으로 계정을 연결합니다.',
  })
  @ApiBody({ type: Cafe24LinkRequestDto })
  @ApiResponse({
    status: 200,
    description: '연결 성공',
    type: Cafe24LinkResponseDto,
  })
  async linkCafe24Account(
    @Body() body: Cafe24LinkRequestDto & { cafe24_link_token?: string },
    @CurrentUser() user: JwtPayload,
  ): Promise<Cafe24LinkResponseDto> {
    const cafe24LinkToken =
      body.cafe24LinkToken ?? body.cafe24_link_token;

    if (!cafe24LinkToken) {
      throw new BadRequestException('cafe24_link_token이 필요합니다.');
    }

    const link = await this.cafe24LinkService.linkCafe24Account(
      user.id,
      cafe24LinkToken,
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
}
