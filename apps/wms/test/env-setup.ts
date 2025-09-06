import { config } from 'dotenv';
import { resolve } from 'path';

const rootEnvTest = resolve(process.cwd(), '.env.test');
const appEnvTest = resolve(process.cwd(), 'apps/wms/.env.test');

config({ path: rootEnvTest });
config({ path: appEnvTest });
config();


