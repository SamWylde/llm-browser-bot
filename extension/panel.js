// DevTools Panel UI with Real Connection and Data

// Debug what you're actually getting
console.log('inspectedWindow.tabId:', chrome.devtools.inspectedWindow.tabId);

// Let's also check what chrome.tabs.query gives us for comparison
chrome.tabs.query({}, (tabs) => {
  console.log('All tabs:', tabs);

  // Find the tab with the same ID
  const inspectedTab = tabs.find(tab => tab.id === chrome.devtools.inspectedWindow.tabId);
  console.log('Inspected tab details:', inspectedTab);
});

// Also check the inspected window URL
console.log('inspectedWindow.url:', chrome.devtools.inspectedWindow.url);

// Check if we are in DevTools
if (!chrome.devtools || !chrome.devtools.inspectedWindow) {
  document.body.innerHTML = `
    <div style="padding: 20px; color: #ccc; font-family: sans-serif;">
      <h2>LLM Browser Bot Panel</h2>
      <p>This panel is designed to be used within Chrome Developer Tools.</p>
      <p>Please press <strong>F12</strong> to open Developer Tools, then click the <strong>LLM Bot</strong> tab.</p>
    </div>
  `;
  throw new Error('Not in DevTools');
}

const tabId = chrome.devtools.inspectedWindow.tabId;
let selectedGroupId = null;
let messages = [];
let consoleLogCount = 0;
let port = null;
let messageFilter = '';
let visibleGroups = [];

// Initialize UI
function initializeUI() {
  // Connect to background script
  port = chrome.runtime.connect({ name: 'panel' });

  // Listen for state updates
  port.onMessage.addListener((msg) => {
    if (msg.type === 'state' && msg.tabId === tabId) {
      updateUI(msg.connected, msg.status);
    } else if (msg.type === 'messages' && msg.tabId === tabId) {
      // Update messages from background
      messages = msg.messages || [];
      renderMessages();
    } else if (msg.type === 'consoleCount' && msg.tabId === tabId) {
      // Update console count from background
      consoleLogCount = msg.count || 0;
      updateConsoleCount();
    }
  });

  // Subscribe to state updates for this tab
  port.postMessage({ type: 'subscribe', tabId });

  // Event listeners
  document.getElementById('toggle').addEventListener('change', handleToggleChange);
  document.getElementById('clear-logs').addEventListener('click', handleClearLogs);
  document.getElementById('clear-messages').addEventListener('click', handleClearMessages);
  document.getElementById('messages-list').addEventListener('click', handleMessageClick);
  document.getElementById('message-filter').addEventListener('input', (event) => {
    messageFilter = event.target.value || '';
    renderMessages();
  });
  document.addEventListener('keydown', handleKeyDown);

  // Resize handle
  initializeResizeHandle();

  // Start health polling
  startHealthPolling();
}

// Update UI based on connection state
function updateUI(connected, status = 'disconnected') {
  const toggle = document.getElementById('toggle');
  const toggleContainer = toggle.parentElement;
  const statusEl = document.getElementById('status');
  const statusText = statusEl.querySelector('.status-text');
  const tabInfo = document.getElementById('tab-info');

  // Remove existing classes
  statusEl.classList.remove('connected', 'disconnected', 'retrying');
  toggleContainer.classList.remove('connected', 'disconnected', 'retrying');

  switch (status) {
    case 'connected':
      toggle.checked = true;
      toggle.disabled = false;
      statusEl.classList.add('connected');
      toggleContainer.classList.add('connected');
      statusText.textContent = 'Connected';
      tabInfo.textContent = `Tab: ${tabId} - Connected`;
      break;

    case 'retrying':
      toggle.checked = true;
      toggle.disabled = false;
      statusEl.classList.add('retrying');
      toggleContainer.classList.add('retrying');
      statusText.textContent = 'Retrying...';
      tabInfo.textContent = `Tab: ${tabId} - Reconnecting`;
      break;

    case 'disconnected':
    default:
      toggle.checked = false;
      toggle.disabled = false;
      statusEl.classList.add('disconnected');
      toggleContainer.classList.add('disconnected');
      statusText.textContent = 'Disconnected';
      tabInfo.textContent = 'Tab: Not connected';
      break;
  }
}

