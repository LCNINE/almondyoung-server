import {
  Controller,
  Post,
  Delete,
  Get,
  Patch,
  Param,
  Body,
} from '@nestjs/common';
import { PaymentMethodService } from './payment-method.service';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';

@Controller('payment-methods')
export class PaymentMethodController {
  constructor(private readonly paymentMethodService: PaymentMethodService) {}
  // 결제수단 등록
  @Post()
  createPaymentMethod(@Body() dto: any) {
    // methodType 기반으로 적절한 DTO 타입으로 변환
    const typedDto: CreatePaymentMethodDto = {
      ...dto,
      methodType: dto.methodType || 'CARD', // 기본값 설정
    };

    return this.paymentMethodService.createPaymentMethod(typedDto);
  }

  // 결제수단 삭제
  @Delete(':id')
  deletePaymentMethod(@Param('id') id: string) {
    return this.paymentMethodService.deleteById(id);
  }

  // 결제수단 목록 조회 (사용자별)
  @Get('user/:userId')
  getPaymentMethods(@Param('userId') userId: string) {
    return this.paymentMethodService.findByUserId(parseInt(userId));
  }

  // 결제수단 상세 조회
  @Get(':id')
  getPaymentMethod(@Param('id') id: string) {
    return this.paymentMethodService.findById(id);
  }

  // 기본 결제수단 설정
  @Patch(':id/default')
  setDefaultPaymentMethod(
    @Param('id') id: string,
    @Body() body: { userId: number },
  ) {
    return this.paymentMethodService.setAsDefault(id, body.userId);
  }

  // (내부) PG사 빌링키 발급
  @Post('/pg/billing-key')
  createBillingKey(@Body() _body: any) {
    // TODO: PG사 빌링키 발급 로직
    return 'PG사 빌링키 발급';
  }

  // (내부) PG사 빌링키 해지
  @Delete('/pg/billing-key/:id')
  deleteBillingKey(@Param('id') id: string) {
    // TODO: PG사 빌링키 해지 로직
    return `PG사 빌링키 해지: ${id}`;
  }
}
