import { Controller, UseGuards } from '@nestjs/common';
import { RolesGuard } from '@app/roles';
import { RolesService } from './roles.service';

@Controller('roles')
@UseGuards(RolesGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}
}
