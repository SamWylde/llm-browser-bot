import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { WebSocketTransport } from './websocket-transport.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  InitializeRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { WebSocket } from 'ws';
import { IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { logger } from './logger.js';
import { TabRegistry } from './tab-registry.js';
import { BrowserWebSocketManager } from './browser-websocket-manager.js';
import { BrowserCommandHandler } from './browser-command-handler.js';
import { baseResources, createTabResources } from './yaml-loader.js';
import type { ResourceHandler } from './resource-handler.js';
import type { ToolHandler } from './tool-handler.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try multiple paths to find package.json
let packageJson: any = { name: 'kapture-mcp', version: 'unknown' };
const possiblePaths = [
  join(__dirname, '../../package.json'), // Development path
  join(__dirname, '../package.json'),    // Compiled distribution path
  join(__dirname, 'package.json'),       // Same directory (edge case)
];

for (const path of possiblePaths) {
  if (existsSync(path)) {
    try {
      packageJson = JSON.parse(readFileSync(path, 'utf-8'));
      break;
    } catch (error) {
      // Continue to next path
    }
  }
}

const SERVER_NAME = packageJson.name;
const SERVER_VERSION = packageJson.version;
const SERVER_INFO = {
  name: SERVER_NAME,
  version: SERVER_VERSION
};

interface MCPConnectionMetrics {
  createdAt: number;
  lastActivityAt: number;
  lastRequestAt?: number;
  protocolVersion?: string;
  clientInfoUpdatedAt?: number;
}

interface HttpSessionInfo {
  sessionId: string;
  connectionId: string;
  createdAt: number;
  lastActivityAt: number;
  timeoutMs: number;
}

interface MCPConnection {
  id: string;
  server: Server;
  type: 'websocket' | 'sse' | 'http';
  transport?: SSEServerTransport | StreamableHTTPServerTransport;
  clientInfo?: { name?: string; version?: string };
  initialized: boolean;
  metrics: MCPConnectionMetrics;
}

export class MCPServerManager {
  private connections: Map<string, MCPConnection> = new Map();
  private dynamicTabResources: Map<string, any> = new Map();
  private httpSessions: Map<string, HttpSessionInfo> = new Map();
  private sseSessions: Map<string, MCPConnection> = new Map();
  private httpSessionCleanupTimer?: NodeJS.Timeout;
  private readonly defaultHttpSessionTimeoutMs = 30 * 60 * 1000;

  constructor(
    private browserWebSocketManager: BrowserWebSocketManager,
    private tabRegistry: TabRegistry,
    private commandHandler: BrowserCommandHandler,
    private resourceHandler: ResourceHandler,
    private toolHandler: ToolHandler
  ) {
    // Set up tab callbacks
    this.setupTabCallbacks();
    this.httpSessionCleanupTimer = setInterval(() => {
      this.cleanupHttpSessions();
    }, 60_000);
    this.httpSessionCleanupTimer.unref?.();
  }

  private setupTabCallbacks(): void {
    // Tab connect callback
    this.tabRegistry.setConnectCallback(async (tabId: string) => {
      const tab = this.tabRegistry.get(tabId);
      logger.log(`New ${tab?.browser} tab: ${tabId}`);
      const tabTitle = tab?.title || `Tab ${tabId}`;

      this.updateTabResources(tabId, tabTitle);

      // Send notifications to all initialized connections
      await this.notifyAllConnections(async (connection) => {
        await connection.server.notification({
          method: 'notifications/resources/list_changed',
          params: {}
        });
      });

      await this.sendTabListChangeNotification();
    });

    // Tab update callback
    this.tabRegistry.setUpdateCallback(async (tabId: string) => {
      logger.log(`Tab updated: ${tabId}`);

      if (this.dynamicTabResources.has(tabId)) {
        const tab = this.tabRegistry.get(tabId);
        const tabTitle = tab?.title || `Tab ${tabId}`;

        this.updateTabResources(tabId, tabTitle);

        await this.notifyAllConnections(async (connection) => {
          await connection.server.notification({
            method: 'notifications/resources/list_changed',
            params: {}
          });
        });
      }

      await this.sendTabListChangeNotification();
    });

    // Tab disconnect callback
    this.tabRegistry.setDisconnectCallback(async (tabId: string) => {
      // Remove dynamic resources
      this.dynamicTabResources.delete(tabId);
      this.dynamicTabResources.delete(`${tabId}/console`);
      this.dynamicTabResources.delete(`${tabId}/screenshot`);
      this.dynamicTabResources.delete(`${tabId}/elements_from_point`);
      this.dynamicTabResources.delete(`${tabId}/dom`);
      this.dynamicTabResources.delete(`${tabId}/elements`);

      // Send notifications to all initialized connections
      await this.notifyAllConnections(async (connection) => {
        await connection.server.notification({
          method: 'notifications/resources/list_changed',
          params: {}
        });

        await connection.server.notification({
          method: 'kapture/tab_disconnected',
          params: {
            tabId,
            timestamp: Date.now()
          }
        });
      });

      await this.sendTabListChangeNotification();
    });

    // Set up console log handler
    this.browserWebSocketManager.setConsoleLogHandler(async (tabId: string, logEntry: any) => {
      await this.notifyAllConnections(async (connection) => {
        await connection.server.notification({
          method: 'kapture/console_log',
          params: {
            tabId,
            logEntry,
            timestamp: Date.now()
          }
        });
      });
    });
  }

  private updateTabResources(tabId: string, tabTitle: string): void {
    const tabResources = createTabResources(tabId, tabTitle);

    // Add all resources for this tab
    for (const [key, resource] of tabResources) {
      this.dynamicTabResources.set(key, resource);
    }
  }

  private touchConnection(connectionId: string, updates: Partial<MCPConnectionMetrics> = {}): void {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }
    connection.metrics = {
      ...connection.metrics,
      ...updates,
      lastActivityAt: updates.lastActivityAt ?? Date.now()
    };
  }

  private parseSessionTimeout(headerValue: string | undefined): number | undefined {
    if (!headerValue) {
      return undefined;
    }

    const parsed = Number(headerValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return undefined;
    }

    if (parsed < 1000) {
      return parsed * 1000;
    }

    return parsed;
  }

  private cleanupHttpSessions(): void {
    const now = Date.now();
    for (const [sessionId, info] of this.httpSessions) {
      if (now - info.lastActivityAt > info.timeoutMs) {
        logger.warn('HTTP session expired', {
          sessionId,
          connectionId: info.connectionId,
          idleMs: now - info.lastActivityAt,
          timeoutMs: info.timeoutMs
        });
        this.httpSessions.delete(sessionId);
        this.connections.delete(info.connectionId);
      }
    }
  }

  private buildRequestContext(req: IncomingMessage) {
    return {
      url: req.url,
      method: req.method,
      remoteAddress: req.socket?.remoteAddress,
      headers: {
        accept: req.headers['accept'],
        'mcp-session-id': req.headers['mcp-session-id'],
        'mcp-protocol-version': req.headers['mcp-protocol-version'],
        'mcp-session-timeout': req.headers['mcp-session-timeout'],
        'user-agent': req.headers['user-agent']
      }
    };
  }

  private async notifyAllConnections(handler: (connection: MCPConnection) => Promise<void>): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const connection of this.connections.values()) {
      if (connection.initialized) {
        this.touchConnection(connection.id, { lastRequestAt: Date.now() });
        promises.push(
          handler(connection).catch(error => {
            logger.error(`Failed to notify connection ${connection.id}:`, error);
          })
        );
      }
    }

    await Promise.all(promises);
  }

  private async sendTabListChangeNotification(): Promise<void> {
    const tabs = this.tabRegistry.getAll().map(tab => ({
      tabId: tab.tabId,
      url: tab.url,
      title: tab.title,
      connectedAt: tab.connectedAt,
      lastPing: tab.lastPing,
      domSize: tab.domSize,
      fullPageDimensions: tab.fullPageDimensions,
      viewportDimensions: tab.viewportDimensions,
      scrollPosition: tab.scrollPosition,
      pageVisibility: tab.pageVisibility
    }));

    await this.notifyAllConnections(async (connection) => {
      await connection.server.notification({
        method: 'kapture/tabs_changed',
        params: {
          tabs,
          timestamp: Date.now()
        }
      });
    });
  }

  private createMCPServer(connectionId: string): Server {
    const server = new Server(
      SERVER_INFO,
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    // Initialize handler
    server.setRequestHandler(InitializeRequestSchema, async (request) => {
      const connection = this.connections.get(connectionId);
      if (!connection) {
        throw new Error('Connection not found');
      }

      if (request.params.clientInfo) {
        connection.clientInfo = request.params.clientInfo;
        connection.metrics.clientInfoUpdatedAt = Date.now();
        logger.log(`MCP client connected (${connectionId}): ${connection.clientInfo.name} v${connection.clientInfo.version}`);

        this.commandHandler.setClientInfo(connection.clientInfo);
        this.browserWebSocketManager.setMcpClientInfo(connection.clientInfo);
      }
      connection.metrics.protocolVersion = request.params.protocolVersion;
      this.touchConnection(connectionId, { lastRequestAt: Date.now() });

      return {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          resources: {}
        },
        serverInfo: SERVER_INFO
      };
    });

    // Handle initialized notification
    server.oninitialized = () => {
      const connection = this.connections.get(connectionId);
      if (connection) {
        logger.log(`Client initialized (${connectionId})`);
        connection.initialized = true;
        this.touchConnection(connectionId);

        // Send initial notifications if tabs are connected
        if (this.tabRegistry.getAll().length > 0) {
          this.sendTabListChangeNotification().catch(error => {
            logger.error('Failed to send initial tabs notification:', error);
          });
        }
      }
    };

    // List tools handler
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: this.toolHandler.getTools()
      };
    });

    // Call tool handler
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      return this.toolHandler.callTool(name, args);
    });

    // List resources handler
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const allResources = [
        ...baseResources,
        ...Array.from(this.dynamicTabResources.values())
      ];

      return {
        resources: allResources
      };
    });

    // Read resource handler
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      return await this.resourceHandler.readResource(uri);
    });


    // Handle server close
    server.onclose = () => {
      logger.log(`MCP server connection closed (${connectionId})`);
    };

    return server;
  }

  async connectWebSocket(ws: WebSocket): Promise<void> {
    const connectionId = `ws-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const server = this.createMCPServer(connectionId);

    this.connections.set(connectionId, {
      id: connectionId,
      server,
      type: 'websocket',
      initialized: false,
      metrics: {
        createdAt: Date.now(),
        lastActivityAt: Date.now()
      }
    });

    const transport = new WebSocketTransport(ws);

    try {
      await server.connect(transport);
      // logger.log(`MCP WebSocket server connected (${connectionId})`);
    } catch (error) {
      logger.error(`Failed to connect MCP WebSocket server (${connectionId}):`, error);
      this.connections.delete(connectionId);
      ws.close();
    }

    // Clean up on close
    ws.on('close', () => {
      logger.log(`MCP WebSocket client disconnected (${connectionId})`);
      this.connections.delete(connectionId);
    });
  }

  async connectSSE(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const connectionId = `sse-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    logger.log('New SSE connection request', {
      connectionId,
      ...this.buildRequestContext(req)
    });

    const transport = new SSEServerTransport('/messages', res);
    const server = this.createMCPServer(connectionId);

    this.connections.set(connectionId, {
      id: connectionId,
      server,
      type: 'sse',
      transport,
      initialized: false,
      metrics: {
        createdAt: Date.now(),
        lastActivityAt: Date.now()
      }
    });

    try {
      await server.connect(transport);
      if (transport.sessionId) {
        this.sseSessions.set(transport.sessionId, this.connections.get(connectionId)!);
        logger.log('SSE session initialized', {
          connectionId,
          sessionId: transport.sessionId
        });
      } else {
        logger.warn('SSE transport missing sessionId after connect', { connectionId });
      }

      // Clean up on close if possible (SSE is harder to detect disconnects without keepalive failures)
      // handling close is mostly done via the transport logic or if write fails
      req.on('close', () => {
        logger.log(`SSE client disconnected (${connectionId})`);
        if (transport.sessionId) {
          this.sseSessions.delete(transport.sessionId);
        }
        this.connections.delete(connectionId);
      });

    } catch (error) {
      logger.error(`Failed to connect MCP SSE server (${connectionId}):`, error);
      this.connections.delete(connectionId);
      res.end(); // Ensure response is closed if error
    }
  }

  async handleSSEMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // For SSE, the transport handles the POST messages
    // The request should contain a sessionId query param or we need to map requests to the right transport
    // The SDK's SSEServerTransport.handlePostMessage handles this if we pass it the request.
    // BUT, we need to find the RIGHT transport.
    // The standard MCP SSE pattern usually involves the client sending a sessionId in the query param
    // however, SSEServerTransport implementation details vary.
    // Checking SDK source: handlePostMessage(req, res, message?)
    // If the transport instance is known (e.g. from the session ID), we call handlePostMessage on it.

    // In strict MCP SSE, the GET /sse response includes a session ID (often in the URL or body, but SSE establishes it)
    // Actually, distinct from the initial connection, the client sends POST requests.
    // We need to parse the sessionId from the query string ?sessionId=...

    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');

    if (!sessionId) {
      // If no session ID, we can't route it. 
      // Note: The SDK's SSEServerTransport generates a session ID and sends it in the 'endpoint' event or similar?
      // Let's look at how we initialized SSEServerTransport.
      // new SSEServerTransport('/messages', res)
      // It likely expects POSTs to /messages?sessionId=...
      logger.error('Received SSE message without sessionId', this.buildRequestContext(req));
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing sessionId' }));
      return;
    }

    // Find the connection with this transport session ID
    // Wait, the transport maintains the session ID. We need to iterate or lookup.
    let targetConnection: MCPConnection | undefined;
    targetConnection = this.sseSessions.get(sessionId);

    if (!targetConnection) {
      for (const conn of this.connections.values()) {
        if (conn.type === 'sse' && conn.transport && conn.transport.sessionId === sessionId) {
          targetConnection = conn;
          this.sseSessions.set(sessionId, conn);
          break;
        }
      }
    }

    if (!targetConnection || !targetConnection.transport) {
      logger.error('SSE session not found', {
        sessionId,
        knownSessions: this.sseSessions.size,
        ...this.buildRequestContext(req)
      });
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found', sessionId }));
      return;
    }

    this.touchConnection(targetConnection.id, { lastRequestAt: Date.now() });
    await (targetConnection.transport as SSEServerTransport).handlePostMessage(req, res);
  }

  // Used to show the connected MCP clients at http://localhost:61822/
  getConnectionInfo(): Array<{ id: string; type: string; clientInfo?: any; initialized: boolean }> {
    return Array.from(this.connections.values()).map(conn => ({
      id: conn.id,
      type: conn.type,
      clientInfo: conn.clientInfo,
      initialized: conn.initialized
    }));
  }

  getDiagnostics() {
    const now = Date.now();
    const connections = Array.from(this.connections.values()).map(conn => ({
      id: conn.id,
      type: conn.type,
      initialized: conn.initialized,
      clientInfo: conn.clientInfo,
      sessionId: conn.transport?.sessionId,
      metrics: {
        ...conn.metrics,
        idleMs: now - conn.metrics.lastActivityAt
      }
    }));

    const httpSessions = Array.from(this.httpSessions.values()).map(session => ({
      sessionId: session.sessionId,
      connectionId: session.connectionId,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      idleMs: now - session.lastActivityAt,
      timeoutMs: session.timeoutMs
    }));

    const tabs = this.tabRegistry.getAll().map(tab => ({
      tabId: tab.tabId,
      url: tab.url,
      title: tab.title,
      connectedAt: tab.connectedAt
    }));

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeMs: Math.round(process.uptime() * 1000),
      connections: {
        total: this.connections.size,
        websocket: connections.filter(conn => conn.type === 'websocket').length,
        sse: connections.filter(conn => conn.type === 'sse').length,
        http: connections.filter(conn => conn.type === 'http').length,
        initialized: connections.filter(conn => conn.initialized).length,
        details: connections
      },
      sessions: {
        sse: {
          total: this.sseSessions.size,
          sessionIds: Array.from(this.sseSessions.keys())
        },
        http: {
          total: this.httpSessions.size,
          defaultTimeoutMs: this.defaultHttpSessionTimeoutMs,
          details: httpSessions
        }
      },
      tabs: {
        total: tabs.length,
        details: tabs
      }
    };
  }

  /**
   * Handle HTTP requests for Streamable HTTP transport (ChatGPT, etc.)
   */
  async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Check for existing session
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && this.httpSessions.has(sessionId)) {
      // Existing session - use existing transport
      const sessionInfo = this.httpSessions.get(sessionId)!;
      const connection = this.connections.get(sessionInfo.connectionId);
      if (connection?.transport) {
        sessionInfo.lastActivityAt = Date.now();
        this.touchConnection(connection.id, { lastRequestAt: Date.now() });
        // Parse body for POST requests
        if (req.method === 'POST') {
          const body = await this.parseRequestBody(req);
          await (connection.transport as StreamableHTTPServerTransport).handleRequest(req, res, body);
        } else {
          await (connection.transport as StreamableHTTPServerTransport).handleRequest(req, res);
        }
      } else {
        logger.warn('HTTP session found without active connection', {
          sessionId,
          connectionId: sessionInfo.connectionId
        });
        this.httpSessions.delete(sessionId);
      }
      return;
    }

    if (sessionId && !this.httpSessions.has(sessionId)) {
      logger.warn('HTTP request with unknown session', {
        sessionId,
        ...this.buildRequestContext(req)
      });
    }

    if (!req.headers['mcp-protocol-version']) {
      logger.warn('HTTP request missing mcp-protocol-version header - Shiming it', this.buildRequestContext(req));
      req.headers['mcp-protocol-version'] = '2024-11-05';
    }

    // New session - create new transport and server
    const connectionId = `http-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const server = this.createMCPServer(connectionId);
    const timeoutHeader = this.parseSessionTimeout(req.headers['mcp-session-timeout'] as string | undefined);
    const sessionTimeoutMs = timeoutHeader ?? this.defaultHttpSessionTimeoutMs;

    logger.log('Initializing HTTP MCP session', {
      connectionId,
      timeoutMs: sessionTimeoutMs,
      ...this.buildRequestContext(req)
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: false, // Use SSE for streaming
      onsessioninitialized: (newSessionId: string) => {
        // Store the session for future requests
        const conn = this.connections.get(connectionId);
        if (conn) {
          this.httpSessions.set(newSessionId, {
            sessionId: newSessionId,
            connectionId,
            createdAt: Date.now(),
            lastActivityAt: Date.now(),
            timeoutMs: sessionTimeoutMs
          });
          logger.log('HTTP session initialized', {
            sessionId: newSessionId,
            connectionId,
            timeoutMs: sessionTimeoutMs
          });
        }
      }
    });

    const connection: MCPConnection = {
      id: connectionId,
      server,
      type: 'http',
      transport,
      initialized: false,
      metrics: {
        createdAt: Date.now(),
        lastActivityAt: Date.now()
      }
    };

    this.connections.set(connectionId, connection);

    // Connect server to transport
    try {
      await server.connect(transport);
      logger.log(`MCP HTTP server connected (${connectionId})`);
    } catch (error) {
      logger.error(`Failed to connect MCP HTTP server (${connectionId}):`, error);
      this.connections.delete(connectionId);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to initialize MCP server' }));
      return;
    }

    // Handle cleanup when transport closes
    transport.onclose = () => {
      logger.log(`MCP HTTP client disconnected (${connectionId})`);
      // Clean up session
      if (transport.sessionId) {
        this.httpSessions.delete(transport.sessionId);
      }
      this.connections.delete(connectionId);
    };

    // Intercept response to debug 400 errors
    const originalWriteHead = res.writeHead;
    const originalEnd = res.end;

    res.writeHead = function (statusCode: number, ...args: any[]) {
      if (statusCode >= 400) {
        logger.error(`Debug: Caught ${statusCode} response for ${connectionId}`);
      }
      return originalWriteHead.apply(res, [statusCode, ...args]);
    };

    res.end = function (chunk: any, ...args: any[]) {
      if (chunk && chunk.toString().includes('error')) {
        logger.error(`Debug: Response body for ${connectionId}: ${chunk.toString()}`);
      }
      return originalEnd.apply(res, [chunk, ...args]);
    };

    try {
      if (req.method === 'POST') {
        const body = await this.parseRequestBody(req);
        await transport.handleRequest(req, res, body);
      } else {
        await transport.handleRequest(req, res);
      }
    } catch (err: any) {
      logger.error('Error in transport.handleRequest:', err);
      // Restore original methods just in case
      res.writeHead = originalWriteHead;
      res.end = originalEnd;
      if (!res.headersSent) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    }
  }

  private parseRequestBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : undefined);
        } catch (error) {
          reject(new Error('Invalid JSON body'));
        }
      });
      req.on('error', reject);
    });
  }
}
