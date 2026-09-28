import { Injectable } from '@nestjs/common';
import { DbTx } from '../../schema/inventory.schema';
import { CreateDeliveryProfileDto } from '../dto/create-delivery-profile.dto';
import { UpdateDeliveryProfileDto } from '../dto/update-delivery-profile.dto';
import { DeliveryProfileReader } from './delivery-profile.reader';
import { DeliveryProfileManager } from './delivery-profile.manager';

@Injectable()
export class DeliveryProfileService {
  constructor(
    private readonly reader: DeliveryProfileReader,
    private readonly manager: DeliveryProfileManager,
  ) {}

  findAll(tx?: DbTx) {
    return this.reader.findAll(tx);
  }

  findOne(id: string, tx?: DbTx) {
    return this.reader.findOne(id, tx);
  }

  create(dto: CreateDeliveryProfileDto, tx?: DbTx) {
    return this.manager.create(dto, tx);
  }

  update(id: string, dto: UpdateDeliveryProfileDto, tx?: DbTx) {
    return this.manager.update(id, dto, tx);
  }
}
