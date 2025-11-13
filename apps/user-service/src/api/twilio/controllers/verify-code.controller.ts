import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { Public } from 'apps/user-service/src/commons/decorator/public.decorator';
import { VerifyCodeDto } from '../dto/verify-code.dto';
import { VerifyCodeService } from '../services/verify-code.service';

@ApiTags('Twilio - 인증 확인')
@Controller('twilio/verify-code')
export class VerifyCodeController {
  constructor(private readonly verifyCodeService: VerifyCodeService) {}

  @Post()
  @Public()
  @ApiOperation({
    summary: '인증 코드 검증',
    description: '사용자가 입력한 인증 코드를 검증합니다.',
  })
  @ApiBody({ type: VerifyCodeDto })
  @ApiResponse({
    status: 201,
    description: '인증 코드가 성공적으로 검증되었습니다.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '인증이 완료되었습니다.' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 (인증번호 불일치, 만료된 인증번호 등)',
  })
  @ApiResponse({
    status: 404,
    description: '인증번호를 찾을 수 없습니다.',
  })
  @ApiResponse({
    status: 500,
    description: '서버 오류',
  })
  async verifyCode(@Body() verifyCodeDto: VerifyCodeDto) {
    return this.verifyCodeService.verifyCode(verifyCodeDto);
  }
}
