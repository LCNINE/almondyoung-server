import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { Public } from 'apps/user-service/src/commons/decorator/public.decorator';
import { LookupDto } from '../dto/twilio.dto';
import { LookupResponseDto } from '../dto/lookup.response.dto';
import { LookupService } from '../services/lookup.service';

@ApiTags('Twilio - 전화번호 조회')
@Controller('twilio/lookup')
export class LookupController {
  constructor(private readonly lookupService: LookupService) {}

  @Post()
  @Public()
  @ApiOperation({
    summary: '전화번호 유효성 검증',
    description: 'Twilio Lookup API를 사용하여 전화번호의 유효성을 검증합니다.',
  })
  @ApiBody({ type: LookupDto })
  @ApiResponse({
    status: 201,
    description: '전화번호 조회 결과',
    type: LookupResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 (유효하지 않은 전화번호 형식)',
  })
  @ApiResponse({
    status: 500,
    description: '서버 오류',
  })
  async lookup(@Body() lookupDto: LookupDto) {
    return this.lookupService.lookup(lookupDto);
  }
}
