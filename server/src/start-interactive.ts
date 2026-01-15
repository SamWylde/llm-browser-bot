#!/usr/bin/env node

import { spawn, ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

process.title = 'LLM Browser Bot';

const PORT = 61822;

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logHeader(message: string) {
  console.log();
  log('═'.repeat(50), colors.cyan);
  log(message, colors.bright + colors.cyan);
  log('═'.repeat(50), colors.cyan);
  console.log();
}

function logInfo(label: string, value: string) {
  console.log(`${colors.dim}${label}:${colors.reset} ${colors.green}${value}${colors.reset}`);
}

async function askQuestion(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function checkCommandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, ['--version'], { stdio: 'pipe', shell: true });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

async function startServer(): Promise<ChildProcess> {
  const serverPath = join(__dirname, 'index.js');

  log('Starting LLM Browser Bot server...', colors.yellow);

  const serverProcess = spawn(process.execPath, [serverPath], {
    stdio: 'inherit'
  });

  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 2000));

  return serverProcess;
}

async function startServerBackground(): Promise<void> {
  const serverPath = join(__dirname, 'index.js');

  log('Starting LLM Browser Bot server...', colors.yellow);

  const serverProcess = spawn(process.execPath, [serverPath], {
    stdio: 'pipe',
    detached: true
  });
  serverProcess.unref();

  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 2000));
}

// ============ TUNNEL PROVIDERS ============

async function startNgrok(): Promise<string | null> {
  log('Starting ngrok tunnel...', colors.yellow);

  return new Promise((resolve) => {
    const ngrokProcess = spawn('ngrok', ['http', PORT.toString(), '--log=stdout'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let resolved = false;
    let output = '';

    ngrokProcess.stdout?.on('data', (data) => {
      output += data.toString();
      const urlMatch = output.match(/url=(https:\/\/[^\s]+)/);
      if (urlMatch && !resolved) {
        resolved = true;
        resolve(urlMatch[1]);
      }
    });

    ngrokProcess.stderr?.on('data', (data) => {
      output += data.toString();
    });

    ngrokProcess.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        log(`Error starting ngrok: ${err.message}`, colors.red);
        resolve(null);
      }
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        fetch('http://localhost:4040/api/tunnels')
          .then(res => res.json())
          .then((data: any) => {
            const tunnel = data.tunnels?.find((t: any) => t.proto === 'https');
            resolve(tunnel ? tunnel.public_url : null);
          })
          .catch(() => resolve(null));
      }
    }, 10000);
  });
}

async function startLocaltunnel(): Promise<string | null> {
  log('Starting localtunnel (free, no signup)...', colors.yellow);
  console.log(`${colors.dim}This may take a moment on first run...${colors.reset}`);

  return new Promise((resolve) => {
    const ltProcess = spawn('npx', ['-y', 'localtunnel', '--port', PORT.toString()], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true
    });

    let resolved = false;
    let output = '';

    const parseUrl = (text: string): string | null => {
      // localtunnel outputs: "your url is: https://xxx.loca.lt"
      const match = text.match(/your url is:\s*(https:\/\/[^\s]+)/i) ||
                    text.match(/(https:\/\/[^\s]+\.loca\.lt)/);
      return match ? match[1] : null;
    };

    ltProcess.stdout?.on('data', (data) => {
      output += data.toString();
      const url = parseUrl(output);
      if (url && !resolved) {
        resolved = true;
        resolve(url);
      }
    });

    ltProcess.stderr?.on('data', (data) => {
      output += data.toString();
      const url = parseUrl(output);
      if (url && !resolved) {
        resolved = true;
        resolve(url);
      }
    });

    ltProcess.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        log(`Error: ${err.message}`, colors.red);
        resolve(null);
      }
    });

    // Timeout after 60 seconds (npx might need to download)
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        log('Timeout waiting for localtunnel.', colors.red);
        resolve(null);
      }
    }, 60000);
  });
}

function showChatGPTInstructions(publicUrl: string) {
  logHeader('ChatGPT Setup Ready!');

  logInfo('Local Server', `http://localhost:${PORT}`);
  logInfo('Public URL', publicUrl);
  logInfo('MCP Endpoint', `${publicUrl}/mcp`);

  console.log();
  log('To connect ChatGPT:', colors.bright);
  console.log();
  log('  1. Open ChatGPT and enable Developer Mode', colors.dim);
  log('  2. Go to Settings → Developer Mode → MCP Connectors', colors.dim);
  log('  3. Add a new connector with this URL:', colors.dim);
  console.log();
  log(`     ${publicUrl}/mcp`, colors.green + colors.bright);
  console.log();
  log('Press Ctrl+C to stop.', colors.yellow);
}

