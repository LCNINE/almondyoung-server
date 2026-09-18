import { PartialType, PickType } from '@nestjs/swagger';
import { CreateSmsDeviceDto } from './create-sms-device.dto';

export class UpdateSmsDeviceDto extends PartialType(PickType(CreateSmsDeviceDto, ['name', 'dailyLimit', 'enabled'] as const)) {}
