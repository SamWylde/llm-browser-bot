import { BrowserCommandHandler } from './browser-command-handler.js';
import { TabRegistry } from './tab-registry.js';
import { allTools } from './yaml-loader.js';
import { formatTabDetail } from './tab-utils.js';
import { TabConnection } from './tab-registry.js';

const PROTECTED_HOSTS = new Set([
  'chat.openai.com',
  'chatgpt.com'
]);

function isProtectedChatTab(url?: string): boolean {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return PROTECTED_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

function getProtectedTabHint(url?: string): string | null {
  if (!isProtectedChatTab(url)) return null;
  return 'Active tab appears to be ChatGPT. To avoid hijacking the user chat, open a fresh automation tab with new_tab and use that tabId instead.';
}

function findFallbackTab(tabs: TabConnection[], activeTab?: TabConnection): TabConnection | undefined {
  const safeTabs = tabs.filter(tab => !isProtectedChatTab(tab.url));
  if (!activeTab?.browserInstanceId) {
    return safeTabs[0];
  }
  return safeTabs.find(tab => tab.browserInstanceId && tab.browserInstanceId !== activeTab.browserInstanceId)
    ?? safeTabs[0];
}

function getProtectedTabHintWithFallback(activeTab?: TabConnection, fallbackTab?: TabConnection): string | null {
  if (!activeTab || !isProtectedChatTab(activeTab.url)) return null;
  if (fallbackTab) {
    return `Active tab appears to be ChatGPT. Use tab ${fallbackTab.tabId} (${fallbackTab.title || fallbackTab.url || 'untitled'}) for automation, or open a fresh tab with new_tab.`;
  }
  return getProtectedTabHint(activeTab.url);
}

export class ToolHandler {
  constructor(
    private commandHandler: BrowserCommandHandler,
    private tabRegistry: TabRegistry
  ) { }


  public getTools() {
    return allTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: (tool as any).jsonSchema || tool.inputSchema
    }));
  }

  public async callTool(name: string, args: any): Promise<any> {
    const tool = allTools.find(t => t.name === name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    try {
      // For tools without arguments, use empty object
      const validatedArgs = tool.inputSchema.parse(args || {}) as any;

      // Check for invalid :contains() pseudo-selector
      if (validatedArgs.selector && validatedArgs.selector.includes(':contains(')) {
        throw new Error('The :contains() pseudo-selector is not valid CSS and is not supported by browsers. Use contains() selector with the `xpath` property instead!');
      }

      // Handle special cases that don't go through the command handler
      let result: any;
      switch (name) {
        case 'list_tabs':
          try {
            // Try to get all tabs from the browser (requires at least one connected tab)
            const browserTabs = await this.commandHandler.getAllBrowserTabs();

            // Map browser tabs to our format and check connection status
            if (browserTabs && Array.isArray(browserTabs)) {
              const connectedTabIds = new Set(this.tabRegistry.getAll().map(t => t.tabId));
              const allTabs = browserTabs.map((t: any) => {
                const isChatGPT = isProtectedChatTab(t.url);
                return {
                  tabId: t.id.toString(),
                  title: t.title,
                  url: t.url,
                  active: t.active,
                  connected: connectedTabIds.has(t.id.toString()),
                  automationSafe: !isChatGPT && connectedTabIds.has(t.id.toString())
                };
              });

              // Find recommended automation tab
              const safeTabs = allTabs.filter((t: any) => t.automationSafe);
              const activeTab = allTabs.find((tab: any) => tab.active);

              result = { tabs: allTabs };

              // Build helpful hint for LLM
              if (connectedTabIds.size === 0) {
                result.hint = 'No tabs are connected to the server. Use new_tab to create an automation tab.';
              } else if (safeTabs.length === 0) {
                result.hint = 'No safe automation tabs available. Use new_tab to create one.';
              } else if (isProtectedChatTab(activeTab?.url)) {
                const recommended = safeTabs[0];
                result.hint = `Active tab is ChatGPT - do NOT automate it. Use tabId "${recommended.tabId}" (${recommended.title || recommended.url}) for automation.`;
                result.recommendedTabId = recommended.tabId;
              } else {
                const connectedCount = allTabs.filter((t: any) => t.connected).length;
                result.hint = `${connectedCount} tab(s) connected. Tabs with automationSafe=true are ready for automation.`;
              }
            } else {
              // Fallback to registry if command failed or returned invalid data
              const tabs = this.tabRegistry.getAll().map(tab => ({
                ...formatTabDetail(tab),
                connected: true,
                automationSafe: !isProtectedChatTab(tab.url)
              }));
              result = { tabs };
            }
          } catch (e) {
            // Fallback if bridge command fails (e.g. timeout)
            const tabs = this.tabRegistry.getAll().map(tab => ({
              ...formatTabDetail(tab),
              connected: true,
              automationSafe: !isProtectedChatTab(tab.url)
            }));
            result = { tabs };
          }

          if (result.tabs.length === 0) {
            result.hint = 'No tabs connected. Use new_tab to create an automation tab!';
          }
          break;
        case 'tab_detail':
          const tab = this.tabRegistry.get(validatedArgs.tabId);
          if (!tab) {
            throw new Error(`Tab ${validatedArgs.tabId} not found`);
          }
          result = formatTabDetail(tab);
          break;
        case 'get_active_tab':
          const activeTab = this.tabRegistry.getActiveTab();
          if (activeTab) {
            const protectedHint = getProtectedTabHint(activeTab.url);
            result = protectedHint
              ? { ...formatTabDetail(activeTab), hint: protectedHint }
              : formatTabDetail(activeTab);
          } else {
            result = {
              tab: null,
              hint: 'No active tab found. The currently focused browser tab may not be connected to the server.'
            };
          }
          break;
        case 'keypress':
          // Automatically adjust timeout based on delay
          if (validatedArgs.delay && !validatedArgs.timeout) {
            // Add 2 seconds to the delay for processing overhead
            validatedArgs.timeout = Math.max(5000, validatedArgs.delay + 2000);
          }
          result = await this.commandHandler.callTool(name, validatedArgs);
          break;
        case 'click':
          // Extend timeout for click to allow for animation and navigation
          // Use user-provided timeout if available, otherwise default to 8s
          validatedArgs._commandTimeout = validatedArgs.timeout || 8000;
          result = await this.commandHandler.callTool(name, validatedArgs);
          break;
        case 'wait_for_element':
          // Auto-extend command timeout based on wait timeout parameter
          if (validatedArgs.timeout) {
            // Add 2 seconds for processing overhead
            validatedArgs._commandTimeout = validatedArgs.timeout + 2000;
          }
          result = await this.commandHandler.callTool(name, validatedArgs);
          break;
        case 'type':
          // Auto-extend timeout based on text length and delay
          if (validatedArgs.text) {
            const delay = validatedArgs.delay ?? 50; // Default to 50ms if not provided
            const typingTime = validatedArgs.text.length * delay;
            // Add 5 seconds for focus, event processing overhead
            const calculatedTimeout = Math.max(5000, typingTime + 5000);

            // Prefer user timeout if provided, otherwise use calculated
            validatedArgs._commandTimeout = validatedArgs.timeout || calculatedTimeout;
          }
          result = await this.commandHandler.callTool(name, validatedArgs);
          break;
        default:
          // All other tools go through the generic callTool method
          result = await this.commandHandler.callTool(name, validatedArgs);
          break;
      }

      // Special handling for screenshot tool
      if (name === 'screenshot' && result.data) {
        const params = new URLSearchParams();
        const screenshotArgs = validatedArgs as any;
        if (screenshotArgs?.selector) params.append('selector', String(screenshotArgs.selector));
        if (screenshotArgs?.xpath) params.append('xpath', String(screenshotArgs.xpath));
        if (screenshotArgs?.scale) params.append('scale', String(screenshotArgs.scale));
        if (screenshotArgs?.format) params.append('format', String(screenshotArgs.format));
        if (screenshotArgs?.quality) params.append('quality', String(screenshotArgs.quality));

        const queryString = params.toString();
        const screenshotUrl = `http://localhost:61822/tab/${screenshotArgs?.tabId}/screenshot/view${queryString ? '?' + queryString : ''}`;

        const enhancedResult = {
          preview: screenshotUrl,
          ...result,
          // data goes in the image content
          data: undefined,
          dataUrl: undefined
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(enhancedResult, null, 2)
            },
            {
              type: 'image',
              mimeType: result.mimeType,
              data: result.data,
            },
          ]
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error: any) {
      if (error.name === 'ZodError') {
        const issues = error.issues.map((issue: any) => issue.message).join(', ');
        throw new Error(issues);
      }
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: { message: error.message } }, null, 2)
          }
        ]
      };
    }
  }
}
