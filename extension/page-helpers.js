// page-helpers.js - Content script that provides helper functions
let kaptureIdCounter = 0;

function getUniqueSelector(element) {
  if (!element || !(element instanceof Element)) return null;

  // Special handling for html, head, and body elements - their tagName is unique
  const tagName = element.tagName.toLowerCase();
  if (tagName === 'html' || tagName === 'head' || tagName === 'body') {
    return tagName;
  }

  // If element has an ID, use it (unless it's empty or contains special chars)
  if (element.id && /^[a-zA-Z][\w-]*$/.test(element.id)) {
    // Check if ID is truly unique
    if (document.querySelectorAll('#' + CSS.escape(element.id)).length === 1) {
      return '#' + CSS.escape(element.id);
    }
  }

  const uniqueId = 'kapture-' + (++kaptureIdCounter)

  if (!element.id) {
    element.id = uniqueId;
    return '#' + uniqueId;
  }

  element.classList.add(uniqueId);
  return '.' + uniqueId
}
function findScrollableParent(element) {
  function isScrollable(element) {
    const hasScrollableContent = element.scrollHeight > element.clientHeight ||
      element.scrollWidth > element.clientWidth;

    if (!hasScrollableContent) return false;

    const style = getComputedStyle(element);
    return /(auto|scroll)/.test(style.overflow + style.overflowY + style.overflowX);
  }

  let parent = element.parentElement;
  while (parent && parent !== document.body) {
    if (isScrollable(parent)) return parent;
    parent = parent.parentElement;
  }
  return document.documentElement;
}
function serializeValue(value, depth = 0, maxDepth = 3, seen = new WeakSet()) {
  // Handle primitive types
  if (value === null || value === undefined) return value;
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }

  if (typeof value === 'function') return '[Function: ' + (value.name || 'anonymous') + ']';
  if (typeof value === 'symbol') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return value.toString();

  // Handle errors
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }

  // Handle DOM elements
  if (value instanceof Element) {
    const selector = getUniqueSelector(value);
    return {
      nodeType: 'ELEMENT_NODE',
      selector: selector,
      tagName: value.tagName,
      id: value.id || undefined,
      className: value.className || undefined,
      attributes: Array.from(value.attributes).reduce((acc, attr) => {
        acc[attr.name] = attr.value;
        return acc;
      }, {})
    };
  }

  // Prevent infinite recursion
  if (depth >= maxDepth) {
    return '[Max depth reached]';
  }

  // Handle circular references
  if (typeof value === 'object' && seen.has(value)) {
    return '[Circular reference]';
  }

  // Mark object as seen
  if (typeof value === 'object') {
    seen.add(value);
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map(item => serializeValue(item, depth + 1, maxDepth, seen));
  }

  // Handle NodeList and HTMLCollection
  if (value instanceof NodeList || value instanceof HTMLCollection) {
    return {
      nodeType: value instanceof NodeList ? 'NodeList' : 'HTMLCollection',
      length: value.length,
      items: Array.from(value).map(item => serializeValue(item, depth + 1, maxDepth, seen))
    };
  }

  // Handle typed arrays
  if (ArrayBuffer.isView(value)) {
    return {
      type: value.constructor.name,
      length: value.length,
      data: '[Binary data]'
    };
  }

  // Handle other objects
  if (typeof value === 'object') {
    const result = {};
    const keys = Object.keys(value);

    // Limit number of keys to prevent huge objects
    const maxKeys = 100;
    const limitedKeys = keys.slice(0, maxKeys);

    for (const key of limitedKeys) {
      try {
        const serialized = this.serializeValue(value[key], depth + 1, maxDepth, seen);
        if (serialized === undefined || serialized === null) continue; // Skip undefined values
        result[key] = serialized;
      } catch (e) {
        result[key] = '[Error accessing property]';
      }
    }

    if (keys.length > maxKeys) {
      result['...'] = `${keys.length - maxKeys} more properties`;
    }

    return result;
  }

  // Fallback for unknown types
  return String(value);
}
function getTabInfo() {
  const de = document.documentElement;
  return {
    url: window.location.href,
    title: document.title,
    domSize: de.outerHTML.length,
    fullPageDimensions: { width: de.scrollWidth, height: de.scrollHeight },
    viewportDimensions: { width: window.innerWidth, height: window.innerHeight },
    scrollPosition: { x: window.pageXOffset || de.scrollLeft, y: window.pageYOffset || de.scrollTop },
    pageVisibility: { visible: !document.hidden, visibilityState: document.visibilityState }
  };
}
function findAllElements(selector, xpath) {
  if (selector) {
    try {
      return Array.from(document.querySelectorAll(selector));
    } catch (e) {
      throw new Error(`Invalid selector: ${e.message}`);
    }
  }
  try {
    const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    return Array.from({ length: result.snapshotLength }, (_, i) => result.snapshotItem(i));
  }
  catch (e) {
    throw new Error(`Invalid XPath: ${e.message}`);
  }
}
function getElementData(element) {
  const rect = element.getBoundingClientRect();
  const computedStyle = window.getComputedStyle(element);

  // Get the selector (which may add an ID to the element)
  const selector = getUniqueSelector(element);

  // Comprehensive visibility check
  const visible = isElementVisible(element, rect, computedStyle);

  const data = {
    tagName: element.tagName.toLowerCase(),
    id: element.id || undefined,
    className: element.className || undefined,
    selector: selector,
    bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    visible: visible,
    focused: element === document.activeElement,
    position: computedStyle.position
  };
  // Conditionally add attributes
  ["href", "src", "value", "name"].forEach(attr => element[attr] && (data[attr] = element[attr]));

  // If it's a select element, add the options
  if (data.tagName === 'select') {
    data.options = Array.from(element.options).map((option, optionIndex) => ({
      index: optionIndex,
      value: option.value,
      text: option.text,
      selected: option.selected,
      disabled: option.disabled
    }));
  }
  // Add scrollable parent if exists
  const scrollParent = findScrollableParent(element);
  data.scrollParent = getUniqueSelector(scrollParent);
  return data;
}
function isElementVisible(element, rect, computedStyle) {
  // If rect and computedStyle not provided, calculate them
  if (!rect) rect = element.getBoundingClientRect();
  if (!computedStyle) computedStyle = window.getComputedStyle(element);

  // Check if element has dimensions
  if (rect.width <= 0 || rect.height <= 0) return false;

  // Check CSS visibility properties
  if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden' || computedStyle.opacity === '0') {
    return false;
  }

  // Check if element is in viewport
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

  // Check if any part of the element is within the viewport
  const inViewport = rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < viewportHeight &&
    rect.left < viewportWidth;

  if (!inViewport) return false;

  // Get element's center point (used multiple times below)
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  // Helper function to check if element is visible at a point
  const isElementAtPoint = (x, y) => {
    const elementAtPoint = document.elementFromPoint(x, y);
    if (!elementAtPoint) return false;
    return elementAtPoint === element || element.contains(elementAtPoint) || elementAtPoint.contains(element);
  };

  // Check if element is visible at center point - this is the most reliable check
  if (isElementAtPoint(centerX, centerY)) return true;

  // Check if element is hidden by ancestor's properties
  let parent = element.parentElement;
  while (parent && parent !== document.body) {
    const parentStyle = window.getComputedStyle(parent);
    if (parentStyle.display === 'none' || parentStyle.visibility === 'hidden' || parentStyle.opacity === '0') {
      return false;
    }

    // Check for overflow hidden that might hide the element
    if (parentStyle.overflow === 'hidden' || parentStyle.overflowX === 'hidden' || parentStyle.overflowY === 'hidden') {
      const parentRect = parent.getBoundingClientRect();
      // Check if element is outside parent's visible area
      if (rect.bottom < parentRect.top || rect.top > parentRect.bottom || rect.right < parentRect.left || rect.left > parentRect.right) {
        // Before returning false, check if the element is actually visible using elementsFromPoint
        const elementsAtPoint = document.elementsFromPoint(centerX, centerY);

        // If the element is in the elements chain at its center point, it's visible
        if (elementsAtPoint.includes(element)) {
          continue; // Skip this parent check and continue checking other parents
        }

        return false;
      }
    }
    parent = parent.parentElement;
  }

  // Element might be partially covered, check multiple points
  const points = [
    { x: rect.left + rect.width * 0.1, y: rect.top + rect.height * 0.1 },
    { x: rect.right - rect.width * 0.1, y: rect.top + rect.height * 0.1 },
    { x: rect.left + rect.width * 0.1, y: rect.bottom - rect.height * 0.1 },
    { x: rect.right - rect.width * 0.1, y: rect.bottom - rect.height * 0.1 }
  ];

  // Check if any of the points hit our element
  return points.some(point => isElementAtPoint(point.x, point.y));
}

