import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ActiveAttendanceStaffGuard } from '../guards/active-attendance-staff.guard';
import { AttendanceRequestsController } from './attendance-requests.controller';
import { AttendanceController } from './attendance.controller';

// 근태 직원 판정은 권한(내 근태)으로 한다. 컨트롤러 단에 역할 이름 가드가 남으면 그림자 모드에서
// 그 역할이 없는 근태 직원(예: 현장 작업자 역할에 내 근태를 더한 사람)이 출퇴근을 못 한다.
describe.each([
  ['AttendanceController', AttendanceController],
  ['AttendanceRequestsController', AttendanceRequestsController],
])('%s class guards', (_name, controller) => {
  it('leaves the staff decision to the permission-based staff guard only', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([ActiveAttendanceStaffGuard]);
  });
});
