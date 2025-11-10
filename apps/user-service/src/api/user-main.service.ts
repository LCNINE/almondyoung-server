import { Injectable } from '@nestjs/common';

@Injectable()
export class UserMainService {
  getHello(): string {
    return 'Hello World!';
  }
}