function respondWith(obj, selector, xpath) {
  return {
    success: !obj.error,
    selector,
    xpath: !selector ? xpath : undefined,
    ...getTabInfo(),
    ...obj
  };
}
function respondWithError(code, message, selector, xpath) {
  return respondWith({ error: { code, message } }, selector, xpath);
}
function findSimilarElements(selector, xpath) {
  const hints = [];

  try {
    if (selector) {
      // Try to parse the selector to find similar elements
      const parts = selector.match(/^([#.]?)([a-zA-Z0-9_-]+)/);
      if (parts) {
        const [, prefix, name] = parts;

        if (prefix === '#') {
          // Look for elements with similar IDs
          const allWithId = document.querySelectorAll('[id]');
          const similar = Array.from(allWithId)
            .filter(el => el.id.toLowerCase().includes(name.toLowerCase()) ||
              name.toLowerCase().includes(el.id.toLowerCase().slice(0, 5)))
            .slice(0, 3)
            .map(el => `#${el.id}`);
          if (similar.length) hints.push(`Similar IDs: ${similar.join(', ')}`);
        } else if (prefix === '.') {
          // Look for elements with similar classes
          const allWithClass = document.querySelectorAll('[class]');
          const similar = Array.from(allWithClass)
            .flatMap(el => Array.from(el.classList))
            .filter(cls => cls.toLowerCase().includes(name.toLowerCase()))
            .filter((v, i, a) => a.indexOf(v) === i)
            .slice(0, 3)
            .map(cls => `.${cls}`);
          if (similar.length) hints.push(`Similar classes: ${similar.join(', ')}`);
        } else {
          // Tag name - check if tag exists
          const tagElements = document.getElementsByTagName(name);
          if (tagElements.length === 0) {
            hints.push(`No <${name}> elements on page`);
          } else {
            hints.push(`Found ${tagElements.length} <${name}> elements but none match full selector`);
          }
        }
      }
    }

    if (xpath) {
      // For XPath, provide general hints
      if (xpath.includes('contains(')) {
        hints.push('Tip: contains() is case-sensitive');
      }
      if (xpath.includes('text()')) {
        hints.push('Tip: text() only matches direct text nodes, not nested text');
      }
    }
  } catch (e) {
    // Ignore errors in hint generation
  }

  return hints;
}

function elementNotFound(selector, xpath, matchCount = 0) {
  const hints = findSimilarElements(selector, xpath);
  let message = 'Element not found';

  if (matchCount === 0) {
    message = 'No matching elements found';
  }

  const errorDetails = {
    code: 'ELEMENT_NOT_FOUND',
    message,
    matchCount
  };

  if (hints.length > 0) {
    errorDetails.hints = hints;
  }

  return respondWith({ error: errorDetails }, selector, xpath);
}
function requireSelectorOrXpath(selector, xpath) {
  return respondWithError('SELECTOR_OR_XPATH_REQUIRED', 'Selector or XPath parameter required', selector, xpath);
}

const helpers = {
  //called by the background script
  _navigate: ({ url }) => {
    window.location.href = url;
  },
  _elementPosition: ({ id }) => {
    const element = document.getElementById(id);
    return element.getBoundingClientRect();
  },
  _connectionStateChanged: ({ status, connected }) => {
    // Remove existing connection classes
    document.body.classList.remove('kapture-connected', 'kapture-connecting');

    // Add appropriate class based on status
    if (status === 'connected') {
      document.body.classList.add('kapture-connected');
    } else if (status === 'retrying') {
      document.body.classList.add('kapture-connecting');
    }
    // No class for disconnected state

    return { success: true };
  },

  // tool calls
  getTabInfo,
  dom: ({ selector, xpath }) => {
    if (!selector && !xpath) {
      return respondWith({ html: document.body.outerHTML });
    }

    const element = findAllElements(selector, xpath)[0];
    if (!element) return elementNotFound(selector, xpath);

    return respondWith({ html: element.outerHTML }, selector, xpath);
  },
  elements_from_point: ({ x, y }) => {
    if (typeof x !== 'number' || typeof y !== 'number') {
      return respondWithError('XY_REQUIRED', 'Both x and y coordinates are required');
    }
    const elements = document.elementsFromPoint(x, y);
    return respondWith({ x, y, elements: elements.map(getElementData) });
  },
  elements: ({ selector, xpath, visible = 'all' }) => {
    if (!selector && !xpath) return requireSelectorOrXpath();

    let elements;
    try {
      elements = findAllElements(selector, xpath).map(getElementData);
    } catch (e) {
      const errorCode = selector ? 'INVALID_SELECTOR' : 'INVALID_XPATH';
      return respondWithError(errorCode, e.message, selector, xpath);
    }

    // Apply visibility filter
    if (visible !== 'all') {
      const filterVisible = String(visible) === 'true';
      elements = elements.filter(el => el.visible === filterVisible);
    }
    return respondWith({ elements: elements, visible: visible !== 'all' ? visible : undefined }, selector, xpath);
  },
  element: ({ selector, xpath, visible = 'all' }) => {
    const result = helpers.elements({ selector, xpath, visible });
    if (result.error) return result;
    if (!result.elements.length) return elementNotFound(selector, xpath);
    result.element = result.elements[0];
    delete result.elements;
    return result;
  },
  focus: ({ selector, xpath }) => {
    if (!selector && !xpath) return requireSelectorOrXpath();

    let element;
    try {
      element = findAllElements(selector, xpath)[0];
    } catch (e) {
      const errorCode = selector ? 'INVALID_SELECTOR' : 'INVALID_XPATH';
      return respondWithError(errorCode, e.message, selector, xpath);
    }

    if (!element) return elementNotFound(selector, xpath);

    // Focus the element
    element.focus();

    // Check if element is actually focusable
    const focusableElements = ['input', 'textarea', 'select', 'button', 'a'];
    const tagName = element.tagName.toLowerCase();
    const isFocusable = focusableElements.includes(tagName) ||
      element.hasAttribute('tabindex') ||
      element.isContentEditable;

    if (!isFocusable) {
      // Still return success but with a warning
      return respondWith({
        focused: true,
        warning: 'Element may not be focusable'
      }, selector, xpath);
    }

    return respondWith({ focused: true }, selector, xpath);
  },
  fill: ({ selector, xpath, value }) => {
    if (!selector && !xpath) return requireSelectorOrXpath();

    const element = findAllElements(selector, xpath)[0];
    if (!element) return elementNotFound(selector, xpath);

    // Check if it's an input element
    const tagName = element.tagName.toLowerCase();
    const inputTypes = ['input', 'textarea'];

    if (!inputTypes.includes(tagName) && !element.isContentEditable) {
      return respondWithError('INVALID_ELEMENT', 'Element is not fillable: ' + tagName, selector, xpath);
    }

    // Focus the element
    element.focus();

    // Clear existing value
    if (element.value !== undefined) {
      element.value = '';
    } else if (element.isContentEditable) {
      element.textContent = '';
    }

    // Set new value
    if (element.value !== undefined) {
      element.value = value;
    } else if (element.isContentEditable) {
      element.textContent = value;
    }

    // Trigger input and change events
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));

    // Blur to trigger any blur handlers
    element.blur();

    return respondWith({ filled: true }, selector, xpath);
  },

  paste: ({ selector, xpath, value }) => {
    if (!selector && !xpath) return requireSelectorOrXpath();

    let element;
    try {
      element = findAllElements(selector, xpath)[0];
    } catch (e) {
      const errorCode = selector ? 'INVALID_SELECTOR' : 'INVALID_XPATH';
      return respondWithError(errorCode, e.message, selector, xpath);
    }

    if (!element) return elementNotFound(selector, xpath);

    element.focus();

    // Try execCommand 'insertText' first as it simulates user input best
    let success = false;
    try {
      success = document.execCommand('insertText', false, value);
    } catch (e) {
      // Fallback
    }

    if (!success) {
      // Fallback: Dispatch paste event and manual insertion
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer()
      });
      pasteEvent.clipboardData.setData('text/plain', value);

      if (element.dispatchEvent(pasteEvent)) {
        // If event wasn't cancelled, manually insert
        if (element.value !== undefined) {
          const start = element.selectionStart || element.value.length;
          const end = element.selectionEnd || element.value.length;
          const text = element.value;
          element.value = text.slice(0, start) + value + text.slice(end);
          // Restore cursor
          element.selectionStart = element.selectionEnd = start + value.length;
        } else if (element.isContentEditable) {
          // Simple append for contentEditable fallback
          element.textContent += value;
        }

        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        success = true;
      }
    }

    return respondWith({ pasted: success }, selector, xpath);
  },

  clear: ({ selector, xpath }) => {
    if (!selector && !xpath) return requireSelectorOrXpath();

    let element;
    try {
      element = findAllElements(selector, xpath)[0];
    } catch (e) {
      const errorCode = selector ? 'INVALID_SELECTOR' : 'INVALID_XPATH';
      return respondWithError(errorCode, e.message, selector, xpath);
    }

    if (!element) return elementNotFound(selector, xpath);

    const inputTypes = ['input', 'textarea'];
    if (!inputTypes.includes(element.tagName.toLowerCase()) && !element.isContentEditable) {
      return respondWithError('INVALID_ELEMENT', 'Element is not clearable: ' + element.tagName, selector, xpath);
    }

    element.focus();

    // Clear value
    if (element.value !== undefined) {
      element.value = '';
    } else if (element.isContentEditable) {
      element.textContent = '';
    }

    // Trigger events
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));

    // Blur
    element.blur();

    return respondWith({ cleared: true }, selector, xpath);
  },
  select: ({ selector, xpath, value }) => {
    if (!selector && !xpath) return requireSelectorOrXpath();

    const element = findAllElements(selector, xpath)[0];
    if (!element) return elementNotFound(selector, xpath);

    if (element.tagName !== 'SELECT') {
      return respondWithError('INVALID_ELEMENT', 'Element is not fillable: ' + element.name, selector, xpath);
    }

    // Find option by value
    const option = Array.from(element.options).find(opt => opt.value === value);
    if (!option) {
      return respondWithError('OPTION_NOT_FOUND', 'Option not found with value: ' + value, selector, xpath);
    }

    // Select the option
    element.value = value;
    option.selected = true;

    // Trigger change event
    element.dispatchEvent(new Event('change', { bubbles: true }));

    return respondWith({ selected: true }, selector, xpath);
  },
  blur: ({ selector, xpath }) => {
    if (!selector && !xpath) return requireSelectorOrXpath();

    let element;
    try {
      element = findAllElements(selector, xpath)[0];
    } catch (e) {
      const errorCode = selector ? 'INVALID_SELECTOR' : 'INVALID_XPATH';
      return respondWithError(errorCode, e.message, selector, xpath);
    }

    if (!element) return elementNotFound(selector, xpath);

    // Blur the element
    element.blur();

    // Also remove focus from document.activeElement if it's different
    if (document.activeElement && document.activeElement !== element) {
      document.activeElement.blur();
    }

    return respondWith({ blurred: true }, selector, xpath);
  },
  _cursor: ({ show }) => {
    const cursorId = 'kapture-cursor';
    let cursor = document.getElementById(cursorId);

    try {
      if (show === false) {
        // Hide cursor
        if (cursor) {
          cursor.style.display = 'none';
        }
        return respondWith({ visible: false });
      }

      // Show cursor - create if doesn't exist
      if (!cursor) {
        cursor = document.createElement('div');
        cursor.id = cursorId;

        // Create cursor SVG
        cursor.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 0 L0 16 L4.5 12.5 L7.5 20 L10 19 L7 11.5 L12 11 Z" 
                  fill="white" 
                  stroke="black" 
                  stroke-width="1"/>
          </svg>
        `;

        // Style the cursor container
        cursor.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 20px;
          height: 20px;
          z-index: 2147483647;
          pointer-events: none;
          transform: translate(-2px, -2px);
          transition: none;
          will-change: transform;
        `;

        document.body.appendChild(cursor);
      }

      cursor.style.display = 'block';
      return respondWith({ visible: true });
    } catch (e) {
      return respondWithError('CURSOR_ERROR', e.message);
    }
  },
  _moveMouseSVG: ({ x, y }) => {
    if (typeof x !== 'number' || typeof y !== 'number') {
      return respondWithError('XY_REQUIRED', 'Both x and y coordinates are required');
    }

    try {
      const cursor = document.getElementById('kapture-cursor');
      if (!cursor) {
        return respondWithError('CURSOR_NOT_FOUND', 'Cursor element not found. Call _cursor with show=true first');
      }

      cursor.style.transform = `translate(${x - 2}px, ${y - 2}px)`;
      return respondWith({ moved: true, x, y });
    } catch (e) {
      return respondWithError('MOVE_MOUSE_SVG_ERROR', e.message);
    }
  },

  // ============ NEW TOOLS ============

  scroll: async ({ selector, xpath, direction, x, y, behavior = 'auto' }) => {
    try {
      // Priority 1: Scroll by direction (full page height)
      if (direction) {
        const pageHeight = window.innerHeight;
        const scrollAmount = direction === 'up' ? -pageHeight : pageHeight;
        const oldPosition = { x: window.scrollX, y: window.scrollY };

        window.scrollBy({
          top: scrollAmount,
          behavior: behavior
        });

        // Wait for scroll to complete (especially important for smooth scrolling)
        if (behavior === 'smooth') {
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        return respondWith({
          scrolled: true,
          direction,
          amount: Math.abs(scrollAmount),
          oldPosition: oldPosition,
          newPosition: { x: window.scrollX, y: window.scrollY }
        });
      }

      // Priority 2: Scroll element into view
      if (selector || xpath) {
        let element;
        try {
          element = findAllElements(selector, xpath)[0];
        } catch (e) {
          const errorCode = selector ? 'INVALID_SELECTOR' : 'INVALID_XPATH';
          return respondWithError(errorCode, e.message, selector, xpath);
        }

        if (!element) return elementNotFound(selector, xpath);

        element.scrollIntoView({
          behavior: behavior,
          block: 'center',
          inline: 'nearest'
        });

        // Wait for scroll to complete
        if (behavior === 'smooth') {
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        const rect = element.getBoundingClientRect();
        return respondWith({
          scrolled: true,
          elementPosition: { x: rect.x, y: rect.y }
        }, selector, xpath);
      }

      // Priority 3: Scroll to coordinates
      if (typeof x === 'number' || typeof y === 'number') {
        const oldPosition = { x: window.scrollX, y: window.scrollY };

        window.scrollTo({
          left: x ?? window.scrollX,
          top: y ?? window.scrollY,
          behavior: behavior
        });

        // Wait for scroll to complete
        if (behavior === 'smooth') {
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        return respondWith({
          scrolled: true,
          oldPosition: oldPosition,
          newPosition: { x: window.scrollX, y: window.scrollY }
        });
      }

      return respondWithError('SCROLL_PARAMS_REQUIRED',
        'Provide direction ("up"/"down"), selector/xpath, or x/y coordinates');
    } catch (e) {
      return respondWithError('SCROLL_ERROR', e.message);
    }
  },

  evaluate: async ({ code }) => {
    if (!code) {
      return respondWithError('CODE_REQUIRED', 'JavaScript code is required');
    }

    try {
      // Create async function wrapper to support await
      const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
      const fn = new AsyncFunction(code);
      const result = await fn();

      // Serialize the result for safe transmission
      const serialized = serializeValue(result);

      return respondWith({
        result: serialized,
        type: typeof result
      });
    } catch (e) {
      return respondWith({
        error: {
          code: 'EVALUATION_ERROR',
          message: e.message,
          stack: e.stack
        }
      });
    }
  },

  get_attribute: ({ selector, xpath, attribute }) => {
    if (!selector && !xpath) return requireSelectorOrXpath();
    if (!attribute) {
      return respondWithError('ATTRIBUTE_REQUIRED', 'Attribute name is required');
    }

    let element;
    try {
      element = findAllElements(selector, xpath)[0];
    } catch (e) {
      const errorCode = selector ? 'INVALID_SELECTOR' : 'INVALID_XPATH';
      return respondWithError(errorCode, e.message, selector, xpath);
    }

    if (!element) return elementNotFound(selector, xpath);

    const value = element.getAttribute(attribute);
    return respondWith({
      attribute,
      value,
      exists: value !== null
    }, selector, xpath);
  },

  get_computed_style: ({ selector, xpath, properties }) => {
    if (!selector && !xpath) return requireSelectorOrXpath();

    let element;
    try {
      element = findAllElements(selector, xpath)[0];
    } catch (e) {
      const errorCode = selector ? 'INVALID_SELECTOR' : 'INVALID_XPATH';
      return respondWithError(errorCode, e.message, selector, xpath);
    }

    if (!element) return elementNotFound(selector, xpath);

    const computedStyle = window.getComputedStyle(element);
    let styles = {};

    if (properties && Array.isArray(properties) && properties.length > 0) {
      // Return only requested properties
      for (const prop of properties) {
        styles[prop] = computedStyle.getPropertyValue(prop);
      }
    } else {
      // Return common useful properties
      const commonProps = [
        'display', 'visibility', 'opacity', 'position',
        'width', 'height', 'margin', 'padding',
        'color', 'background-color', 'font-size', 'font-family',
        'border', 'z-index', 'overflow'
      ];
      for (const prop of commonProps) {
        styles[prop] = computedStyle.getPropertyValue(prop);
      }
    }

    return respondWith({ styles }, selector, xpath);
  },

  get_text: ({ selector, xpath }) => {
    try {
      let element;
      if (!selector && !xpath) {
        // Default to body for all page text
        element = document.body;
      } else {
        try {
          element = findAllElements(selector, xpath)[0];
        } catch (e) {
          const errorCode = selector ? 'INVALID_SELECTOR' : 'INVALID_XPATH';
          return respondWithError(errorCode, e.message, selector, xpath);
        }
      }

      if (!element) return elementNotFound(selector, xpath);

      // Get visible text content (innerText respects CSS visibility)
      const text = element.innerText;

      return respondWith({
        text,
        length: text.length
      }, selector, xpath);
    } catch (e) {
      return respondWithError('GET_TEXT_ERROR', e.message, selector, xpath);
    }
  },

  wait_for_element: async ({ selector, xpath, timeout = 5000, visible = true }) => {
    if (!selector && !xpath) return requireSelectorOrXpath();

    const startTime = Date.now();
    const pollInterval = 100; // Check every 100ms

    while (Date.now() - startTime < timeout) {
      try {
        const elements = findAllElements(selector, xpath);

        if (elements.length > 0) {
          if (visible) {
            // Check if at least one element is visible
            for (const element of elements) {
              if (isElementVisible(element)) {
                return respondWith({
                  found: true,
                  element: getElementData(element),
                  waitTime: Date.now() - startTime
                }, selector, xpath);
              }
            }
          } else {
            // Just need element to exist in DOM
            return respondWith({
              found: true,
              element: getElementData(elements[0]),
              waitTime: Date.now() - startTime
            }, selector, xpath);
          }
        }
      } catch (e) {
        // Invalid selector/xpath - return error immediately
        const errorCode = selector ? 'INVALID_SELECTOR' : 'INVALID_XPATH';
        return respondWithError(errorCode, e.message, selector, xpath);
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // Timeout reached
    return respondWith({
      error: {
        code: 'TIMEOUT',
        message: `Element not found within ${timeout}ms`,
        timeout,
        visible
      }
    }, selector, xpath);
  },

  type: async ({ selector, xpath, text, delay = 50 }) => {
    if (!text) {
      return respondWithError('TEXT_REQUIRED', 'Text to type is required');
    }

    let element;
    if (selector || xpath) {
      try {
        element = findAllElements(selector, xpath)[0];
      } catch (e) {
        const errorCode = selector ? 'INVALID_SELECTOR' : 'INVALID_XPATH';
        return respondWithError(errorCode, e.message, selector, xpath);
      }

      if (!element) return elementNotFound(selector, xpath);

      // Focus the element first
      element.focus();
    } else {
      // Type to currently focused element or body
      element = document.activeElement || document.body;
    }

    // Helper to get correct key code for a character
    function getKeyCode(char) {
      // Letters
      if (/^[a-zA-Z]$/.test(char)) {
        return `Key${char.toUpperCase()}`;
      }
      // Digits
      if (/^[0-9]$/.test(char)) {
        return `Digit${char}`;
      }
      // Special characters
      const specialCodes = {
        ' ': 'Space',
        '\n': 'Enter',
        '\t': 'Tab',
        '.': 'Period',
        ',': 'Comma',
        '/': 'Slash',
        '\\': 'Backslash',
        '[': 'BracketLeft',
        ']': 'BracketRight',
        ';': 'Semicolon',
        "'": 'Quote',
        '`': 'Backquote',
        '-': 'Minus',
        '=': 'Equal'
      };
      return specialCodes[char] || `Key${char}`;
    }

    // Type character by character
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const code = getKeyCode(char);

      // Dispatch keydown, keypress, and input events
      element.dispatchEvent(new KeyboardEvent('keydown', {
        key: char,
        code: code,
        charCode: char.charCodeAt(0),
        keyCode: char.charCodeAt(0),
        bubbles: true
      }));

      element.dispatchEvent(new KeyboardEvent('keypress', {
        key: char,
        code: code,
        charCode: char.charCodeAt(0),
        keyCode: char.charCodeAt(0),
        bubbles: true
      }));

      // Update the value for input/textarea elements
      if (element.value !== undefined) {
        element.value += char;
      } else if (element.isContentEditable) {
        element.textContent += char;
      }

      element.dispatchEvent(new InputEvent('input', {
        inputType: 'insertText',
        data: char,
        bubbles: true
      }));

      element.dispatchEvent(new KeyboardEvent('keyup', {
        key: char,
        code: code,
        charCode: char.charCodeAt(0),
        keyCode: char.charCodeAt(0),
        bubbles: true
      }));

      // Wait between keystrokes
      if (delay > 0 && i < text.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return respondWith({
      typed: true,
      text,
      length: text.length,
      totalTime: text.length * delay
    }, selector, xpath);
  },

  select_text: ({ selector, xpath, start = 0, end }) => {
    if (!selector && !xpath) return requireSelectorOrXpath();

    let element;
    try {
      element = findAllElements(selector, xpath)[0];
    } catch (e) {
      const errorCode = selector ? 'INVALID_SELECTOR' : 'INVALID_XPATH';
      return respondWithError(errorCode, e.message, selector, xpath);
    }

    if (!element) return elementNotFound(selector, xpath);

    try {
      // Handle input/textarea elements
      if (element.setSelectionRange) {
        const textLength = element.value?.length || 0;
        const actualEnd = end ?? textLength;
        element.focus();
        element.setSelectionRange(start, actualEnd);
        return respondWith({
          selected: true,
          start,
          end: actualEnd,
          text: element.value.substring(start, actualEnd)
        }, selector, xpath);
      }

      // Handle regular elements with text content
      const range = document.createRange();
      const textNode = element.firstChild;

      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
        return respondWithError('NO_TEXT_NODE', 'Element has no text content to select', selector, xpath);
      }

      const textLength = textNode.textContent?.length || 0;
      const actualEnd = Math.min(end ?? textLength, textLength);

      range.setStart(textNode, Math.min(start, textLength));
      range.setEnd(textNode, actualEnd);

      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);

      return respondWith({
        selected: true,
        start,
        end: actualEnd,
        text: selection.toString()
      }, selector, xpath);
    } catch (e) {
      return respondWithError('SELECTION_ERROR', e.message, selector, xpath);
    }
  },

  get_selected_text: () => {
    const selection = window.getSelection();
    const text = selection ? selection.toString() : '';

    return respondWith({
      text,
      length: text.length,
      hasSelection: text.length > 0
    });
  },

  // ============ AI-FOCUSED TOOLS ============

  page_structure: () => {
    try {
      const structure = {
        title: document.title,
        url: window.location.href,
        headings: [],
        navigation: [],
        forms: [],
        mainContent: null,
        landmarks: [],
        interactiveElements: { buttons: 0, links: 0, inputs: 0, selects: 0 }
      };

      // Extract headings with hierarchy
      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      headings.forEach(h => {
        if (h.innerText.trim()) {
          structure.headings.push({
            level: parseInt(h.tagName[1]),
            text: h.innerText.trim().substring(0, 100),
            id: h.id || undefined
          });
        }
      });

      // Extract navigation areas
      const navElements = document.querySelectorAll('nav, [role="navigation"]');
      navElements.forEach((nav, index) => {
        const links = nav.querySelectorAll('a');
        structure.navigation.push({
          index,
          linkCount: links.length,
          ariaLabel: nav.getAttribute('aria-label') || undefined,
          links: Array.from(links).slice(0, 10).map(a => ({
            text: (a.innerText || a.getAttribute('aria-label') || '').trim().substring(0, 50),
            href: a.href
          }))
        });
      });

      // Extract forms with their fields
      const forms = document.querySelectorAll('form');
      forms.forEach((form, index) => {
        const fields = [];
        form.querySelectorAll('input, select, textarea').forEach(field => {
          if (field.type !== 'hidden') {
            fields.push({
              type: field.type || field.tagName.toLowerCase(),
              name: field.name || field.id || undefined,
              label: field.labels?.[0]?.innerText?.trim() ||
                field.placeholder ||
                field.getAttribute('aria-label') || undefined,
              required: field.required || undefined
            });
          }
        });

        if (fields.length > 0) {
          structure.forms.push({
            index,
            action: form.action || undefined,
            method: form.method || 'get',
            fieldCount: fields.length,
            fields: fields.slice(0, 20),
            submitButton: form.querySelector('button[type="submit"], input[type="submit"]')?.innerText || undefined
          });
        }
      });

      // Find main content area
      const main = document.querySelector('main, [role="main"], #main, #content, .main-content');
      if (main) {
        structure.mainContent = {
          selector: getUniqueSelector(main),
          textPreview: main.innerText.trim().substring(0, 200) + '...'
        };
      }

      // Extract landmarks (ARIA regions)
      const landmarks = document.querySelectorAll('[role="banner"], [role="main"], [role="complementary"], [role="contentinfo"], [role="search"], header, footer, aside');
      landmarks.forEach(landmark => {
        const role = landmark.getAttribute('role') || landmark.tagName.toLowerCase();
        structure.landmarks.push({
          role,
          ariaLabel: landmark.getAttribute('aria-label') || undefined,
          selector: getUniqueSelector(landmark)
        });
      });

      // Count interactive elements
      structure.interactiveElements = {
        buttons: document.querySelectorAll('button, [role="button"]').length,
        links: document.querySelectorAll('a[href]').length,
        inputs: document.querySelectorAll('input:not([type="hidden"]), textarea').length,
        selects: document.querySelectorAll('select').length
      };

      return respondWith(structure);
    } catch (e) {
      return respondWithError('PAGE_STRUCTURE_ERROR', e.message);
    }
  },

  labeled_screenshot: () => {
    try {
      // Find all interactive elements that are visible
      const interactiveSelectors = [
        'a[href]', 'button', '[role="button"]',
        'input:not([type="hidden"])', 'textarea', 'select',
        '[onclick]', '[tabindex]:not([tabindex="-1"])'
      ];

      const elements = [];
      let labelIndex = 1;

      interactiveSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
          if (isElementVisible(el)) {
            const rect = el.getBoundingClientRect();
            // Skip very small elements
            if (rect.width < 10 || rect.height < 10) return;

            elements.push({
              index: labelIndex++,
              selector: getUniqueSelector(el),
              tagName: el.tagName.toLowerCase(),
              type: el.type || el.getAttribute('role') || undefined,
              text: (el.innerText || el.value || el.getAttribute('aria-label') || el.placeholder || '').trim().substring(0, 50),
              bounds: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              }
            });
          }
        });
      });

      // Deduplicate by selector
      const seen = new Set();
      const uniqueElements = elements.filter(el => {
        if (seen.has(el.selector)) return false;
        seen.add(el.selector);
        return true;
      });

      // Re-index after dedup
      uniqueElements.forEach((el, i) => el.index = i + 1);

      // Create and inject label overlays
      let overlayContainer = document.getElementById('kapture-labels');
      if (overlayContainer) {
        overlayContainer.remove();
      }

      const docWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, document.documentElement.clientWidth);
      const docHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, document.documentElement.clientHeight);

      overlayContainer = document.createElement('div');
      overlayContainer.id = 'kapture-labels';
      overlayContainer.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: ${docWidth}px;
        height: ${docHeight}px;
        pointer-events: none;
        z-index: 2147483646;
      `;

      uniqueElements.forEach(el => {
        const x = el.bounds.x + window.scrollX;
        const y = el.bounds.y + window.scrollY;

        const label = document.createElement('div');
        label.style.cssText = `
          position: absolute;
          left: ${x}px;
          top: ${y}px;
          background: rgba(255, 0, 0, 0.8);
          color: white;
          font-size: 10px;
          font-weight: bold;
          padding: 1px 4px;
          border-radius: 3px;
          font-family: monospace;
          z-index: 2147483647;
          pointer-events: none;
        `;
        label.textContent = el.index;
        overlayContainer.appendChild(label);

        // Also add a border highlight
        const highlight = document.createElement('div');
        highlight.style.cssText = `
          position: absolute;
          left: ${x}px;
          top: ${y}px;
          width: ${el.bounds.width}px;
          height: ${el.bounds.height}px;
          border: 2px solid rgba(255, 0, 0, 0.6);
          pointer-events: none;
          box-sizing: border-box;
        `;
        overlayContainer.appendChild(highlight);
      });

      document.body.appendChild(overlayContainer);

      return respondWith({
        labelsApplied: true,
        elementCount: uniqueElements.length,
        elements: uniqueElements,
        hint: 'Take a screenshot now to capture the labeled elements. Use clear_labels to remove overlays.'
      });
    } catch (e) {
      return respondWithError('LABELED_SCREENSHOT_ERROR', e.message);
    }
  },

  clear_labels: () => {
    const overlayContainer = document.getElementById('kapture-labels');
    if (overlayContainer) {
      overlayContainer.remove();
      return respondWith({ cleared: true });
    }
    return respondWith({ cleared: false, message: 'No labels to clear' });
  },

  accessibility_tree: ({ selector, xpath, maxDepth = 5, maxNodes = 500 }) => {
    try {
      let rootElement = document.body;
      let nodeCount = 0;
      let truncated = false;

      if (selector || xpath) {
        try {
          rootElement = findAllElements(selector, xpath)[0];
        } catch (e) {
          const errorCode = selector ? 'INVALID_SELECTOR' : 'INVALID_XPATH';
          return respondWithError(errorCode, e.message, selector, xpath);
        }
        if (!rootElement) return elementNotFound(selector, xpath);
      }

      function getAccessibleName(el) {
        // Priority: aria-label > aria-labelledby > alt > title > innerText
        if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');

        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          const labelEl = document.getElementById(labelledBy);
          if (labelEl) return labelEl.innerText?.trim();
        }

        if (el.alt) return el.alt;
        if (el.title) return el.title;
        if (el.labels?.[0]) return el.labels[0].innerText?.trim();

        // For leaf nodes, use text content
        const text = el.innerText?.trim();
        if (text && text.length < 100) return text;

        return undefined;
      }

      function getAccessibleRole(el) {
        // Explicit role takes precedence
        const explicitRole = el.getAttribute('role');
        if (explicitRole) return explicitRole;

        // Implicit roles from tag names
        const tagRoles = {
          'a': el.href ? 'link' : undefined,
          'button': 'button',
          'input': el.type === 'checkbox' ? 'checkbox' :
            el.type === 'radio' ? 'radio' :
              el.type === 'submit' ? 'button' :
                el.type === 'text' || el.type === 'email' || el.type === 'password' ? 'textbox' :
                  el.type,
          'select': 'combobox',
          'textarea': 'textbox',
          'img': 'img',
          'nav': 'navigation',
          'main': 'main',
          'header': 'banner',
          'footer': 'contentinfo',
          'aside': 'complementary',
          'article': 'article',
          'section': el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') ? 'region' : undefined,
          'form': 'form',
          'table': 'table',
          'ul': 'list',
          'ol': 'list',
          'li': 'listitem',
          'h1': 'heading',
          'h2': 'heading',
          'h3': 'heading',
          'h4': 'heading',
          'h5': 'heading',
          'h6': 'heading'
        };

        return tagRoles[el.tagName.toLowerCase()];
      }

      function buildTree(el, depth = 0) {
        if (nodeCount >= maxNodes) {
          truncated = true;
          return null;
        }
        if (depth > maxDepth) return null;
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;

        // Skip hidden elements
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return null;
        if (el.getAttribute('aria-hidden') === 'true') return null;

        const role = getAccessibleRole(el);
        const name = getAccessibleName(el);

        // Build children
        const children = [];
        for (const child of el.children) {
          if (nodeCount >= maxNodes) {
            truncated = true;
            break;
          }
          const childNode = buildTree(child, depth + 1);
          if (childNode) children.push(childNode);
        }

        // Skip generic containers with no role/name and just one child
        if (!role && !name && children.length === 1) {
          return children[0];
        }

        // Skip empty generic containers
        if (!role && !name && children.length === 0) {
          return null;
        }

        nodeCount++;

        const node = {
          role: role || 'generic',
          name: name?.substring(0, 100),
          selector: role || name ? getUniqueSelector(el) : undefined
        };

        // Add relevant states
        if (el.disabled) node.disabled = true;
        if (el.checked) node.checked = true;
        if (el.required) node.required = true;
        if (el.getAttribute('aria-expanded')) node.expanded = el.getAttribute('aria-expanded') === 'true';
        if (el.getAttribute('aria-selected')) node.selected = el.getAttribute('aria-selected') === 'true';
        if (el.tagName.match(/^H[1-6]$/)) node.level = parseInt(el.tagName[1]);

        if (children.length > 0) {
          node.children = children;
        }

        return node;
      }

      const tree = buildTree(rootElement);

      return respondWith({
        tree: tree || { role: 'none', message: 'No accessible content found' },
        nodeCount,
        maxDepth,
        maxNodes,
        truncated
      }, selector, xpath);
    } catch (e) {
      return respondWithError('ACCESSIBILITY_TREE_ERROR', e.message, selector, xpath);
    }
  },

  // ============ VISUAL FEEDBACK TOOLS ============

  highlight({ selector, xpath, duration = 2000, color = 'red', style = 'border' }) {
    if (!selector && !xpath) {
      return respondWithError('SELECTOR_REQUIRED', 'Either selector or xpath is required');
    }

    const elements = findAllElements(selector, xpath);
    if (elements.length === 0) {
      return elementNotFound(selector, xpath, 0);
    }

    const element = elements[0];
    const uniqueSelector = getUniqueSelector(element);

    // Store original styles
    const originalOutline = element.style.outline;
    const originalBackground = element.style.background;
    const originalTransition = element.style.transition;

    // Apply transition for smooth effect
    element.style.transition = 'outline 0.2s ease, background 0.2s ease';

    // Apply highlight based on style
    if (style === 'overlay') {
      element.style.outline = `3px solid ${color}`;
      element.style.background = `${color}33`; // 20% opacity
    } else {
      element.style.outline = `3px solid ${color}`;
    }

    // Remove highlight after duration
    setTimeout(() => {
      element.style.outline = originalOutline;
      element.style.background = originalBackground;
      setTimeout(() => {
        element.style.transition = originalTransition;
      }, 200);
    }, duration);

    return respondWith({
      highlighted: true,
      duration,
      color,
      style
    }, uniqueSelector, xpath);
  },

  // ============ IFRAME TOOLS ============

  list_frames() {
    const frames = [];
    const iframes = document.querySelectorAll('iframe');

    iframes.forEach((iframe, index) => {
      const selector = getUniqueSelector(iframe);
      let src = '';
      let name = '';
      let accessible = false;

      try {
        src = iframe.src || '';
        name = iframe.name || '';
        // Try to access content to check if it's same-origin
        accessible = !!iframe.contentDocument;
      } catch (e) {
        // Cross-origin iframe
        accessible = false;
      }

      frames.push({
        index,
        selector,
        name: name || null,
        src,
        accessible,
        width: iframe.offsetWidth,
        height: iframe.offsetHeight
      });
    });

    return respondWith({
      count: frames.length,
      frames
    });
  },

  switch_to_frame({ frame }) {
    if (!frame) {
      return respondWithError('FRAME_REQUIRED', 'Frame identifier is required');
    }

    // Return to main document
    if (frame === 'main') {
      // This is handled by the content script injection mechanism
      // We just acknowledge the request here
      return respondWith({
        switched: true,
        frame: 'main',
        message: 'Switched to main document context'
      });
    }

    // Find the iframe
    let iframe = null;

    // Try by name first
    iframe = document.querySelector(`iframe[name="${frame}"]`);

    // Try by selector
    if (!iframe) {
      try {
        iframe = document.querySelector(frame);
      } catch (e) {
        // Invalid selector
      }
    }

    if (!iframe || iframe.tagName !== 'IFRAME') {
      return respondWithError('FRAME_NOT_FOUND', `Could not find iframe: ${frame}`);
    }

    // Check if accessible
    try {
      if (!iframe.contentDocument) {
        return respondWithError('FRAME_CROSS_ORIGIN',
          'Cannot access cross-origin iframe. Only same-origin iframes are supported.');
      }
    } catch (e) {
      return respondWithError('FRAME_CROSS_ORIGIN',
        'Cannot access cross-origin iframe. Only same-origin iframes are supported.');
    }

    const uniqueSelector = getUniqueSelector(iframe);

    return respondWith({
      switched: true,
      frame: uniqueSelector,
      src: iframe.src,
      message: 'Frame context switch noted. Commands will target this frame.'
    }, uniqueSelector);
  }
};

// Mouse position tracking with throttling
let lastMouseSendTime = 0;
const MOUSE_THROTTLE_MS = 50; // Throttle to 20 updates per second
let extensionContextValid = true; // Track if extension is still valid

document.addEventListener('mousemove', (event) => {
  // Don't try to send if we know context is invalid
  if (!extensionContextValid) return;

  const now = Date.now();
  if (now - lastMouseSendTime < MOUSE_THROTTLE_MS) return;

  lastMouseSendTime = now;
  try {
    chrome.runtime.sendMessage({
      type: 'mousePosition',
      x: event.clientX,
      y: event.clientY
    }).catch(() => {
      // Extension context invalidated - stop trying
      extensionContextValid = false;
    });
  } catch (e) {
    // Extension context invalidated - stop trying
    extensionContextValid = false;
  }
});

// Listen for requests from the extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request.command) return;
  if (helpers[request.command]) {
    const result = helpers[request.command](request.params);
    Promise.resolve(result).then(sendResponse);
    return true; // Keep channel open for async response
  }
  else {
    sendResponse(respondWith({
      error: { code: 'UNKNOWN_COMMAND', message: `Command '${request.command}' not found` }
    }));
  }
});
