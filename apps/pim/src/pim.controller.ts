import { Controller, Get } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { PimHealthResponseDto } from './common/dto';

@ApiTags('PIM Health')
@Controller()
export class PimController {
  @Get('health')
  @ApiOperation({ summary: 'PIM \uc11c\ube44\uc2a4 \ud5ec\uc2a4\uccb4\ud06c', description: 'PIM \uc11c\ube44\uc2a4\uc758 \uc0c1\ud0dc\ub97c \ud655\uc778\ud569\ub2c8\ub2e4.' })
  @ApiResponse({
    status: 200,
    description: 'PIM 서비스 정상 작동',
    type: PimHealthResponseDto,
  })
  getHealthCheck(): PimHealthResponseDto {
    return {
      status: 'ok',
      service: 'PIM (Product Information Management)'
    };
  }
}
