import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentMethodsService } from './payment-methods.service';
import { CreatePaymentMethodDto, PaymentMethodResponseDto } from './dto';

@ApiTags('Payment Methods')
@Controller('v1/payment-methods')
export class PaymentMethodsController {
  constructor(private readonly service: PaymentMethodsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Register a payment method' })
  async create(
    @Body() dto: CreatePaymentMethodDto,
  ): Promise<PaymentMethodResponseDto> {
    const method = await this.service.create(dto);
    return {
      id: method.id,
      customerId: method.customerId,
      type: method.type,
      displayName: method.displayName ?? null,
      isReusable: method.isReusable,
      createdAt: method.createdAt,
    };
  }

  @Get()
  @ApiOperation({ summary: 'List payment methods for a user' })
  async findAll(
    @Query('external_user_id') externalUserId: string,
  ): Promise<PaymentMethodResponseDto[]> {
    const methods = await this.service.findAllByExternalUserId(externalUserId);
    return methods.map((m) => ({
      id: m.id,
      customerId: m.customerId,
      type: m.type,
      displayName: m.displayName ?? null,
      isReusable: m.isReusable,
      createdAt: m.createdAt,
    }));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a payment method' })
  async delete(@Param('id') id: string): Promise<void> {
    await this.service.delete(id);
  }
}
