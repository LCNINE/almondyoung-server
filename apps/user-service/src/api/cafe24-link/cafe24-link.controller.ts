import { Public } from '../../commons/decorator/public.decorator';
import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
} from '@nestjs/common';
import {
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

@ApiTags('Cafe24 Link')
@Controller('cafe24')
export class Cafe24LinkController {
  constructor(private readonly cafe24LinkService: Cafe24LinkService) {}

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
}
