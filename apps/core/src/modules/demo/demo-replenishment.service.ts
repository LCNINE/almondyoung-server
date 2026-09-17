import { Injectable } from '@nestjs/common';
import { DemoReplenishmentManager } from './demo-replenishment.manager';
import { DemoReplenishmentRequest } from './demo-replenishment.input';

@Injectable()
export class DemoReplenishmentService {
  constructor(private readonly manager: DemoReplenishmentManager) {}
  prepare(request: DemoReplenishmentRequest, actorId: string) {
    return this.manager.prepare(request, actorId);
  }
}
