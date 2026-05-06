import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@app/db';
import { notificationTables } from '../../database/schemas/notification-schema';
import { DeviceController } from './controllers/device.controller';
import { DeviceService } from './services/device.service';
import { JwtUserGuard } from './guards/jwt-user.guard';

@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}),
    DbModule.forRoot({
      config: { connectionString: process.env.DATABASE_URL ?? '' },
      schema: notificationTables,
    }),
  ],
  controllers: [DeviceController],
  providers: [DeviceService, JwtUserGuard],
  exports: [DeviceService],
})
export class DeviceModule {}
