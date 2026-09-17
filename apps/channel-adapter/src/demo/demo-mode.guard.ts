import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';
import { isSafeDemoMode } from './demo-mode';

@Injectable()
export class DemoModeGuard implements CanActivate {
  canActivate(): boolean {
    if (!isSafeDemoMode(process.env)) {
      throw new ForbiddenException('Demo API is disabled');
    }
    return true;
  }
}
