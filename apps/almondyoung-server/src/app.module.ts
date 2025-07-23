import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MovementModule } from './movement/movement.module';

@Module({
  imports: [MovementModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
