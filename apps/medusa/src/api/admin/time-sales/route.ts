import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { listAdminTimeSales, listTimeSaleProductHandles } from '../../../utils/time-sale';
import { revalidateStorefront } from '../../../utils/storefront-revalidate';
import { createTimeSaleWorkflow } from '../../../workflows/time-sale/workflows';
import { loadLinkedLists } from '../../../workflows/time-sale/steps';
import type { AdminTimeSaleWriteType } from './validators';

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  return res.json({ timeSales: await listAdminTimeSales(req.scope) });
}

export async function POST(req: MedusaRequest<AdminTimeSaleWriteType>, res: MedusaResponse) {
  const { result } = await createTimeSaleWorkflow(req.scope).run({ input: req.validatedBody });
  const [timeSale] = await listAdminTimeSales(req.scope, { id: result.id });
  if (timeSale.status === 'active') {
    const lists = await loadLinkedLists(req.scope, result.id);
    await revalidateStorefront(req.scope, {
      productHandles: await listTimeSaleProductHandles(req.scope, lists.map((l) => l.id)),
      logLabel: `생성 ${result.id}`,
    });
  }
  return res.status(201).json({ timeSale });
}
