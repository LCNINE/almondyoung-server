import { Test, TestingModule } from '@nestjs/testing';
import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import {
  SubscriptionExceptionFilter,
  HttpExceptionFilter,
  GlobalExceptionFilter,
} from './subscription-exception.filter';
import { SubscriptionNotFoundException } from '../exceptions/subscription.exceptions';

describe('Exception Filters', () => {
  let subscriptionFilter: SubscriptionExceptionFilter;
  let httpFilter: HttpExceptionFilter;
  let globalFilter: GlobalExceptionFilter;

  const mockResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };

  const mockRequest = {
    url: '/subscriptions/current',
    method: 'GET',
  };

  const mockArgumentsHost = {
    switchToHttp: jest.fn().mockReturnValue({
      getResponse: jest.fn().mockReturnValue(mockResponse),
      getRequest: jest.fn().mockReturnValue(mockRequest),
    }),
  } as unknown as ArgumentsHost;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionExceptionFilter,
        HttpExceptionFilter,
        GlobalExceptionFilter,
      ],
    }).compile();

    subscriptionFilter = module.get<SubscriptionExceptionFilter>(
      SubscriptionExceptionFilter,
    );
    httpFilter = module.get<HttpExceptionFilter>(HttpExceptionFilter);
    globalFilter = module.get<GlobalExceptionFilter>(GlobalExceptionFilter);

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('SubscriptionExceptionFilter', () => {
    it('should handle SubscriptionNotFoundException correctly', () => {
      // Arrange
      const exception = new SubscriptionNotFoundException();

      // Act
      subscriptionFilter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockResponse.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.NOT_FOUND,
        timestamp: expect.any(String),
        path: '/subscriptions/current',
        error: {
          code: 'SUBSCRIPTION_NOT_FOUND',
          message: '활성 구독이 없습니다',
          details: null,
        },
      });
    });

    it('should include details when available in exception response', () => {
      // Arrange
      const exception = new SubscriptionNotFoundException();
      // Mock the getResponse to return details
      jest.spyOn(exception, 'getResponse').mockReturnValue({
        message: '활성 구독이 없습니다',
        code: 'SUBSCRIPTION_NOT_FOUND',
        timestamp: expect.any(String),
        details: { userId: 'user-123' },
      });

      // Act
      subscriptionFilter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.NOT_FOUND,
        timestamp: expect.any(String),
        path: '/subscriptions/current',
        error: {
          code: 'SUBSCRIPTION_NOT_FOUND',
          message: '활성 구독이 없습니다',
          details: { userId: 'user-123' },
        },
      });
    });
  });

  describe('HttpExceptionFilter', () => {
    it('should handle HttpException with string message', () => {
      // Arrange
      const exception = new HttpException(
        'Bad Request',
        HttpStatus.BAD_REQUEST,
      );

      // Act
      httpFilter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.BAD_REQUEST,
        timestamp: expect.any(String),
        path: '/subscriptions/current',
        message: 'Bad Request',
      });
    });

    it('should handle HttpException with object message', () => {
      // Arrange
      const exception = new HttpException(
        { message: 'Validation failed', errors: ['field is required'] },
        HttpStatus.BAD_REQUEST,
      );

      // Act
      httpFilter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.BAD_REQUEST,
        timestamp: expect.any(String),
        path: '/subscriptions/current',
        message: 'Validation failed',
      });
    });
  });

  describe('GlobalExceptionFilter', () => {
    it('should handle HttpException', () => {
      // Arrange
      const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);

      // Act
      globalFilter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockResponse.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.NOT_FOUND,
        timestamp: expect.any(String),
        path: '/subscriptions/current',
        message: 'Not Found',
      });
    });

    it('should handle generic Error', () => {
      // Arrange
      const exception = new Error('Something went wrong');

      // Act
      globalFilter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        timestamp: expect.any(String),
        path: '/subscriptions/current',
        message: 'Something went wrong',
      });
    });

    it('should handle unknown exception', () => {
      // Arrange
      const exception = 'Unknown error';

      // Act
      globalFilter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        timestamp: expect.any(String),
        path: '/subscriptions/current',
        message: 'Internal server error',
      });
    });
  });
});
