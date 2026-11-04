import { Injectable } from '@nestjs/common';
import { NameMatchReader } from './name-match.reader';
import { NameMatchManager } from './name-match.manager';

@Injectable()
export class NameMatchService {
  constructor(
    private readonly reader: NameMatchReader,
    private readonly manager: NameMatchManager,
  ) {}

  preview() {
    return this.reader.preview();
  }

  apply() {
    return this.manager.apply();
  }
}
