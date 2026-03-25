// apps/notification/src/shared/services/template-renderer.service.ts
import { Injectable } from '@nestjs/common';
import * as Handlebars from 'handlebars';

@Injectable()
export class TemplateRendererService {
  constructor() {
    this.registerHelpers();
  }

  async render(template: string, data: Record<string, any>, schema?: Record<string, any>): Promise<string> {
    try {
      if (schema) {
        this.validateData(data, schema);
      }

      const compiledTemplate = Handlebars.compile(template);
      return compiledTemplate(data);
    } catch (error) {
      throw new Error(`Template rendering failed: ${error.message}`);
    }
  }

  async renderMultiChannel(
    templates: Record<string, { subject?: string; body: string }>,
    data: Record<string, any>,
  ): Promise<Record<string, { subject?: string; body: string }>> {
    const rendered: Record<string, { subject?: string; body: string }> = {};

    for (const [channel, template] of Object.entries(templates)) {
      rendered[channel] = {
        subject: template.subject ? await this.render(template.subject, data) : undefined,
        body: await this.render(template.body, data),
      };
    }

    return rendered;
  }

  private registerHelpers() {
    Handlebars.registerHelper('formatDate', (date: Date | string, format: string) => {
      const d = new Date(date);
      return d.toLocaleDateString('ko-KR');
    });

    Handlebars.registerHelper('formatCurrency', (amount: number) => {
      return new Intl.NumberFormat('ko-KR', {
        style: 'currency',
        currency: 'KRW',
      }).format(amount);
    });

    Handlebars.registerHelper('eq', (a: any, b: any) => a === b);
    Handlebars.registerHelper('ne', (a: any, b: any) => a !== b);
    Handlebars.registerHelper('lt', (a: any, b: any) => a < b);
    Handlebars.registerHelper('gt', (a: any, b: any) => a > b);
  }

  private validateData(data: Record<string, any>, schema: Record<string, any>) {
    for (const [key, type] of Object.entries(schema)) {
      if (!(key in data)) {
        throw new Error(`Missing required field: ${key}`);
      }

      if (typeof type === 'object' && typeof data[key] === 'object') {
        this.validateData(data[key], type);
      }
    }
  }
}
