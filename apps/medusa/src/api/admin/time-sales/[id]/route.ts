import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { MedusaError } from '@medusajs/framework/utils';
import { listAdminTimeSales, listTimeSaleProductHandles } from '../../../../utils/time-sale';
import { revalidateStorefront } from '../../../../utils/storefront-revalidate';
import { deleteTimeSaleWorkflow, updateTimeSaleWorkflow } from '../../../../workflows/time-sale/workflows';
import { loadLinkedLists } from '../../../../workflows/time-sale/steps';
import type { AdminTimeSaleWriteType } from '../validators';

async function retrieve(req: MedusaRequest, id: string) {
  const [timeSale] = await listAdminTimeSales(req.scope, { id });
  if (!timeSale) throw new MedusaError(MedusaError.Types.NOT_FOUND, `타임세일 ${id} 이 없습니다.`);
  return timeSale;
}

/** 쓰기 전후 양쪽 상품을 비운다 — 수정으로 세일에서 빠진 상품도 세일가 캐시가 남지 않게. */
async function handlesOf(req: MedusaRequest, id: string) {
  const lists = await loadLinkedLists(req.scope, id);
  return listTimeSaleProductHandles(req.scope, lists.map((l) => l.id));
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  return res.json({ timeSale: await retrieve(req, req.params.id) });
}

export async function POST(req: MedusaRequest<AdminTimeSaleWriteType>, res: MedusaResponse) {
  const id = req.params.id;
  const before = await handlesOf(req, id);
  await updateTimeSaleWorkflow(req.scope).run({ input: { id, ...req.validatedBody } });
  const after = await handlesOf(req, id);
  await revalidateStorefront(req.scope, { productHandles: [...before, ...after], logLabel: `수정 ${id}` });
  return res.json({ timeSale: await retrieve(req, id) });
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const id = req.params.id;
  const before = await handlesOf(req, id);
  await deleteTimeSaleWorkflow(req.scope).run({ input: { id } });
  await revalidateStorefront(req.scope, { productHandles: before, logLabel: `삭제 ${id}` });
  return res.json({ id, object: 'time_sale', deleted: true });
}
