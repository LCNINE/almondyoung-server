import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { Cafe24TokensService } from './cafe24-tokens.service';

@Module({
  imports: [HttpModule],
  providers: [Cafe24TokensService],
  exports: [Cafe24TokensService],
})
export class Cafe24Module {}
