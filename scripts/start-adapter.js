const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envPath = path.join(__dirname, '..', 'apps', 'channel-adapter', '.env');
const envConfig = dotenv.parse(fs.readFileSync(envPath));

for (const k in envConfig) {
  process.env[k] = envConfig[k];
}

process.env.NODE_OPTIONS = '--no-network-family-autoselection --dns-result-order=ipv4first';

// Use ts-node to run the main.ts directly
const child = spawn('./node_modules/.bin/ts-node', [
  '-r', 'tsconfig-paths/register',
  'apps/channel-adapter/src/main.ts'
], {
  stdio: 'inherit',
  env: process.env
});

child.on('close', (code) => {
  console.log(`Child process exited with code ${code}`);
});
