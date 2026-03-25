import { PimClientPort } from './pim.port';

export class PimOrchestrator {
  constructor(private readonly pim: PimClientPort) {}

  async createMasterAndVariants(input: any, opts: { idempotencyKey?: string }) {
    const { idempotencyKey } = opts || {};
    const { masterId } = await this.pim.createMaster(input, idempotencyKey);
    try {
      await this.pim.generateVariants(masterId);
      return { masterId };
    } catch (err) {
      try {
        await this.pim.deleteMaster(masterId);
      } catch {}
      throw err;
    }
  }
}
