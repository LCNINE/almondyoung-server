import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';

import { handleGetSatisfaction, handlePutSatisfaction } from './handlers';

export const GET = (req: AuthenticatedMedusaRequest, res: MedusaResponse) => handleGetSatisfaction(req, res);

export const PUT = (req: AuthenticatedMedusaRequest, res: MedusaResponse) => handlePutSatisfaction(req, res);
