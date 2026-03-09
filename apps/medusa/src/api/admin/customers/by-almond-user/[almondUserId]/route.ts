import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from '@medusajs/framework/http';
import { Modules, MedusaError } from '@medusajs/framework/utils';
import { ICustomerModuleService } from '@medusajs/framework/types';

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const { almondUserId } = req.params;

  const customerModuleService = req.scope.resolve<ICustomerModuleService>(
    Modules.CUSTOMER,
  );

  const [customer] = await customerModuleService.listCustomers(
    { metadata: { almond_user_id: almondUserId } },
    { take: 1 },
  );

  if (!customer) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Customer with almond_user_id=${almondUserId} not found`,
    );
  }

  res.json({ customer });
};
