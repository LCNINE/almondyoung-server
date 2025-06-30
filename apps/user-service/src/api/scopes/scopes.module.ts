import { Module } from '@nestjs/common';
import { ScopesService } from './scopes.service';
import { ScopesController } from './scopes.controller';

@Module({
  controllers: [ScopesController],
  providers: [ScopesService],
})
export class ScopesModule {}
