import { Module } from '@nestjs/common';
import { ProductAiController } from './product-ai.controller';
import { ProductAiService } from './product-ai.service';

@Module({ controllers: [ProductAiController], providers: [ProductAiService] })
export class ProductAiModule {}
