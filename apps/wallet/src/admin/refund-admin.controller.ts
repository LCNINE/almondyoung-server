import {
  Controller,
  Get,
  InternalServerErrorException,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentIntentAdminService } from './payment-intent-admin.service';
import { AdminRefundListQueryDto } from './dto';

@ApiTags('Admin - Refunds')
@Controller('v1/admin/refunds')
export class RefundAdminController {
  constructor(private readonly service: PaymentIntentAdminService) {}

  @Get()
  @ApiOperation({ summary: 'List refunds (admin, paginated)' })
  async list(@Query() query: AdminRefundListQueryDto) {
    try {
      return await this.service.listRefunds(query);
    } catch (e: any) {
      throw new InternalServerErrorException(e.message);
    }
  }
}
