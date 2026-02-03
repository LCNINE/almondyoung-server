import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { Cafe24LinkController } from './cafe24-link.controller';
import { Cafe24LinkService } from './cafe24-link.service';

@Module({
  imports: [HttpModule],
  controllers: [Cafe24LinkController],
  providers: [Cafe24LinkService],
  exports: [Cafe24LinkService],
})
export class Cafe24LinkModule {}
