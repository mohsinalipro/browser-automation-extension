// background.js

const API_BASE_URL = "http://localhost:3000"; 
// Update to your actual Node.js API base URL

const POLL_INTERVAL = 3000;
let pollingTimer = null;

// Event Listeners for Installation and Startup
chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed. Starting polling and syncing opened tabs...");
  syncOpenedTabs(); // Sync opened tabs on installation
  startPollingTasks();
});

// Sync on browser startup
chrome.runtime.onStartup.addListener(() => {
  console.log("Browser started. Syncing opened tabs...");
  syncOpenedTabs();
  startPollingTasks();
});

// Debounce function to prevent flooding the server with rapid requests
const debounce = (func, delay) => {
  let timerId;
  return (...args) => {
    if (timerId) clearTimeout(timerId);
    timerId = setTimeout(() => {
      func.apply(null, args);
      timerId = null;
    }, delay);
  };
};

// Debounced version of reportResult
const debouncedReportResult = debounce(reportResult, 500);

// Start polling for tasks
function startPollingTasks() {
  if (!pollingTimer) {
    pollingTimer = setInterval(fetchTask, POLL_INTERVAL);
    console.log(`Started polling every ${POLL_INTERVAL / 1000} seconds.`);
  }
}

// Fetch the next available task
async function fetchTask() {
  try {
    console.log("Polling /get-task for new tasks...");
    const response = await fetch(`${API_BASE_URL}/get-task`);
    if (!response.ok) {
      console.error("Failed to fetch task:", response.statusText);
      return;
    }

    const task = await response.json();
    console.log("Fetched task:", task);
    // If no tasks available, the server returns empty object {}
    if (!task || !task.taskId) {
      console.log("No task available at this time.");
      return;
    }

    await executeTask(task);
  } catch (error) {
    console.error("Error fetching task:", error);
  }
}

// Execute the fetched task
async function executeTask(task) {
  const { taskId, command, tabId, url, jsFunction } = task;
  console.log(`Executing task ${taskId}: ${command}`);
  try {
    let result;

    switch (command) {
      case "open-tab":
        // tabId is not provided by the API in this scenario
        result = await openTab(url);
        break;
      case "close-tab":
        result = await closeTab(tabId);
        break;
      case "execute-js":
        result = await executeJSInTab(tabId, jsFunction);
        break;
      case "switch-tab":
        result = await switchTab(tabId);
        break;
      default:
        throw new Error(`Unknown command: ${command}`);
    }

    console.log(`Task ${taskId} executed successfully:`, result);
    // Report success
    await debouncedReportResult(taskId, result);
  } catch (error) {
    console.error(`Task execution error for ${taskId}:`, error);
    // Report error
    await reportError(taskId, error.message);
  }
}

// Open a new tab (no existing tabId)
function openTab(url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url }, (tab) => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError.message);
      }
      // Fetch window details
      chrome.windows.get(tab.windowId, {}, (window) => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError.message);
        }
        // Return tab details including windowId
        resolve({ tabId: tab.id, windowId: tab.windowId, url: tab.url });
      });
    });
  });
}

// Close an existing tab by tabId (if we have it)
function closeTab(tabId) {
  return new Promise((resolve, reject) => {
    if (!tabId) {
      return reject("No tabId provided to close-tab command");
    }
    chrome.tabs.remove(tabId, () => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError.message);
      }
      resolve({ closedTabId: tabId });
    });
  });
}

// Execute a JavaScript function string in a specified tab
async function executeJSInTab(tabId, jsFunction) {
  if (!tabId) {
    throw new Error("No tabId provided to execute-js command");
  }
  if (!jsFunction) {
    throw new Error("No jsFunction provided for execution");
  }
  try {
    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: new Function(jsFunction), // Convert string to function
    });
    return { result: injectionResults[0]?.result };
  } catch (error) {
    throw new Error(`Failed to execute JS in tab ${tabId}: ${error.message}`);
  }
}

// New Function: Switch Tab by tabId
async function switchTab(tabId) {
  if (!tabId) {
    throw new Error("No tabId provided to switch-tab command");
  }
  try {
    // Query the tab to ensure it exists
    const tab = await chrome.tabs.get(tabId);
    if (!tab) {
      throw new Error(`Tab with ID ${tabId} does not exist.`);
    }
    // Update the tab to make it active (focused)
    await chrome.tabs.update(tabId, { active: true });
    return { switchedToTabId: tabId };
  } catch (error) {
    throw new Error(`Failed to switch to tab ${tabId}: ${error.message}`);
  }
}

