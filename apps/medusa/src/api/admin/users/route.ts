import { container } from '@medusajs/framework';
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from '@medusajs/framework/http';
import { Modules } from '@medusajs/framework/utils';
import {
  createUserAccountWorkflow,
  createUsersWorkflow,
  setAuthAppMetadataStep,
} from '@medusajs/medusa/core-flows';
import { CreateUserDTO, IAuthModuleService } from '@medusajs/types';
import * as bcrypt from 'bcrypt';

interface AdminCreateUserBody {
  email: string;
  password: string;
}

/**
 * admin권한을 가진 관리자가 다른 유저의 관리자계정을 생성하는 라우트
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) {
  try {
    const { email, password } = req.body as AdminCreateUserBody;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required',
      });
    }

    const authHeader = req?.headers?.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No Bearer token found',
      });
    }

    const token = authHeader.split(' ')[1];
    // 1. 새로운 AuthIdentity 생성
    const authModuleService = req.scope.resolve(Modules.AUTH);
    const SALT_ROUNDS = 10;
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const [newAuthIdentity] = await authModuleService.createAuthIdentities([
      {
        provider_identities: [
          {
            provider: 'emailpass',
            entity_id: email,
            provider_metadata: {
              password: hashedPassword,
            },
          },
        ],
      },
    ]);

    // 2. 새 AuthIdentity와 User 매핑
    const { result } = await createUserAccountWorkflow(req.scope).run({
      input: {
        authIdentityId: newAuthIdentity.id,
        userData: req.body as CreateUserDTO,
      },
    });

    return res.status(201).json(result);
  } catch (error) {
    console.error('User creation error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
}
