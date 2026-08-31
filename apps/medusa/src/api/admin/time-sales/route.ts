import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { listAllTimeSales } from '../../../utils/time-sale';

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  return res.json({ timeSales: await listAllTimeSales(req.scope) });
}
