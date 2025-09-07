import { Injectable, BadRequestException } from '@nestjs/common';

export type OptionSchema = {
  options: Array<{
    name: string;
    values: string[];
  }>;
};

export type OptionCombination = Record<string, string>;

@Injectable()
export class OptionEngineService {
  validateSchema(schema: OptionSchema): void {
    if (!schema || !Array.isArray(schema.options)) {
      throw new BadRequestException('Invalid option schema');
    }
    for (const opt of schema.options) {
      if (!opt.name || !Array.isArray(opt.values) || opt.values.length === 0) {
        throw new BadRequestException(`Invalid option: ${opt?.name ?? 'unknown'}`);
      }
    }
  }

  generateCombinations(schema: OptionSchema): OptionCombination[] {
    this.validateSchema(schema);
    const optionNames = schema.options.map((o) => o.name);
    const dfs = (idx: number): OptionCombination[] => {
      if (idx === schema.options.length) return [{}];
      const result: OptionCombination[] = [];
      const current = schema.options[idx];
      for (const val of current.values) {
        const tails = dfs(idx + 1);
        for (const tail of tails) {
          result.push({ ...tail, [current.name]: val });
        }
      }
      return result;
    };
    const combos = dfs(0).map((combo) => this.normalizeOptionKey(combo, optionNames));
    return combos;
  }

  normalizeOptionKey(combo: OptionCombination, orderHint?: string[]): OptionCombination {
    const entries = Object.entries(combo);
    const ordered = orderHint && orderHint.length > 0
      ? entries.sort((a, b) => (orderHint.indexOf(a[0]) - orderHint.indexOf(b[0])))
      : entries.sort(([a], [b]) => a.localeCompare(b));
    return ordered.reduce<Record<string, string>>((acc, [k, v]) => { acc[k] = v; return acc; }, {});
  }
}


