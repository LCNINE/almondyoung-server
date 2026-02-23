import { Type, applyDecorators } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiResponseOptions,
  getSchemaPath,
} from '@nestjs/swagger';
import { WalletSuccessEnvelopeDto } from '../dto/api-envelope.dto';

type WalletApiResponseOptions = Omit<ApiResponseOptions, 'schema' | 'type'>;

function buildSuccessSchema(dataDto: Type<unknown>, isArray: boolean) {
  return {
    allOf: [
      { $ref: getSchemaPath(WalletSuccessEnvelopeDto) },
      {
        properties: {
          data: isArray
            ? {
                type: 'array',
                items: { $ref: getSchemaPath(dataDto) },
              }
            : {
                $ref: getSchemaPath(dataDto),
              },
        },
      },
    ],
  };
}

export const ApiWalletOkResponse = <DataDto extends Type<unknown>>(
  dataDto: DataDto,
  options?: WalletApiResponseOptions,
) =>
  applyDecorators(
    ApiExtraModels(WalletSuccessEnvelopeDto, dataDto),
    ApiOkResponse({
      ...options,
      schema: buildSuccessSchema(dataDto, false),
    }),
  );

export const ApiWalletCreatedResponse = <DataDto extends Type<unknown>>(
  dataDto: DataDto,
  options?: WalletApiResponseOptions,
) =>
  applyDecorators(
    ApiExtraModels(WalletSuccessEnvelopeDto, dataDto),
    ApiCreatedResponse({
      ...options,
      schema: buildSuccessSchema(dataDto, false),
    }),
  );

export const ApiWalletOkArrayResponse = <DataDto extends Type<unknown>>(
  dataDto: DataDto,
  options?: WalletApiResponseOptions,
) =>
  applyDecorators(
    ApiExtraModels(WalletSuccessEnvelopeDto, dataDto),
    ApiOkResponse({
      ...options,
      schema: buildSuccessSchema(dataDto, true),
    }),
  );

export const ApiWalletCreatedArrayResponse = <DataDto extends Type<unknown>>(
  dataDto: DataDto,
  options?: WalletApiResponseOptions,
) =>
  applyDecorators(
    ApiExtraModels(WalletSuccessEnvelopeDto, dataDto),
    ApiCreatedResponse({
      ...options,
      schema: buildSuccessSchema(dataDto, true),
    }),
  );
