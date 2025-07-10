import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CreatePaymentMethodDto,
  UpdatePaymentMethodDto,
} from './dto/create-payment-method.dto';
import {
  PaymentMethodService,
  PaymentMethodWithDetails,
} from './payment-method.service';

@Controller('payment-methods')
export class PaymentMethodController {
  constructor(private readonly paymentMethodService: PaymentMethodService) {}

  @Post()
  createPaymentMethod(@Body() dto: CreatePaymentMethodDto): Promise<unknown> {
    return this.paymentMethodService.createPaymentMethod(dto);
  }

  @Get()
  async getPaymentMethodsByUserId(
    @Query('userId') userId: number,
  ): Promise<PaymentMethodWithDetails[]> {
    return this.paymentMethodService.findByUserId(userId);
  }

  @Get(':id')
  async getPaymentMethod(
    @Param('id') id: string,
  ): Promise<PaymentMethodWithDetails | null> {
    return this.paymentMethodService.findById(id);
  }

  @Patch(':id')
  async updatePaymentMethod(
    @Param('id') id: string,
    @Body() updates: UpdatePaymentMethodDto,
  ) {
    return this.paymentMethodService.update(id, updates);
  }

  @Delete(':id')
  async deletePaymentMethod(@Param('id') id: string) {
    return this.paymentMethodService.delete(id);
  }
}
