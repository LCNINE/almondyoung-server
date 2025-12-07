import { ZodType } from "zod";

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type ResponseSchemaFn = (ctx: Record<string, unknown>) => ZodType<unknown>;

export interface ScenarioStep {
  id: string;
  method: HttpMethod;
  path: string;
  pathParams?: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: Record<string, unknown>;
  expectedStatus: number;
  description: string;
  extractFromResponse?: Record<string, string>;
  responseSchema?: ZodType<unknown> | ResponseSchemaFn;
}

export interface Scenario {
  id: string;
  name: string;
  category: string;
  steps: ScenarioStep[];
  validation: string;
}