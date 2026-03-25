import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { MedusaError } from '@medusajs/framework/utils';

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { almondUserId } = req.params;

  const query = req.scope.resolve('query');

  const { data: customers } = await query.graph({
    entity: 'customer',
    fields: ['id', 'email', 'metadata'],
    filters: {
      metadata: { almond_user_id: almondUserId },
    },
    pagination: { take: 1 },
  });

  const customer = customers[0];

  if (!customer) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Customer with almond_user_id=${almondUserId} not found`);
  }

  res.json({ customer });
};
