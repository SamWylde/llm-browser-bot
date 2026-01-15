// Popup UI with error detection and auto-recovery

let tabId;
let port;
let isUpdatingUI = false;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 3;

// Get current tab and set up
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  tabId = tabs[0].id;
  tryConnect();
});

// Try to connect to background with error handling
function tryConnect() {
  try {
    // Connect to background
    port = chrome.runtime.connect();

    port.onDisconnect.addListener(() => {
      // Check if this was due to extension context invalidation
      if (chrome.runtime.lastError) {
        showReloadRequired();
        return;
      }
      connectionAttempts++;
      if (connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
        setTimeout(tryConnect, 500);
      } else {
        showReloadRequired();
      }
    });

    port.postMessage({ type: 'subscribe', tabId });

    // Listen for state updates
    port.onMessage.addListener((msg) => {
      if (msg.type === 'state' && msg.tabId === tabId) {
        connectionAttempts = 0; // Reset on successful message
        updateUI(msg.connected, msg.status);
      }
    });

    // Get initial state
    chrome.runtime.sendMessage({ type: 'getState', tabId }, (state) => {
      if (chrome.runtime.lastError) {
        showReloadRequired();
        return;
      }
      if (state) {
        updateUI(state.connected, state.status);
      }
    });
  } catch (e) {
    showReloadRequired();
  }
}

// Handle toggle switch
document.getElementById('toggle').addEventListener('change', (e) => {
  if (isUpdatingUI) return; // Prevent feedback loop

  try {
    if (e.target.checked) {
      chrome.runtime.sendMessage({ type: 'connect', tabId }, (response) => {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError);
          showReloadRequired();
        } else if (response && !response.ok) {
          console.error('Connection failed:', response.error);
          // Revert toggle if connection failed logically
          e.target.checked = false;
          // Show temporary error status
          showError('Failed: ' + (response.error || 'Unknown error'));
        }
      });
    } else {
      chrome.runtime.sendMessage({ type: 'disconnect', tabId });
    }
  } catch (e) {
    showReloadRequired();
  }
});

// Show reload required state
function showReloadRequired() {
  isUpdatingUI = true;

  const toggle = document.getElementById('toggle');
  const toggleContainer = toggle.parentElement;
  const statusEl = document.getElementById('status');
  const statusText = statusEl.querySelector('.status-text');
  const reloadSection = document.getElementById('reload-section');

  // Show error state
  statusEl.classList.remove('connected', 'disconnected', 'retrying');
  toggleContainer.classList.remove('connected', 'disconnected', 'retrying');
  statusEl.classList.add('error');
  toggleContainer.classList.add('error');
  statusText.textContent = 'Reload Required';
  toggle.disabled = true;
  toggle.checked = false;

  // Show reload section
  if (reloadSection) {
    reloadSection.style.display = 'block';
  }

  setTimeout(() => { isUpdatingUI = false; }, 100);
}

// Update UI
function updateUI(connected, status = 'disconnected') {
  isUpdatingUI = true;

  const toggle = document.getElementById('toggle');
  const toggleContainer = toggle.parentElement;
  const statusEl = document.getElementById('status');
  const statusText = statusEl.querySelector('.status-text');
  const reloadSection = document.getElementById('reload-section');

  // Hide reload section on successful connection
  if (reloadSection) {
    reloadSection.style.display = 'none';
  }

  // Remove all state classes
  statusEl.classList.remove('connected', 'disconnected', 'retrying', 'error');
  toggleContainer.classList.remove('connected', 'disconnected', 'retrying', 'error');

  switch (status) {
    case 'connected':
      toggle.checked = true;
      toggle.disabled = false;
      statusEl.classList.add('connected');
      toggleContainer.classList.add('connected');
      statusText.textContent = 'Connected';
      break;

    case 'connecting':
    case 'retrying':
      toggle.checked = true;
      toggle.disabled = false;
      statusEl.classList.add('retrying');
      toggleContainer.classList.add('retrying');
      statusText.textContent = 'Connecting';
      break;

    case 'disconnected':
    default:
      toggle.checked = false;
      toggle.disabled = false;
      statusEl.classList.add('disconnected');
      toggleContainer.classList.add('disconnected');
      statusText.textContent = 'Disconnected';
      break;
  }

  setTimeout(() => { isUpdatingUI = false; }, 100);
}

function showError(message) {
  const statusEl = document.getElementById('status');
  const statusText = statusEl.querySelector('.status-text');

  statusEl.className = 'status-indicator error';
  statusText.textContent = message;

  setTimeout(() => {
    // Revert to disconnected state after 3s
    if (statusEl.classList.contains('error')) {
      updateUI(false, 'disconnected');
    }
  }, 3000);
}