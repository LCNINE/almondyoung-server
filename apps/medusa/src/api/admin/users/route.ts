import { Modules } from '@medusajs/framework/utils';
import { createUserAccountWorkflow } from '@medusajs/medusa/core-flows';
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from '@medusajs/framework/http';

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) {
  const { email, password } = req.body as { email: string; password: string };

  const authModule = req.scope.resolve(Modules.AUTH);

  // 비밀번호 해싱 및 Auth Identity 생성
  const { success, authIdentity, error } = await authModule.register(
    'emailpass',
    {
      body: {
        email,
        password,
      },
    },
  );

  if (!success || !authIdentity) {
    return res.status(400).json({ error: error || 'Failed to register user' });
  }

  // User ↔ AuthIdentity 매핑
  const { result } = await createUserAccountWorkflow(req.scope).run({
    input: {
      authIdentityId: authIdentity.id,
      userData: { email },
    },
  });

  return res.status(201).json(result);
}
