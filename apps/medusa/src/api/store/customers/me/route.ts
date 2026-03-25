import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';

import { StoreGetCustomerParamsType } from '../validators';
import { updateCustomersWorkflow } from '@medusajs/core-flows';
import { HttpTypes } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils';
import { refetchCustomer } from '../helpers';

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const id = req.auth_context.actor_id;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const {
    data: [customer],
  } = await query.graph(
    {
      entity: 'customer',
      fields: ['*', 'addresses.*', 'groups.*'],
      filters: { id },
    },
    { throwIfKeyNotFound: true },
  );

  if (!customer) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Customer with id: ${id} was not found`);
  }

  res.json({ customer });
};

export const POST = async (
  req: AuthenticatedMedusaRequest<HttpTypes.StoreUpdateCustomer, HttpTypes.SelectParams>,
  res: MedusaResponse<HttpTypes.StoreCustomerResponse>,
) => {
  const customerId = req.auth_context.actor_id;
  await updateCustomersWorkflow(req.scope).run({
    input: {
      selector: { id: customerId },
      update: req.validatedBody,
    },
  });

  const customer = await refetchCustomer(customerId, req.scope, req.queryConfig.fields);
  res.status(200).json({ customer });
};
