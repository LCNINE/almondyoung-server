import { Controller, UseGuards } from '@nestjs/common';
import { RolesGuard } from '../../commons/guards/roles.guard';
import { RolesService } from './roles.service';

@Controller('roles')
@UseGuards(RolesGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}
}
