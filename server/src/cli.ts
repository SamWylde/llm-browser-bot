#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const command = process.argv[2];

function runScript(scriptName: string, args: string[] = []) {
  const scriptPath = join(__dirname, `${scriptName}.js`);
  const child = spawn(process.execPath, [scriptPath, ...args], {
    stdio: 'inherit'
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

// Default to interactive start if no command provided
if (!command) {
  runScript('start-interactive');
} else if (command === 'server') {
  runScript('index', process.argv.slice(3));
} else if (command === 'bridge') {
  runScript('bridge', process.argv.slice(3));
} else if (command === 'setup') {
  runScript('setup', process.argv.slice(3));
} else if (command === 'start') {
  runScript('start-interactive', process.argv.slice(3));
} else if (command === 'validate-chatgpt') {
  runScript('validate-chatgpt', process.argv.slice(3));
} else {
  console.error(`Unknown command: ${command}`);
  console.error('');
  console.error('Usage: llm-browser-bot [command]');
  console.error('');
  console.error('Commands:');
  console.error('  (none)  Interactive setup - choose your AI platform (Claude, ChatGPT, etc.)');
  console.error('  start   Same as above - interactive setup wizard');
  console.error('  server  Run the MCP server directly (no prompts)');
  console.error('  bridge  Run the stdio-to-websocket bridge for MCP clients');
  console.error('  setup   Run the welcome page setup wizard');
  console.error('  validate-chatgpt  Validate a public HTTPS URL for ChatGPT MCP');
  process.exit(1);
}
