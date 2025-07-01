import { Injectable } from '@nestjs/common';
import { CreateOrderCollectDto } from './dto/create-order-collect.dto';
import { UpdateOrderCollectDto } from './dto/update-order-collect.dto';

@Injectable()
export class OrderCollectService {
  create(createOrderCollectDto: CreateOrderCollectDto) {
    return 'This action adds a new orderCollect';
  }

  findAll() {
    return `This action returns all orderCollect`;
  }

  findOne(id: number) {
    return `This action returns a #${id} orderCollect`;
  }

  update(id: number, updateOrderCollectDto: UpdateOrderCollectDto) {
    return `This action updates a #${id} orderCollect`;
  }

  remove(id: number) {
    return `This action removes a #${id} orderCollect`;
  }
}
