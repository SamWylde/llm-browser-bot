#!/usr/bin/env node

import { WebSocketServer } from 'ws';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { TabRegistry } from './tab-registry.js';
import { BrowserWebSocketManager } from './browser-websocket-manager.js';
import { BrowserCommandHandler } from './browser-command-handler.js';
import { MCPServerManager } from './mcp-server-manager.js';
import { logger } from './logger.js';
import { ResourceHandler } from './resource-handler.js';
import { ToolHandler } from './tool-handler.js';
import { checkIfPortInUse } from './port-check.js';
import { detectAssistants, configureAssistants } from './assistant-manager.js';


// ========================================================================
// Constants and Configuration
// ========================================================================

// Set process title for better identification
process.title = 'LLM Browser Bot Server';

// Fixed port for all connections
const PORT = 61822;

// Get directory path for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ========================================================================
// Core Component Initialization
// ========================================================================

// Initialize registries and managers
const tabRegistry = new TabRegistry();
const wss = new WebSocketServer({ noServer: true });
const browserWebSocketManager = new BrowserWebSocketManager(wss, tabRegistry);
const commandHandler = new BrowserCommandHandler(browserWebSocketManager, tabRegistry);

// Connect browser responses to command handler
browserWebSocketManager.setResponseHandler((response) => {
  commandHandler.handleCommandResponse(response);
});

// ========================================================================
// MCP Handlers Initialization
// ========================================================================

// Initialize handlers
const toolHandler = new ToolHandler(commandHandler, tabRegistry);
const resourceHandler = new ResourceHandler(tabRegistry, toolHandler);

// ========================================================================
// MCP Server Manager Initialization
// ========================================================================

// Initialize MCP Server Manager with all dependencies
const mcpServerManager = new MCPServerManager(
  browserWebSocketManager,
  tabRegistry,
  commandHandler,
  resourceHandler,
  toolHandler
);

// ========================================================================
// HTTP Server Setup
// ========================================================================

const MCP_REQUIRED_ACCEPTS = ['application/json', 'text/event-stream'];

function normalizeMcpAcceptHeader(req: IncomingMessage): void {
  const rawHeader = req.headers['accept'];
  const acceptHeader = Array.isArray(rawHeader) ? rawHeader.join(',') : rawHeader;
  const normalizedHeader = acceptHeader?.toLowerCase() ?? '';

  if (!acceptHeader || normalizedHeader.includes('*/*')) {
    req.headers['accept'] = MCP_REQUIRED_ACCEPTS.join(', ');
    return;
  }

  const missing = MCP_REQUIRED_ACCEPTS.filter(value => !normalizedHeader.includes(value));
  if (missing.length === 0) {
    return;
  }

  req.headers['accept'] = `${acceptHeader}, ${missing.join(', ')}`;
}

