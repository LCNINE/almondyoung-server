import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { OrderCollectService } from './order-collect.service';
import { CreateOrderCollectDto } from './dto/create-order-collect.dto';
import { UpdateOrderCollectDto } from './dto/update-order-collect.dto';

@Controller('order-collect')
export class OrderCollectController {
  constructor(private readonly orderCollectService: OrderCollectService) {}

  @Post()
  create(@Body() createOrderCollectDto: CreateOrderCollectDto) {
    return this.orderCollectService.create(createOrderCollectDto);
  }

  @Get()
  findAll() {
    return this.orderCollectService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.orderCollectService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateOrderCollectDto: UpdateOrderCollectDto) {
    return this.orderCollectService.update(+id, updateOrderCollectDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.orderCollectService.remove(+id);
  }
}
