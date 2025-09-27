// apps/wms/src/wms.service.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class WmsService {
  getHello(): string {
    return 'Hello World!';
  }
}