// Render messages
function renderMessages() {
  const messagesList = document.getElementById('messages-list');
  const messagesContainer = document.querySelector('.messages-container');
  visibleGroups = buildMessageGroups(messages, messageFilter);

  // Toggle class based on whether we have messages
  messagesContainer.classList.toggle('has-messages', visibleGroups.length > 0);

  const emptyState = document.getElementById('empty-state');
  if (messages.length === 0) {
    emptyState.textContent = 'No messages yet';
  } else if (visibleGroups.length === 0) {
    emptyState.textContent = 'No messages match the filter';
  }

  if (!visibleGroups.find(group => group.groupId === selectedGroupId)) {
    selectedGroupId = null;
    const detailContainer = document.getElementById('detail-container');
    detailContainer.classList.remove('visible');
  }

  messagesList.innerHTML = '';

  visibleGroups.forEach((group) => {
    const groupEl = document.createElement('div');
    groupEl.className = 'message-group';
    if (group.groupId === selectedGroupId) {
      groupEl.classList.add('selected');
    }
    groupEl.dataset.groupId = group.groupId;

    const headerEl = document.createElement('div');
    headerEl.className = 'message-group-header';

    const titleEl = document.createElement('div');
    titleEl.className = 'message-group-title';

    const commandEl = document.createElement('div');
    commandEl.className = 'message-group-command';
    commandEl.textContent = group.commandName || 'message';

    const metaEl = document.createElement('div');
    metaEl.className = 'message-group-meta';
    const idLabel = group.commandId ? `ID: ${group.commandId}` : 'No ID';
    metaEl.textContent = `${idLabel} • ${group.messages.length} message${group.messages.length === 1 ? '' : 's'}`;

    titleEl.appendChild(commandEl);
    titleEl.appendChild(metaEl);

    const timeEl = document.createElement('div');
    timeEl.className = 'message-group-time';
    timeEl.textContent = formatTime(group.lastTimestamp);

    headerEl.appendChild(titleEl);
    headerEl.appendChild(timeEl);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'message-group-body';

    group.messages.forEach((msg) => {
      bodyEl.appendChild(createMessageEntry(msg));
    });

    groupEl.appendChild(headerEl);
    groupEl.appendChild(bodyEl);
    messagesList.appendChild(groupEl);
  });

  updateMessageSummary();
}

// Format timestamp
function formatTime(date) {
  // Convert string to Date if needed
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return dateObj.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// Handle message click
function handleMessageClick(e) {
  const headerEl = e.target.closest('.message-group-header');
  if (!headerEl) return;
  const groupEl = headerEl.closest('.message-group');
  if (!groupEl) return;
  const groupId = groupEl.dataset.groupId;
  selectGroup(groupId);
}

// Select message
function selectGroup(groupId) {
  selectedGroupId = groupId;

  document.querySelectorAll('.message-group').forEach((el) => {
    el.classList.toggle('selected', el.dataset.groupId === groupId);
  });

  // Show detail view
  const detailContainer = document.getElementById('detail-container');
  const detailContent = document.getElementById('detail-content');

  const group = visibleGroups.find(item => item.groupId === groupId);
  if (group) {
    detailContainer.classList.add('visible');
    detailContent.innerHTML = '';
    detailContent.appendChild(renderGroupDetail(group));
  } else {
    detailContainer.classList.remove('visible');
  }
}

// Handle keyboard navigation
function handleKeyDown(e) {
  if (visibleGroups.length === 0) {
    return;
  }

  const currentIndex = visibleGroups.findIndex(group => group.groupId === selectedGroupId);

  if (e.key === 'ArrowUp' && currentIndex > 0) {
    selectGroup(visibleGroups[currentIndex - 1].groupId);
    e.preventDefault();
  } else if (e.key === 'ArrowDown' && currentIndex < visibleGroups.length - 1) {
    selectGroup(visibleGroups[currentIndex + 1].groupId);
    e.preventDefault();
  } else if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    // Clear messages
    handleClearMessages();
    e.preventDefault();
  }
}

