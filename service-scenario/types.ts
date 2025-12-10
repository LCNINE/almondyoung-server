import type { ZodType } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type ServiceType = 'pim' | 'wms';

export type ResponseSchemaFn = (ctx: Record<string, unknown>) => ZodType<unknown>;

export interface ScenarioStep {
  id: string;
  method: HttpMethod;
  path: string;
  service: ServiceType;
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

export type StepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface StepResult {
  stepId: string;
  status: StepStatus;
  request?: {
    method: HttpMethod;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  };
  response?: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: unknown;
  };
  error?: string;
  duration?: number;
}

export interface ScenarioRunState {
  scenarioId: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  context: Record<string, unknown>;
  stepResults: StepResult[];
  currentStepIndex: number;
}

