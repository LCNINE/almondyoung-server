// apps/wms/src/wms.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '@app/authorization';
import { WmsService } from './wms.service';

@ApiTags('WMS')
@Controller()
export class WmsController {
  constructor(private readonly wmsService: WmsService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'WMS \uc11c\ube44\uc2a4 \uc0c1\ud0dc \ud655\uc778',
    description:
      'WMS \uc11c\ube44\uc2a4\uc758 \uae30\ubcf8 \uc0c1\ud0dc\ub97c \ud655\uc778\ud569\ub2c8\ub2e4.',
  })
  @ApiResponse({
    status: 200,
    description: 'WMS \uc11c\ube44\uc2a4 \uc815\uc0c1 \uc791\ub3d9',
    schema: { type: 'string' },
  })
  getHello(): string {
    return this.wmsService.getHello();
  }
}