// Handle toggle change
function handleToggleChange(e) {
  const checked = e.target.checked;

  chrome.runtime.sendMessage(
    {
      type: checked ? 'connect' : 'disconnect',
      tabId: tabId
    },
    (response) => {
      if (response?.error) {
        console.error('Toggle error:', response.error);
      }
    }
  );
}

// Handle clear logs
function handleClearLogs() {
  // Request background to clear console logs
  port.postMessage({ type: 'clearConsoleLogs', tabId });
}

// Handle clear messages
function handleClearMessages() {
  // Request background to clear messages
  port.postMessage({ type: 'clearMessages', tabId });

  // Clear the detail view
  const detailContainer = document.getElementById('detail-container');
  detailContainer.classList.remove('visible');
  selectedGroupId = null;
}

// Update console count
function updateConsoleCount() {
  document.getElementById('console-count').textContent = `Console: ${consoleLogCount}`;
}

function buildMessageGroups(allMessages, filterText) {
  const groupsMap = new Map();

  allMessages.forEach((msg) => {
    const commandId = msg.data?.id;
    const groupId = commandId !== undefined && commandId !== null ? `id:${commandId}` : `msg:${msg.id}`;

    if (!groupsMap.has(groupId)) {
      groupsMap.set(groupId, {
        groupId,
        commandId,
        commandName: null,
        messages: [],
        firstTimestamp: msg.timestamp,
        lastTimestamp: msg.timestamp
      });
    }

    const group = groupsMap.get(groupId);
    group.messages.push(msg);
    group.lastTimestamp = msg.timestamp;

    const commandName = getMessageCommandName(msg);
    if (commandName && !group.commandName) {
      group.commandName = commandName;
    }
  });

  const groups = Array.from(groupsMap.values())
    .sort((a, b) => new Date(a.lastTimestamp) - new Date(b.lastTimestamp));

  if (!filterText) {
    return groups;
  }

  const normalized = filterText.toLowerCase();
  return groups.filter(group => groupMatchesFilter(group, normalized));
}

function groupMatchesFilter(group, normalized) {
  const commandText = `${group.commandName || ''}`.toLowerCase();
  const idText = `${group.commandId ?? ''}`.toLowerCase();
  if (commandText.includes(normalized) || idText.includes(normalized)) {
    return true;
  }

  return group.messages.some(msg => {
    const preview = JSON.stringify(msg.data || {});
    return preview.toLowerCase().includes(normalized);
  });
}

function getMessageCommandName(message) {
  if (message.data?.command) {
    return message.data.command;
  }
  if (message.data?.method) {
    return message.data.method;
  }
  if (message.data?.type) {
    return message.data.type;
  }
  return 'message';
}

function createMessageEntry(message) {
  const details = document.createElement('details');
  details.className = 'message-entry';

  const summary = document.createElement('summary');

  const direction = document.createElement('span');
  direction.className = `message-direction ${message.direction}`;
  direction.textContent = message.direction === 'outgoing' ? '↑' : '↓';

  const preview = document.createElement('span');
  preview.className = 'message-entry-preview';
  preview.textContent = getMessagePreview(message);

  const time = document.createElement('span');
  time.className = 'message-entry-time';
  time.textContent = formatTime(message.timestamp);

  summary.appendChild(direction);
  summary.appendChild(preview);
  summary.appendChild(time);

  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(message.data, null, 2);

  details.appendChild(summary);
  details.appendChild(pre);

  return details;
}

function getMessagePreview(message) {
  const previewText = JSON.stringify(message.data || {});
  if (previewText.length <= 160) {
    return previewText;
  }
  return `${previewText.slice(0, 160)}…`;
}

