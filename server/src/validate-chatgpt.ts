#!/usr/bin/env node

import * as readline from 'readline';

const DEFAULT_TIMEOUT_MS = 10_000;

function log(message: string) {
  console.log(message);
}

function logError(message: string) {
  console.error(message);
}

async function askQuestion(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function normalizeBaseUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);
    return url;
  } catch {
    return null;
  }
}

function ensureMcpUrl(baseUrl: URL): URL {
  const mcpUrl = new URL(baseUrl.toString());
  if (!mcpUrl.pathname.endsWith('/mcp')) {
    mcpUrl.pathname = mcpUrl.pathname.replace(/\/$/, '') + '/mcp';
  }
  return mcpUrl;
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function validateChatGPT(baseUrlInput: string) {
  const baseUrl = normalizeBaseUrl(baseUrlInput);
  if (!baseUrl) {
    logError('Invalid URL. Provide an https:// tunnel URL (for example https://abc123.loca.lt).');
    process.exit(1);
  }

  if (baseUrl.protocol !== 'https:') {
    logError('ChatGPT requires HTTPS. Please use an https:// tunnel URL.');
    process.exit(1);
  }

  const healthUrl = new URL('/health', baseUrl);
  const mcpUrl = ensureMcpUrl(baseUrl);

  log(`Checking health endpoint: ${healthUrl.toString()}`);
  try {
    const healthResponse = await fetchWithTimeout(
      healthUrl.toString(),
      { method: 'GET', headers: { Accept: 'application/json' } },
      DEFAULT_TIMEOUT_MS
    );
    log(`Health status: ${healthResponse.status} ${healthResponse.statusText}`);
  } catch (error: any) {
    logError(`Health check failed: ${error?.message ?? error}`);
  }

  log(`Checking MCP endpoint: ${mcpUrl.toString()}`);
  try {
    const mcpResponse = await fetchWithTimeout(
      mcpUrl.toString(),
      {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/event-stream'
        }
      },
      DEFAULT_TIMEOUT_MS
    );
    log(`MCP GET status: ${mcpResponse.status} ${mcpResponse.statusText}`);
    const contentType = mcpResponse.headers.get('content-type');
    if (contentType) {
      log(`MCP GET content-type: ${contentType}`);
    }
  } catch (error: any) {
    logError(`MCP GET failed: ${error?.message ?? error}`);
  }

  log('Validation complete. If MCP GET returned 200 and health is reachable, ChatGPT should be able to connect.');
}

async function main() {
  const input = process.argv[2] ?? await askQuestion('Enter your public HTTPS tunnel URL: ');
  await validateChatGPT(input);
}

main().catch((error) => {
  logError(`Fatal error: ${error?.message ?? error}`);
  process.exit(1);
});
