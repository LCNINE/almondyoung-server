import { Injectable } from '@nestjs/common';

@Injectable()
export class PimService {
  getHello(): string {
    return 'Hello World!';
  }
}
