export interface PimClientPort {
  createMaster(input: any, idempotencyKey?: string): Promise<{ masterId: string }>;
  getMasterDetail(masterId: string): Promise<any>;
  generateVariants(masterId: string): Promise<void>;
  deleteMaster(masterId: string): Promise<void>;
}