async function handleChatGPTSetup() {
  console.log();
  log('ChatGPT requires a public HTTPS URL (cannot use localhost).', colors.yellow);
  console.log();
  log('Choose a tunnel provider:', colors.bright);
  console.log();
  console.log(`  ${colors.cyan}1${colors.reset}) localtunnel ${colors.green}(FREE - no signup!)${colors.reset}`);
  console.log(`  ${colors.cyan}2${colors.reset}) ngrok ${colors.dim}(free tier - requires signup)${colors.reset}`);
  console.log(`  ${colors.cyan}3${colors.reset}) I'll set up my own tunnel`);
  console.log();

  const tunnelChoice = await askQuestion(`Enter choice ${colors.dim}[1-3]${colors.reset}: `);

  // Start server in background first
  await startServerBackground();

  if (tunnelChoice === '1' || tunnelChoice === 'localtunnel' || tunnelChoice === 'lt') {
    const publicUrl = await startLocaltunnel();

    if (publicUrl) {
      showChatGPTInstructions(publicUrl);

      // Keep process running
      process.on('SIGINT', () => {
        log('\nShutting down...', colors.yellow);
        process.exit(0);
      });
      await new Promise(() => {});
    } else {
      log('Failed to start localtunnel.', colors.red);
      log('Try running manually: npx localtunnel --port 61822', colors.dim);
      process.exit(1);
    }

  } else if (tunnelChoice === '2' || tunnelChoice === 'ngrok') {
    const ngrokInstalled = await checkCommandExists('ngrok');

    if (!ngrokInstalled) {
      log('ngrok is not installed.', colors.red);
      console.log();
      log('Install ngrok:', colors.bright);
      log('  1. Visit: https://ngrok.com/download', colors.cyan);
      log('  2. Sign up for a free account', colors.cyan);
      log('  3. Install and run: ngrok config add-authtoken YOUR_TOKEN', colors.cyan);
      console.log();
      log('Or use localtunnel instead (option 1) - no signup required!', colors.green);
      process.exit(1);
    }

    const publicUrl = await startNgrok();

    if (publicUrl) {
      showChatGPTInstructions(publicUrl);

      process.on('SIGINT', () => {
        log('\nShutting down...', colors.yellow);
        process.exit(0);
      });
      await new Promise(() => {});
    } else {
      log('Failed to start ngrok.', colors.red);
      process.exit(1);
    }

  } else {
    // Manual tunnel setup
    logHeader('Manual Tunnel Setup');

    log('Server is running on:', colors.bright);
    logInfo('Local', `http://localhost:${PORT}`);
    logInfo('WebSocket', `ws://localhost:${PORT}/mcp`);
    console.log();

    log('Set up your own tunnel to expose port 61822, then use:', colors.bright);
    log('  https://YOUR-TUNNEL-URL/mcp', colors.cyan);
    console.log();

    log('Example with SSH tunnel:', colors.dim);
    log('  ssh -R 80:localhost:61822 serveo.net', colors.dim);
    console.log();

    log('Press Ctrl+C to stop the server.', colors.yellow);

    process.on('SIGINT', () => {
      log('\nShutting down...', colors.yellow);
      process.exit(0);
    });
    await new Promise(() => {});
  }
}

async function main() {
  logHeader('LLM Browser Bot - Interactive Setup');

  console.log('Which AI platform are you using?\n');
  console.log(`  ${colors.cyan}1${colors.reset}) Claude Desktop / Cline / Continue / Cursor`);
  console.log(`  ${colors.cyan}2${colors.reset}) ChatGPT ${colors.dim}(requires public URL)${colors.reset}`);
  console.log(`  ${colors.cyan}3${colors.reset}) Gemini CLI`);
  console.log(`  ${colors.cyan}4${colors.reset}) Just start the server`);
  console.log();

  const choice = await askQuestion(`Enter choice ${colors.dim}[1-4]${colors.reset}: `);

  if (choice === '2' || choice === 'chatgpt') {
    await handleChatGPTSetup();

  } else if (choice === '1' || choice === 'claude') {
    logHeader('Starting Server for Claude Desktop');

    console.log();
    log('Add this to your Claude Desktop config file:', colors.bright);
    console.log();
    log(`  macOS: ~/Library/Application Support/Claude/claude_desktop_config.json`, colors.dim);
    log(`  Windows: %APPDATA%\\Claude\\claude_desktop_config.json`, colors.dim);
    log(`  Linux: ~/.config/Claude/claude_desktop_config.json`, colors.dim);
    console.log();

    console.log(`${colors.cyan}{
  "mcpServers": {
    "llm-browser-bot": {
      "command": "npx",
      "args": ["-y", "llm-browser-bot", "bridge"]
    }
  }
}${colors.reset}`);

    console.log();
    logInfo('Local Server', `http://localhost:${PORT}`);
    logInfo('MCP WebSocket', `ws://localhost:${PORT}/mcp`);
    console.log();

    log('Starting server...', colors.yellow);
    console.log();

    await startServer();

  } else if (choice === '3' || choice === 'gemini') {
    logHeader('Starting Server for Gemini CLI');

    console.log();
    log('Configure Gemini CLI to use this MCP server:', colors.bright);
    console.log();
    logInfo('MCP WebSocket', `ws://localhost:${PORT}/mcp`);
    console.log();
    log('See: https://geminicli.com/docs/tools/mcp-server/', colors.dim);
    console.log();

    log('Starting server...', colors.yellow);
    console.log();

    await startServer();

  } else {
    logHeader('Starting LLM Browser Bot Server');

    logInfo('Server', `http://localhost:${PORT}`);
    logInfo('MCP WebSocket', `ws://localhost:${PORT}/mcp`);
    console.log();

    await startServer();
  }
}

main().catch(error => {
  log(`Fatal error: ${error.message}`, colors.red);
  process.exit(1);
});
