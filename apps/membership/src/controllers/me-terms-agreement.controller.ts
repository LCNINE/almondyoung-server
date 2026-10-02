import { Body, Controller, HttpCode, HttpStatus, Post, UseFilters, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, User } from '@app/authorization';
import { TermsAgreementService } from '../services/terms/terms-agreement.service';
import { SubscriptionExceptionFilter } from '../shared/filters/subscription-exception.filter';
import { ZodValidationPipe } from '../shared/pipes/zod-validation.pipe';
import { RecordTermsAgreementRequest, RecordTermsAgreementRequestSchema } from '../shared/schemas/requests';

/**
 * 가입 약관 동의 기록. 가입 폼을 제출한 순간 부른다 — 정기결제 첫 가입은 자동이체 등록으로 화면을
 * 떠났다가 돌아와 완성되므로, 가입 요청 안에서는 동의 값을 받을 수 없다. 돌려준 id 를 가입 요청이 들고 온다.
 *
 * 스코프는 JWT 의 userId 하나다 — 본문에 userId 를 받지 않는다.
 */
@ApiTags('membership-terms')
@Controller('me/membership-terms-agreements')
@UseFilters(SubscriptionExceptionFilter)
export class MeTermsAgreementController {
  constructor(private readonly termsAgreementService: TermsAgreementService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '멤버십 가입 약관 동의 기록' })
  @UseGuards(JwtAuthGuard)
  async record(
    @User('userId') userId: string,
    @Body(new ZodValidationPipe(RecordTermsAgreementRequestSchema)) body: RecordTermsAgreementRequest,
  ) {
    return this.termsAgreementService.record({ userId, ...body });
  }
}
