import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { loadTimeSaleSettings, saveTimeSaleSettings } from '../../../utils/time-sale-settings';

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  return res.json(await loadTimeSaleSettings(req.scope));
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = req.body as { settings?: unknown; revision?: unknown };

  return res.json(await saveTimeSaleSettings(req.scope, body?.settings, body?.revision));
}
