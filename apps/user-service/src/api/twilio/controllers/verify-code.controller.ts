import { Body, Controller, Post } from '@nestjs/common';
import { Public } from 'apps/user-service/src/commons/decorator/public.decorator';
import { VerifyCodeDto } from '../dto/verify-code.dto';
import { VerifyCodeService } from '../services/verify-code.service';

@Controller('twilio/verify-code')
export class VerifyCodeController {
  constructor(private readonly verifyCodeService: VerifyCodeService) {}

  @Post()
  @Public()
  async verifyCode(@Body() verifyCodeDto: VerifyCodeDto) {
    return this.verifyCodeService.verifyCode(verifyCodeDto);
  }
}
