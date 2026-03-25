import { Injectable } from '@nestjs/common';
import { AuthorizationService } from '../services/authorization.service';
import { ScopeReader } from './scope.reader';

@Injectable()
export class RoleScopeService {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly scopeReader: ScopeReader,
  ) {}

  async updateMappings(roleName: string, add: string[], remove: string[]): Promise<string[]> {
    await Promise.all([
      ...add.map((key) => this.authorizationService.ensureScopeMapping(roleName, key)),
      ...remove.map((key) => this.authorizationService.removeScopeMapping(roleName, key)),
    ]);

    return this.scopeReader.getScopesByRole(roleName);
  }
}
