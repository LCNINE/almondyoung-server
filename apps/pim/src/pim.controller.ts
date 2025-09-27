import { Controller, Get } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';

@ApiTags('PIM Health')
@Controller()
export class PimController {
  @Get('health')
  @ApiOperation({ summary: 'PIM \uc11c\ube44\uc2a4 \ud5ec\uc2a4\uccb4\ud06c', description: 'PIM \uc11c\ube44\uc2a4\uc758 \uc0c1\ud0dc\ub97c \ud655\uc778\ud569\ub2c8\ub2e4.' })
  @ApiResponse({
    status: 200,
    description: 'PIM \uc11c\ube44\uc2a4 \uc815\uc0c1 \uc791\ub3d9',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        service: { type: 'string', example: 'PIM (Product Information Management)' }
      }
    }
  })
  getHealthCheck(): { status: string; service: string } {
    return {
      status: 'ok',
      service: 'PIM (Product Information Management)'
    };
  }
}
