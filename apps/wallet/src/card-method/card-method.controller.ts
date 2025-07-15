import {
  Controller,
  Post,
  Delete,
  Get,
  Patch,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { CardMethodService } from './card-method.service';
import { CreateCardMethodDto } from './dto/create-card-method.dto';

@Controller('card-method')
export class CardMethodController {
  constructor(private readonly cardMethodService: CardMethodService) {}

  @Post()
  async register(@Body() dto: CreateCardMethodDto) {
    return this.cardMethodService.register(dto);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.cardMethodService.delete(id);
  }

  @Get()
  async getList(@Query('userId') userId: number) {
    return this.cardMethodService.getList(userId);
  }

  @Patch(':id/default')
  async setDefault(@Param('id') id: string) {
    return this.cardMethodService.setDefault(id);
  }
}
