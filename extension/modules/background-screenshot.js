// Import helper functions from background-commands
import { getElement, getTabInfo, respondWithError, attachDebugger } from './background-commands.js';

/**
 * Helper function to wait for a specified duration
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Capture a full-page scrolling screenshot by progressively scrolling and stitching
 */
export async function scrolling_screenshot({ tabId }, {
  maxScrolls = 10,
  scrollDelay = 1000,
  scale = 0.3,
  quality = 0.85,
  format = 'webp'
}) {
  const tabInfo = await getTabInfo(tabId);
  if (tabInfo.error) return tabInfo;

  const viewportHeight = tabInfo.viewportDimensions.height;
  const viewportWidth = tabInfo.viewportDimensions.width;

  // Scroll to top first
  await chrome.tabs.sendMessage(tabId, {
    command: 'scroll',
    params: { y: 0, behavior: 'auto' }
  });

  // Wait for scroll to complete
  await sleep(300);

  const screenshots = [];
  let currentScroll = 0;
  let scrollCount = 0;
  let previousHeight = 0;

  return attachDebugger(tabId, async () => {
    while (scrollCount < maxScrolls) {
      // Get current document height
      const updatedTabInfo = await getTabInfo(tabId);
      const documentHeight = updatedTabInfo.contentSize.height;

      // Check if we've reached the bottom
      if (currentScroll + viewportHeight >= documentHeight) {
        // Take final screenshot
        const clip = {
          x: 0,
          y: currentScroll,
          width: viewportWidth,
          height: Math.min(viewportHeight, documentHeight - currentScroll),
          scale: scale
        };

        const screenshot = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', {
          format,
          quality: Math.round(quality * 100),
          clip
        });

        screenshots.push({
          data: screenshot.data,
          y: currentScroll,
          height: clip.height
        });
        break;
      }

      // Take screenshot at current position
      const clip = {
        x: 0,
        y: currentScroll,
        width: viewportWidth,
        height: viewportHeight,
        scale: scale
      };

      const screenshot = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', {
        format,
        quality: Math.round(quality * 100),
        clip
      });

      screenshots.push({
        data: screenshot.data,
        y: currentScroll,
        height: viewportHeight
      });

      // Scroll down by viewport height
      currentScroll += viewportHeight;

      await chrome.tabs.sendMessage(tabId, {
        command: 'scroll',
        params: { y: currentScroll, behavior: 'auto' }
      });

      // Wait for content to load
      await sleep(scrollDelay);

      scrollCount++;

      // Check if page height hasn't changed (reached end of infinite scroll)
      const newTabInfo = await getTabInfo(tabId);
      const newDocumentHeight = newTabInfo.contentSize.height;

      if (newDocumentHeight === previousHeight && scrollCount > 1) {
        // Page stopped growing, we've reached the end
        break;
      }
      previousHeight = newDocumentHeight;
    }

    // Stitch screenshots together using Canvas API in page context
    const stitchResult = await chrome.tabs.sendMessage(tabId, {
      command: 'evaluate',
      params: {
        code: `
          (async function() {
            const screenshots = ${JSON.stringify(screenshots)};
            const scale = ${scale};
            const viewportWidth = ${viewportWidth};

            // Calculate total height
            let totalHeight = 0;
            screenshots.forEach(s => totalHeight += s.height * scale);

            // Create canvas
            const canvas = document.createElement('canvas');
            canvas.width = viewportWidth * scale;
            canvas.height = totalHeight;
            const ctx = canvas.getContext('2d');

            // Load and draw each screenshot
            let currentY = 0;
            for (const shot of screenshots) {
              const img = new Image();
              await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = 'data:image/${format};base64,' + shot.data;
              });

              ctx.drawImage(img, 0, currentY);
              currentY += shot.height * scale;
            }

            // Convert canvas to base64
            const dataUrl = canvas.toDataURL('image/${format}', ${quality});
            return dataUrl.split(',')[1]; // Return just the base64 data
          })()
        `
      }
    });

    if (stitchResult.error) {
      return respondWithError(tabId, 'STITCH_ERROR', stitchResult.error.message);
    }

    return {
      ...tabInfo,
      scrollCount: screenshots.length,
      totalHeight: screenshots.reduce((sum, s) => sum + s.height, 0),
      mimeType: `image/${format}`,
      data: stitchResult.result,
    };
  })
  .catch((err) => {
    return respondWithError(tabId, 'SCROLLING_SCREENSHOT_ERROR', err.message);
  });
}

export async function screenshot({ tabId }, { scale = 0.5, quality = 0.5, format = 'webp', selector, xpath }) {
  let elementResult;
  if (selector || xpath) {
    elementResult = await getElement(tabId, selector, xpath, true);
    if (elementResult.error) return elementResult;
  }
  else {
    elementResult = await getTabInfo(tabId)
    elementResult.element = {
      bounds: {
        x: 0,
        y: 0,
        width: elementResult.viewportDimensions.width,
        height: elementResult.viewportDimensions.height
      }
    };
  }

  const clip = { ...elementResult.element.bounds };

  // For fixed positioned elements, we need viewport-relative coordinates
  // For non-fixed elements, we need document-relative coordinates
  if (elementResult.element.position !== 'fixed') {
    // Add scroll position to convert from viewport to document coordinates
    clip.x += elementResult.scrollPosition.x;
    clip.y += elementResult.scrollPosition.y;
  }

  if (scale) {
    clip.scale = scale;
  }

  return attachDebugger(tabId, async () => {
    const screenshot = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', {
      format,
      quality: Math.round(quality * 100), // Chrome needs an integer percentage,
      clip
    });

    return {
      ...elementResult,
      element: undefined,
      selector: elementResult.element?.selector || undefined,
      mimeType: `image/${format}`,
      data: screenshot.data,
    };
  })
    .catch((err) => {
      return respondWithError(tabId, 'SCREENSHOT_ERROR', err.message, null, null);
    });
}