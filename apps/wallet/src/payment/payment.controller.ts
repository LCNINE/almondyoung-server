import { Body, Controller, Get, Param, Post } from '@nestjs/common';

@Controller('payments')
export class PaymentController {
    @Get()
    async getPayments() {
            return 'Payments';
    }
    
    @Post()
    async createPayment(@Body() body: any) {
        return 'Payment';
  }


  @Get(':id')
  async getPayment(@Param('id') id: string) {
    return 'Payment';
  }

  @Post('refunds')
  async createRefund(@Body() body: any) {
    return 'Refund';
  }

  @Get('refunds/:id')
  async getRefund(@Param('id') id: string) {
    return 'Refund';
  }
}
