import { Module } from '@nestjs/common';
import { TokensService } from './tokens.service';

@Module({
  imports: [],
  providers: [TokensService],
  exports: [TokensService],
})
export class TokensModule {}
