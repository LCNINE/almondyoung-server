import { Injectable } from '@nestjs/common';
import type {
  MinimumWage,
  PayGroup,
  PayPolicy,
  WageRate,
  WageWorker,
  WageWorkerDetail,
  WorkSchedule,
} from '@packages/domain-types/attendance-wage';
import type {
  CreateMinimumWageDto,
  CreatePayGroupDto,
  CreatePayPolicyDto,
  CreateWageRateDto,
  CreateWorkScheduleDto,
  SaveWorkerDto,
  UpdatePayGroupDto,
} from './dto/wage-settings.dto';
import { WageSettingsManager } from './wage-settings.manager';
import { WageSettingsReader } from './wage-settings.reader';

@Injectable()
export class WageSettingsService {
  constructor(
    private readonly reader: WageSettingsReader,
    private readonly manager: WageSettingsManager,
  ) {}

  groups(): Promise<PayGroup[]> {
    return this.reader.groups();
  }

  createGroup(actorId: string, dto: CreatePayGroupDto): Promise<PayGroup> {
    return this.manager.createGroup(actorId, dto);
  }

  updateGroup(actorId: string, id: string, dto: UpdatePayGroupDto): Promise<PayGroup> {
    return this.manager.updateGroup(actorId, id, dto);
  }

  policies(groupId: string): Promise<PayPolicy[]> {
    return this.reader.policies(groupId);
  }

  addPolicy(actorId: string, groupId: string, dto: CreatePayPolicyDto): Promise<PayPolicy> {
    return this.manager.addPolicy(actorId, groupId, dto);
  }

  workers(): Promise<WageWorker[]> {
    return this.reader.workers();
  }

  worker(userId: string): Promise<WageWorkerDetail> {
    return this.reader.workerDetail(userId);
  }

  async saveWorker(actorId: string, userId: string, dto: SaveWorkerDto): Promise<WageWorkerDetail> {
    await this.manager.saveWorker(actorId, userId, dto);

    return this.reader.workerDetail(userId);
  }

  addRate(actorId: string, userId: string, dto: CreateWageRateDto): Promise<WageRate> {
    return this.manager.addRate(actorId, userId, dto);
  }

  addSchedule(actorId: string, userId: string, dto: CreateWorkScheduleDto): Promise<WorkSchedule> {
    return this.manager.addSchedule(actorId, userId, dto);
  }

  minimumWages(): Promise<MinimumWage[]> {
    return this.reader.minimumWages();
  }

  addMinimumWage(actorId: string, dto: CreateMinimumWageDto): Promise<MinimumWage> {
    return this.manager.addMinimumWage(actorId, dto);
  }
}
