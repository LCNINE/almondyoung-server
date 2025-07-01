import { Module } from '@nestjs/common';
import { PaymsController } from './payms.controller';
import { PaymsService } from './payms.service';
import { PaymentMethodModule } from './payment-method/payment-method.module';
import { SharedModule } from '@app/shared';
import { DbModule } from '@app/db';
import * as paymentMethodSchema from './payment-method/schema';

@Module({
  imports: [
    SharedModule,
    DbModule.forRoot({
      config: {
        connectionString:
          process.env.DATABASE_URL ||
          'postgresql://payms_owner:npg_8KxncIF7qoyH@ep-fancy-bonus-a1iiaieh-pooler.ap-southeast-1.aws.neon.tech/payms?sslmode=require&channel_binding=require',
      },
      schema: paymentMethodSchema,
    }),
    PaymentMethodModule,
  ],
  controllers: [PaymsController],
  providers: [PaymsService],
})
export class PaymsModule {}
