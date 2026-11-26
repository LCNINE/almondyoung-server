import { Injectable } from '@nestjs/common';
import type { IamActor } from '../iam-actor';
import type { StaffNameDto } from './dto/staff-names.dto';
import { StaffNamesReader } from './staff-names.reader';

@Injectable()
export class StaffNamesService {
  constructor(private readonly reader: StaffNamesReader) {}

  namesOf(actor: IamActor, userIds: readonly string[]): Promise<StaffNameDto[]> {
    return this.reader.namesOf(actor, userIds);
  }
}
