import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import { JwtPayload } from '@app/authorization';
import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SendEmailCodeDto, VerifyEmailCodeDto } from './dto/email-verification.dto';
import { IdentityVerificationService } from './services/identity-verification.service';
import { SendEmailCodeService } from './services/send-email-code.service';
import { VerifyEmailCodeService } from './services/verify-email-code.service';

@ApiTags('email-verification')
@Controller('email-verification')
export class EmailVerificationController {
  constructor(
    private readonly sendEmailCodeService: SendEmailCodeService,
    private readonly verifyEmailCodeService: VerifyEmailCodeService,
    private readonly identityVerificationService: IdentityVerificationService,
  ) {}

  @ApiOperation({ summary: '이메일로 인증 코드(OTP) 발송 — 본인 이메일로만' })
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 3 } }) // 1분에 3번만 발송
  @Post('send-code')
  send(@CurrentUser() user: JwtPayload, @Body() dto: SendEmailCodeDto) {
    return this.sendEmailCodeService.sendCode(user.id, dto);
  }

  @ApiOperation({ summary: '이메일 인증 코드 검증' })
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('verify-code')
  verify(@CurrentUser() user: JwtPayload, @Body() dto: VerifyEmailCodeDto) {
    return this.verifyEmailCodeService.verifyCode(user.id, dto);
  }

  @ApiOperation({ summary: '최근 본인확인(코드 인증) 통과 여부 — 민감 화면 서버 가드용' })
  @Get('identity-status')
  async identityStatus(@CurrentUser() user: JwtPayload, @Query('purpose') purpose?: string) {
    const scoped = purpose === 'phone_verify' ? 'phone_verify' : 'password_change';
    const verified = await this.identityVerificationService.isVerified(user.id, scoped);
    return { verified };
  }
}
