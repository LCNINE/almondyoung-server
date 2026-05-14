import { Injectable } from '@nestjs/common';
import { DbTx } from '../../schema/inventory.schema';
import { CreateSkuGroupDto, UpdateSkuGroupDto } from '../dto/create-sku-group.dto';
import { AddSkuToGroupDto, BulkAddSkusToGroupDto } from '../dto/manage-group-members.dto';
import { SkuGroupReader } from './sku-group.reader';
import { SkuGroupManager } from './sku-group.manager';

@Injectable()
export class SkuGroupService {
  constructor(
    private readonly reader: SkuGroupReader,
    private readonly manager: SkuGroupManager,
  ) {}

  getById(groupId: string, tx?: DbTx) {
    return this.reader.getById(groupId, tx);
  }

  list(tx?: DbTx) {
    return this.reader.list(tx);
  }

  getMembers(groupId: string, tx?: DbTx) {
    return this.reader.getMembers(groupId, tx);
  }

  getUngroupedSkus(limit?: number, offset?: number, tx?: DbTx) {
    return this.reader.getUngroupedSkus(limit, offset, tx);
  }

  create(dto: CreateSkuGroupDto, tx?: DbTx) {
    return this.manager.create(dto, tx);
  }

  update(groupId: string, dto: UpdateSkuGroupDto, tx?: DbTx) {
    return this.manager.update(groupId, dto, tx);
  }

  remove(groupId: string, tx?: DbTx) {
    return this.manager.remove(groupId, tx);
  }

  addSku(groupId: string, dto: AddSkuToGroupDto, tx?: DbTx) {
    return this.manager.addSku(groupId, dto, tx);
  }

  bulkAddSkus(groupId: string, dto: BulkAddSkusToGroupDto, tx?: DbTx) {
    return this.manager.bulkAddSkus(groupId, dto, tx);
  }

  removeSku(skuId: string, tx?: DbTx) {
    return this.manager.removeSku(skuId, tx);
  }
}
