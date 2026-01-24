import chalk from 'chalk';

/**
 * Logger utility with colored output
 */
export class Logger {
  constructor(private context: string) {}

  info(message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    console.log(
      `${chalk.gray(timestamp)} ${chalk.blue('[INFO]')} ${chalk.cyan(`[${this.context}]`)} ${message}`
    );
    if (data) {
      console.log(chalk.gray(JSON.stringify(data, null, 2)));
    }
  }

  success(message: string): void {
    const timestamp = new Date().toISOString();
    console.log(
      `${chalk.gray(timestamp)} ${chalk.green('[SUCCESS]')} ${chalk.cyan(`[${this.context}]`)} ${message}`
    );
  }

  warn(message: string): void {
    const timestamp = new Date().toISOString();
    console.log(
      `${chalk.gray(timestamp)} ${chalk.yellow('[WARN]')} ${chalk.cyan(`[${this.context}]`)} ${message}`
    );
  }

  error(message: string, error?: any): void {
    const timestamp = new Date().toISOString();
    console.log(
      `${chalk.gray(timestamp)} ${chalk.red('[ERROR]')} ${chalk.cyan(`[${this.context}]`)} ${message}`
    );
    if (error) {
      if (error instanceof Error) {
        console.log(chalk.red(error.message));
        if (error.stack) {
          console.log(chalk.gray(error.stack));
        }
      } else {
        console.log(chalk.red(JSON.stringify(error, null, 2)));
      }
    }
  }

  step(stepNumber: number, totalSteps: number, description: string): void {
    const timestamp = new Date().toISOString();
    console.log(
      `${chalk.gray(timestamp)} ${chalk.magenta(`[${stepNumber}/${totalSteps}]`)} ${chalk.cyan(`[${this.context}]`)} ${description}`
    );
  }
}
