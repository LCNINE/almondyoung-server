import { Injectable } from '@nestjs/common';
import type {
  MyWage,
  PayGroup,
  SettlementRecord,
  SettlementResult,
  SettlementSummary,
  WageDecisions,
} from '@packages/domain-types/attendance-wage';
import type {
  ConfirmSettlementDto,
  DecideAbsenceDto,
  DecideOvertimeDto,
  ReopenSettlementDto,
} from './dto/wage-settlement.dto';
import { WageSettlementManager } from './wage-settlement.manager';
import { WageSettlementReader } from './wage-settlement.reader';

@Injectable()
export class WageSettlementService {
  constructor(
    private readonly reader: WageSettlementReader,
    private readonly manager: WageSettlementManager,
  ) {}

  groups(): Promise<PayGroup[]> {
    return this.reader.groups();
  }

  decisions(groupId: string, paydayMonth: string): Promise<WageDecisions> {
    return this.reader.decisions(groupId, paydayMonth);
  }

  decideOvertime(actorId: string, userId: string, workDate: string, dto: DecideOvertimeDto): Promise<void> {
    return this.manager.decideOvertime(actorId, userId, workDate, dto);
  }

  decideAbsence(actorId: string, userId: string, workDate: string, dto: DecideAbsenceDto): Promise<void> {
    return this.manager.decideAbsence(actorId, userId, workDate, dto);
  }

  clearDecision(actorId: string, kind: 'overtime' | 'absence', userId: string, workDate: string): Promise<void> {
    return this.manager.clearDecision(actorId, kind, userId, workDate);
  }

  preview(groupId: string, paydayMonth: string): Promise<SettlementResult> {
    return this.reader.preview(groupId, paydayMonth);
  }

  settlements(groupId: string): Promise<SettlementSummary[]> {
    return this.reader.settlements(groupId);
  }

  settlement(id: string): Promise<SettlementRecord> {
    return this.reader.settlement(id);
  }

  confirm(actorId: string, dto: ConfirmSettlementDto): Promise<SettlementRecord> {
    return this.manager.confirm(actorId, dto);
  }

  reopen(actorId: string, id: string, dto: ReopenSettlementDto): Promise<SettlementRecord> {
    return this.manager.reopen(actorId, id, dto);
  }

  exportSettlement(actorId: string, id: string): Promise<SettlementRecord> {
    return this.manager.exportSettlement(actorId, id);
  }

  exportPreview(actorId: string, groupId: string, paydayMonth: string): Promise<SettlementResult> {
    return this.manager.exportPreview(actorId, groupId, paydayMonth);
  }

  mine(userId: string, paydayMonth: string): Promise<MyWage> {
    return this.reader.mine(userId, paydayMonth);
  }
}
