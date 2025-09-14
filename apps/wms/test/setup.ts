import { Test } from '@nestjs/testing';

// Jest global setup
beforeAll(async () => {
  // Global test setup if needed
});

afterAll(async () => {
  // Global cleanup if needed
});

// Mock console methods to reduce noise in tests unless explicitly needed
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});