import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateAlmondyoungEnv } from './config/env.validation';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateAlmondyoungEnv,
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
