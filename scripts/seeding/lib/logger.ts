import chalk from 'chalk';

export class Logger {
  constructor(private context: string) {}

  info(message: string): void {
    console.log(`  ${chalk.blue('[INFO]')} ${chalk.cyan(`[${this.context}]`)} ${message}`);
  }

  success(message: string): void {
    console.log(`  ${chalk.green('[OK]')} ${chalk.cyan(`[${this.context}]`)} ${message}`);
  }

  warn(message: string): void {
    console.log(`  ${chalk.yellow('[WARN]')} ${chalk.cyan(`[${this.context}]`)} ${message}`);
  }

  error(message: string, error?: unknown): void {
    console.log(`  ${chalk.red('[ERROR]')} ${chalk.cyan(`[${this.context}]`)} ${message}`);
    if (error instanceof Error) {
      console.log(chalk.red(`  ${error.message}`));
      if (error.stack) console.log(chalk.gray(error.stack));
    } else if (error !== undefined) {
      console.log(chalk.red(`  ${String(error)}`));
    }
  }

  step(stepNumber: number, totalSteps: number, description: string): void {
    console.log(
      `  ${chalk.magenta(`[${stepNumber}/${totalSteps}]`)} ${chalk.cyan(`[${this.context}]`)} ${description}`,
    );
  }
}