// Report success to the API
async function reportResult(taskId, data) {
  try {
    const response = await fetch(`${API_BASE_URL}/report-result`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ taskId, data }),
    });

    if (!response.ok) {
      console.error(`Failed to report result for task ${taskId}:`, response.statusText);
    } else {
      console.log(`Reported result for task ${taskId}`);
    }
  } catch (error) {
    console.error(`Error reporting result for task ${taskId}:`, error);
  }
}

// Report error to the API
async function reportError(taskId, errorMessage) {
  try {
    const response = await fetch(`${API_BASE_URL}/report-result/error`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ taskId, error: errorMessage }),
    });

    if (!response.ok) {
      console.error(`Failed to report error for task ${taskId}:`, response.statusText);
    } else {
      console.log(`Reported error for task ${taskId}`);
    }
  } catch (error) {
    console.error(`Error reporting error for task ${taskId}:`, error);
  }
}

/**
 * Sync all currently opened browser tabs with the Node.js API.
 * This function sends all open tabs and windows to the server, effectively overwriting openedTabs.json.
 */
async function syncOpenedTabs() {
  try {
    console.log("Syncing opened tabs with the server...");
    // Query all currently open tabs
    chrome.tabs.query({}, async (tabs) => {
      const tabsToSync = tabs.map((tab) => ({
        tabId: tab.id,
        windowId: tab.windowId,
        url: tab.url,
      }));

      // Send the list to the server
      const response = await fetch(`${API_BASE_URL}/sync-tabs`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ tabs: tabsToSync }),
      });

      if (!response.ok) {
        console.error("Failed to sync opened tabs:", response.statusText);
        return;
      }

      const result = await response.json();
      if (result.success) {
        console.log(`Successfully synced ${tabsToSync.length} tabs with the server.`);
      } else {
        console.error("Sync opened tabs failed:", result.error);
      }
    });
  } catch (error) {
    console.error("Error syncing opened tabs:", error);
  }
}

/**
 * Listen to tab creation and removal events to sync in real-time.
 */
chrome.tabs.onCreated.addListener((tab) => {
  console.log(`Tab created: ID=${tab.id}, WindowID=${tab.windowId}, URL=${tab.url}`);
  // Report the new tab to the server
  // Using a unique taskId for auto-generated events
  const autoTaskId = `auto-open-${tab.id}-${Date.now()}`;
  debouncedReportResult(autoTaskId, { tabId: tab.id, windowId: tab.windowId, url: tab.url });
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  console.log(`Tab closed: ID=${tabId}`);
  // Report the closed tab to the server
  const autoTaskId = `auto-close-${tabId}-${Date.now()}`;
  debouncedReportResult(autoTaskId, { closedTabId: tabId });
});

/**
 * Listen to tab updates (e.g., URL changes) to sync in real-time.
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    console.log(`Tab updated: ID=${tabId}, New URL=${changeInfo.url}`);
    // Report the updated tab to the server
    const autoTaskId = `auto-update-${tabId}-${Date.now()}`;
    debouncedReportResult(autoTaskId, { tabId: tabId, windowId: tab.windowId, url: changeInfo.url });
  }
});

/**
 * Listen to tab movement (e.g., moving a tab to a different window) to sync in real-time.
 */
chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
  console.log(`Tab moved: ID=${tabId}, From Index=${moveInfo.fromIndex}, To Index=${moveInfo.toIndex}, WindowID=${moveInfo.windowId}`);
  // Fetch the updated tab details
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) {
      console.error(`Error fetching tab ${tabId}:`, chrome.runtime.lastError.message);
      return;
    }
    // Report the moved tab to the server
    const autoTaskId = `auto-move-${tabId}-${Date.now()}`;
    debouncedReportResult(autoTaskId, { tabId: tab.id, windowId: tab.windowId, url: tab.url });
  });
});

/**
 * Listen to window creation and removal events if needed.
 * Currently, window events are handled via tab events.
 */
chrome.windows.onCreated.addListener((window) => {
  console.log(`Window created: ID=${window.id}, Type=${window.type}`);
  // Optionally, report this to the server
});

chrome.windows.onRemoved.addListener((windowId) => {
  console.log(`Window closed: ID=${windowId}`);
  // Optionally, handle cleanup or report to the server
});
