import { type JwtPayload } from '@app/authorization';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AttendanceStaffUnavailableError } from '../attendance-staff';
import { AttendanceRepository } from '../repositories/attendance.repository';

@Injectable()
export class ActiveAttendanceStaffGuard implements CanActivate {
  constructor(
    @Inject(AttendanceRepository)
    private readonly repo: Pick<AttendanceRepository, 'isActiveStaff'>,
  ) {}

  async canActivate(context: ExecutionContext) {
    const user = context.switchToHttp().getRequest<{ user: JwtPayload }>().user;

    let active: boolean;

    try {
      active = await this.repo.isActiveStaff(user?.id);
    } catch (error) {
      if (error instanceof AttendanceStaffUnavailableError) {
        throw new ServiceUnavailableException('권한 정보를 아직 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.');
      }

      throw error;
    }

    if (!active) {
      throw new ForbiddenException('활성 직원 계정으로 이용해 주세요.');
    }

    return true;
  }
}
