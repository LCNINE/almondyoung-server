import { Injectable, OnModuleInit } from '@nestjs/common';
import { DbTx } from '../../schema/inventory.schema';
import { CreateWarehouseDto } from '../dto/create-warehouse.dto';
import { UpdateWarehouseDto } from '../dto/update-warehouse.dto';
import { WarehouseReader } from './warehouse.reader';
import { WarehouseManager } from './warehouse.manager';

@Injectable()
export class WarehouseService implements OnModuleInit {
  constructor(
    private readonly reader: WarehouseReader,
    private readonly manager: WarehouseManager,
  ) {}

  /** 창고는 만들지 않는다. 지금은 단일 DB 에서 한 번 — 테넌트가 여럿이면 테넌트마다 불러야 한다. */
  onModuleInit() {
    return this.manager.convergeSystemLocations();
  }

  findAll(tx?: DbTx) {
    return this.reader.findAll(tx);
  }

  findOne(id: string, tx?: DbTx) {
    return this.reader.findOne(id, tx);
  }

  getStockSummary(id: string) {
    return this.reader.getStockSummary(id);
  }

  /** 판매 창고 id. 자세한 의미는 WarehouseReader.getDefaultId 참고. */
  getDefaultId(tx?: DbTx): Promise<string> {
    return this.reader.getDefaultId(tx);
  }

  create(dto: CreateWarehouseDto, tx?: DbTx) {
    return this.manager.create(dto, tx);
  }

  update(id: string, dto: UpdateWarehouseDto, tx?: DbTx) {
    return this.manager.update(id, dto, tx);
  }

  remove(id: string, tx?: DbTx) {
    return this.manager.remove(id, tx);
  }
}
