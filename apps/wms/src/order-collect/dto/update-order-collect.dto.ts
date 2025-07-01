import { PartialType } from '@nestjs/mapped-types';
import { CreateOrderCollectDto } from './create-order-collect.dto';

export class UpdateOrderCollectDto extends PartialType(CreateOrderCollectDto) {}
