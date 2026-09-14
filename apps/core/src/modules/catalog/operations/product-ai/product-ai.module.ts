import { Module } from '@nestjs/common';
import { ProductAiController } from './controllers/product-ai.controller';
import { ProductAiService } from './services/product-ai.service';
import { ProductAiProvider } from './providers/product-ai.provider';
import { ProductAiReplyService } from './services/product-ai.reply.service';

@Module({ controllers: [ProductAiController], providers: [ProductAiService, ProductAiProvider, ProductAiReplyService] })
export class ProductAiModule {}
