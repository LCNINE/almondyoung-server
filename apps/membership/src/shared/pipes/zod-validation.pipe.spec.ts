import { BadRequestException } from '@nestjs/common';
import { ZodValidationPipe } from './zod-validation.pipe';
import { z } from 'zod';

describe('ZodValidationPipe', () => {
  let pipe: ZodValidationPipe;

  const testSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    email: z.string().email('Invalid email format'),
    age: z.number().min(0, 'Age must be positive'),
  });

  beforeEach(() => {
    pipe = new ZodValidationPipe(testSchema);
  });

  it('should be defined', () => {
    expect(pipe).toBeDefined();
  });

  describe('transform', () => {
    it('should return parsed value when validation passes', () => {
      // Arrange
      const validInput = {
        name: 'John Doe',
        email: 'john@example.com',
        age: 25,
      };

      // Act
      const result = pipe.transform(validInput, { type: 'body' });

      // Assert
      expect(result).toEqual(validInput);
    });

    it('should throw BadRequestException when validation fails', () => {
      // Arrange
      const invalidInput = {
        name: '',
        email: 'invalid-email',
        age: -1,
      };

      // Act & Assert
      expect(() => pipe.transform(invalidInput, { type: 'body' })).toThrow(
        BadRequestException,
      );
    });

    it('should include detailed error messages in exception', () => {
      // Arrange
      const invalidInput = {
        name: '',
        email: 'invalid-email',
        age: -1,
      };

      try {
        // Act
        pipe.transform(invalidInput, { type: 'body' });
      } catch (error) {
        // Assert
        expect(error).toBeInstanceOf(BadRequestException);
        const response = error.getResponse();
        expect(response.message).toBe('입력값 검증에 실패했습니다');
        expect(response.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              field: 'name',
              message: 'Name is required',
            }),
            expect.objectContaining({
              field: 'email',
              message: 'Invalid email format',
            }),
            expect.objectContaining({
              field: 'age',
              message: 'Age must be positive',
            }),
          ]),
        );
      }
    });

    it('should handle nested field validation errors', () => {
      // Arrange
      const nestedSchema = z.object({
        user: z.object({
          profile: z.object({
            name: z.string().min(1, 'Name is required'),
          }),
        }),
      });

      const nestedPipe = new ZodValidationPipe(nestedSchema);
      const invalidInput = {
        user: {
          profile: {
            name: '',
          },
        },
      };

      try {
        // Act
        nestedPipe.transform(invalidInput, { type: 'body' });
      } catch (error) {
        // Assert
        expect(error).toBeInstanceOf(BadRequestException);
        const response = error.getResponse();
        expect(response.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              field: 'user.profile.name',
              message: 'Name is required',
            }),
          ]),
        );
      }
    });

    it('should handle non-ZodError exceptions', () => {
      // Arrange
      const mockSchema = {
        parse: jest.fn().mockImplementation(() => {
          throw new Error('Unexpected error');
        }),
      } as any;

      const errorPipe = new ZodValidationPipe(mockSchema);

      // Act & Assert
      expect(() => errorPipe.transform({}, { type: 'body' })).toThrow(
        new BadRequestException('유효성 검사 오류'),
      );
    });

    it('should transform and coerce types when possible', () => {
      // Arrange
      const coercionSchema = z.object({
        id: z.string(),
        count: z.coerce.number(),
        isActive: z.coerce.boolean(),
      });

      const coercionPipe = new ZodValidationPipe(coercionSchema);
      const input = {
        id: 'test-id',
        count: '42', // String that should be coerced to number
        isActive: 'true', // String that should be coerced to boolean
      };

      // Act
      const result = coercionPipe.transform(input, { type: 'body' });

      // Assert
      expect(result).toEqual({
        id: 'test-id',
        count: 42,
        isActive: true,
      });
    });
  });
});
