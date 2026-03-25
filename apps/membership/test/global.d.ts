import { INestApplication } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';

declare global {
  var __APP__: any;
  var __NEST_APP__: INestApplication;
  var __MODULE_REF__: TestingModule;
}
