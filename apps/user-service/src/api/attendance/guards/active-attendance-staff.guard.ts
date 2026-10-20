import { type JwtPayload } from '@app/authorization';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AttendanceRepository } from '../repositories/attendance.repository';

@Injectable()
export class ActiveAttendanceStaffGuard implements CanActivate {
  constructor(private readonly repo: AttendanceRepository) {}

  async canActivate(context: ExecutionContext) {
    const user = context.switchToHttp().getRequest<{ user: JwtPayload }>().user;

    if (!(await this.repo.staff()).some((person) => person.userId === user?.id)) {
      throw new ForbiddenException('활성 직원 계정으로 이용해 주세요.');
    }

    return true;
  }
}
