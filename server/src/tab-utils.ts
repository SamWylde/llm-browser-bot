import { TabConnection } from './tab-registry.js';

/**
 * Format tab details into a consistent structure for API responses
 */
export function formatTabDetail(tab: TabConnection): any {
  return {
    tabId: tab.tabId,
    url: tab.url,
    title: tab.title,
    browser: tab.browser,
    active: tab.active || false,  // Whether this is the currently focused tab
    connectedAt: tab.connectedAt,
    lastPing: tab.lastPing,
    domSize: tab.domSize,
    fullPageDimensions: tab.fullPageDimensions,
    viewportDimensions: tab.viewportDimensions,
    scrollPosition: tab.scrollPosition,
    pageVisibility: tab.pageVisibility
  };
}