const httpServer = createServer(async (req, res) => {
  // Enable CORS for all endpoints
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Mcp-Session-Timeout, Last-Event-ID');
  // CRITICAL: Expose Mcp-Session-Id to clients - without this, clients can't read the session ID and fail with "Server not initialized"
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Root endpoint - Server discovery and status
  if (req.url === '/' && req.method === 'GET') {
    // Check for SSE request (Accept header)
    const acceptHeader = req.headers['accept'] || '';
    if (acceptHeader.includes('text/event-stream')) {
      await mcpServerManager.connectSSE(req, res);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });

    const connections = mcpServerManager.getConnectionInfo();
    res.end(JSON.stringify(connections));
    return;
  }

  // Health/diagnostics endpoint
  if ((req.url === '/health' || req.url === '/status') && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mcpServerManager.getDiagnostics()));
    return;
  }

  // SSE Endpoint
  if (req.url === '/sse' && req.method === 'GET') {
    await mcpServerManager.connectSSE(req, res);
    return;
  }

  // SSE Messages Endpoint
  if (req.url && req.url.startsWith('/messages') && req.method === 'POST') {
    await mcpServerManager.handleSSEMessage(req, res);
    return;
  }

  // Serve test.html
  if (req.url && req.url.startsWith('/test.html') && req.method === 'GET') {
    try {
      const testPath = join(__dirname, '..', 'test.html');
      const content = await readFile(testPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
    } catch (error) {
      logger.error('Error serving test.html:', error);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('test.html not found');
    }
    return;
  }

  // Serve welcome.html
  if (req.url === '/welcome' && req.method === 'GET') {
    try {
      const welcomePath = join(__dirname, '..', 'static', 'welcome.html');
      const content = await readFile(welcomePath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
    } catch (error) {
      logger.error('Error serving welcome.html:', error);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('welcome.html not found');
    }
    return;
  }

  // Handle /assistants endpoint
  if (req.url === '/assistants' && req.method === 'GET') {
    try {
      const assistants = detectAssistants();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(assistants));
    } catch (error) {
      logger.error('Error detecting assistants:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to detect assistants' }));
    }
    return;
  }

  // Handle /assistants/configure endpoint
  if (req.url === '/assistants/configure' && req.method === 'POST') {
    try {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', () => {
        try {
          const assistantsToConfig = JSON.parse(body);
          const results = configureAssistants(assistantsToConfig);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(results));
        } catch (error: any) {
          logger.error('Error configuring assistants:', error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
    } catch (error) {
      logger.error('Error handling configure request:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to configure assistants' }));
    }
    return;
  }

  // Handle /mcp endpoint for Streamable HTTP (ChatGPT, etc.)
  if (req.url === '/mcp' && (req.method === 'POST' || req.method === 'GET' || req.method === 'DELETE')) {
    try {
      if (req.method === 'GET' || req.method === 'POST') {
        normalizeMcpAcceptHeader(req);
      }
      await mcpServerManager.handleHttpRequest(req, res);
    } catch (error) {
      logger.error('Error handling MCP HTTP request:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    }
    return;
  }

  // All other endpoints delegate to resource handler
  if (req.url && req.method === 'GET') {
    try {
      // Convert HTTP URL to kapture:// URI
      let kaptureUri = req.url.substring(1); // Remove leading slash
      const isScreenshotView = kaptureUri.includes('/screenshot/view')

      // Special case for tabs endpoint
      if (kaptureUri === 'tabs') {
        kaptureUri = 'kapture://tabs';
      } else if (kaptureUri.startsWith('tab/')) {
        kaptureUri = 'kapture://' + kaptureUri.replace('/screenshot/view', '/screenshot');
      } else {
        // Unknown endpoint
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      const { isError, contents } = await resourceHandler.readResource(kaptureUri);

      // Special handling for screenshot/view endpoint
      if (!isError && isScreenshotView) {
        // Send image instead of JSON
        const content1 = contents[1];
        const imageBuffer = Buffer.from(content1.blob, 'base64');
        res.writeHead(200, { 'Content-Type': content1.mimeType });
        res.end(imageBuffer);
      }
      else {
        let result = contents[0].text;
        if (!isError && kaptureUri.includes('/screenshot')) {
          // move the image data to the first object
          const reslutObj = JSON.parse(contents[0].text);
          result = JSON.stringify({
            ...reslutObj,
            mimeType: contents[1].mimeType,
            data: contents[1].blob
          });
        }
        // Regular resource endpoints
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(result);
      }
    } catch (error: any) {
      logger.error('Error handling HTTP endpoint:', error);
      res.writeHead(error.message.includes('not found') ? 404 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // 404 for non-GET methods
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// HTTP server error handling
httpServer.on('error', (error) => {
  logger.error('HTTP server error:', error);
  process.exit(1);
});

// ========================================================================
// WebSocket Setup
// ========================================================================

// Handle WebSocket upgrade requests
httpServer.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Route WebSocket connections
wss.on('connection', (ws, request) => {
  const url = request.url || '';

  if (url === '/mcp') {
    // MCP client connection
    mcpServerManager.connectWebSocket(ws).catch(error => {
      logger.error('Failed to connect MCP WebSocket:', error);
      ws.close();
    });
  }
  // Browser extension connections are handled automatically by browserWebSocketManager
});

// ========================================================================
// Server Startup
// ========================================================================

/**
 * Start the HTTP server and log available endpoints
 */
async function startServer() {
  await checkIfPortInUse(PORT);

  httpServer.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('LLM Browser Bot Server Started');
    console.log('='.repeat(60));
    console.log();
    console.log('  MCP Endpoint: http://localhost:' + PORT + '/mcp');
    console.log();
    console.log('  For ChatGPT: Use your tunnel URL + /mcp');
    console.log('  Example: https://your-tunnel.ngrok-free.dev/mcp');
    console.log();
    console.log('='.repeat(60));
  });
}

// ========================================================================
// Shutdown Handling
// ========================================================================

process.on('SIGINT', () => {
  logger.log('\nReceived SIGINT - shutting down gracefully...');

  // Clean up in reverse order of initialization
  commandHandler.cleanup();
  browserWebSocketManager.shutdown();

  httpServer.close(() => {
    logger.log('Server shutdown complete');
    process.exit(0);
  });

  // Force exit after timeout
  setTimeout(() => {
    logger.error('Shutdown timeout - forcing exit');
    process.exit(0);
  }, 5000);
});

// ========================================================================
// Start the server
// ========================================================================

startServer();