function renderGroupDetail(group) {
  const container = document.createElement('div');
  container.className = 'detail-group';

  const header = document.createElement('div');
  header.className = 'detail-group-header';
  const title = document.createElement('strong');
  title.textContent = group.commandName || 'message';
  const meta = document.createElement('span');
  const idLabel = group.commandId ? `ID: ${group.commandId}` : 'No ID';
  meta.textContent = `${idLabel} • ${group.messages.length} message${group.messages.length === 1 ? '' : 's'}`;
  header.appendChild(title);
  header.appendChild(meta);
  container.appendChild(header);

  group.messages.forEach((message) => {
    const entry = document.createElement('details');
    entry.className = 'detail-entry';

    const summary = document.createElement('summary');
    const direction = document.createElement('span');
    direction.className = `message-direction ${message.direction}`;
    direction.textContent = message.direction === 'outgoing' ? '↑' : '↓';
    const label = document.createElement('span');
    label.textContent = getMessageCommandName(message);
    const time = document.createElement('span');
    time.textContent = formatTime(message.timestamp);
    time.style.marginLeft = 'auto';
    time.style.color = 'var(--text-secondary)';
    summary.appendChild(direction);
    summary.appendChild(label);
    summary.appendChild(time);

    entry.appendChild(summary);

    const screenshotData = getScreenshotData(message.data);
    if (screenshotData) {
      const screenshotWrapper = document.createElement('div');
      screenshotWrapper.className = 'detail-screenshot';

      const img = document.createElement('img');
      img.src = `data:${screenshotData.mimeType};base64,${screenshotData.data}`;
      img.style.cssText = 'max-width: 100%; height: auto; cursor: pointer; display: block; border: 1px solid #e0e0e0; border-radius: 4px;';
      img.title = 'Click to open in new tab';
      img.addEventListener('click', () => {
        window.open(img.src, '_blank');
      });

      screenshotWrapper.appendChild(img);
      entry.appendChild(screenshotWrapper);
    }

    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(message.data, null, 2);
    entry.appendChild(pre);

    container.appendChild(entry);
  });

  return container;
}

function getScreenshotData(data) {
  if (!data || data.type !== 'response' || !data.success || !data.result) {
    return null;
  }
  if (!data.result.data || !data.result.mimeType) {
    return null;
  }
  if (!data.result.mimeType.startsWith('image/')) {
    return null;
  }
  return {
    data: data.result.data,
    mimeType: data.result.mimeType
  };
}

function updateMessageSummary() {
  const summaryEl = document.getElementById('messages-summary');
  summaryEl.textContent = `${visibleGroups.length} group${visibleGroups.length === 1 ? '' : 's'}`;
}

async function fetchServerHealth() {
  const healthEl = document.getElementById('server-health');
  const endpoints = ['http://localhost:61822/health', 'http://localhost:61822/status'];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Status ${response.status}`);
      }
      const data = await response.json();
      const connectionCount = data.connections?.total ?? 0;
      const tabCount = data.tabs?.total ?? 0;
      const uptimeMs = data.uptimeMs ?? 0;
      const uptimeMinutes = Math.floor(uptimeMs / 60000);
      healthEl.textContent = `Server: OK • ${connectionCount} connection${connectionCount === 1 ? '' : 's'} • ${tabCount} tab${tabCount === 1 ? '' : 's'} • ${uptimeMinutes}m uptime`;
      return;
    } catch (error) {
      continue;
    }
  }

  healthEl.textContent = 'Server: Unreachable';
}

function startHealthPolling() {
  fetchServerHealth();
  setInterval(fetchServerHealth, 10000);
}

// Initialize resize handle
function initializeResizeHandle() {
  const resizeHandle = document.getElementById('resize-handle');
  const detailContainer = document.getElementById('detail-container');
  let isResizing = false;
  let startY = 0;
  let startHeight = 0;

  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startY = e.clientY;
    startHeight = detailContainer.offsetHeight;
    document.body.style.cursor = 'ns-resize';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const deltaY = startY - e.clientY;
    const newHeight = Math.min(Math.max(100, startHeight + deltaY), 500);
    detailContainer.style.height = `${newHeight}px`;
  });

  document.addEventListener('mouseup', () => {
    isResizing = false;
    document.body.style.cursor = '';
  });
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initializeUI);
