import { Body, Controller, Post } from '@nestjs/common';
import { Public } from 'apps/user-service/src/commons/decorator/public.decorator';
import { LookupDto } from '../dto/twilio.dto';
import { LookupService } from '../services/lookup.service';

/**
 * 핸드폰 번호 조회 컨트롤러
 */
@Controller('twilio/lookup')
export class LookupController {
  constructor(private readonly lookupService: LookupService) {}

  @Post()
  @Public()
  async lookup(@Body() lookupDto: LookupDto) {
    return this.lookupService.lookup(lookupDto);
  }
}
