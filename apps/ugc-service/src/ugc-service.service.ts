import { Injectable } from '@nestjs/common';

@Injectable()
export class UgcServiceService {
  getHello(): string {
    return 'Hello World!';
  }
}
