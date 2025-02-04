importScripts("socket.io.min.js"); // Ensure this file is in your extension directory

// Configuration: adjust these URLs as needed.
const API_BASE_URL = "http://localhost:3000"; 
const SOCKET_IO_URL = "http://localhost:3000"; // Socket.IO will connect on the same host/port

// Global variable for the socket.io connection.
let socket = null;

// A flag to indicate connection status.
let isConnected = false;

// Optional: function to show a notification (requires "notifications" permission in your manifest)
function showNotification(title, message) {
  if (chrome.notifications) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png", // Ensure you have an icon file or update this path.
      title: title,
      message: message
    });
  } else {
    console.warn("Notifications API not available.");
  }
}

// Establish socket.io connection with robust retry logic.
function connectSocket() {
  console.log("Attempting to connect to Node API via Socket.IO...");
  socket = io(SOCKET_IO_URL, {
    transports: ["websocket"], // Force WebSocket transport
    reconnectionAttempts: Infinity,
    reconnectionDelay: 3000 // Retry every 3 seconds
  });

  socket.on("connect", () => {
    isConnected = true;
    console.log("Socket.IO connection established.");
    socket.emit("getPendingTasks");
  });

  socket.on("disconnect", () => {
    isConnected = false;
    console.warn("Socket.IO disconnected. Will retry...");
    showNotification("Node API Disconnected", "Please start the Node API server.");
  });

  socket.on("connect_error", (err) => {
    isConnected = false;
    console.error("Socket.IO connection error:", err);
    showNotification("Node API Unavailable", "Waiting for Node API server to start...");
  });

  socket.on("pendingTasks", (tasks) => {
    console.log("Received pending tasks:", tasks);
    if (Array.isArray(tasks)) {
      tasks.forEach(task => {
        executeTask(task);
      });
    }
  });

  socket.on("newTask", (task) => {
    console.log("Received new task:", task);
    if (task && task.taskId && task.command) {
      executeTask(task);
    } else {
      console.warn("Received invalid task:", task);
    }
  });
}

// Start the socket connection on installation/startup.
chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed. Syncing opened tabs and connecting Socket.IO...");
  syncOpenedTabs();
  connectSocket();
});

chrome.runtime.onStartup.addListener(() => {
  console.log("Browser started. Syncing opened tabs and connecting Socket.IO...");
  syncOpenedTabs();
  connectSocket();
});

// --- The remainder of your task execution and tab sync code remains unchanged ---

// Debounce function to avoid flooding the API with rapid requests.
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

const debouncedReportResult = debounce(reportResult, 500);

// Execute the fetched task.
async function executeTask(task) {
  const { taskId, command, tabId, url, jsFunction } = task;
  console.log(`Executing task ${taskId}: ${command}`);
  try {
    let result;
    switch (command) {
      case "open-tab":
        result = await openTab(url);
        break;
      case "close-tab":
        if (!tabId) throw new Error("Missing tabId for close-tab");
        result = await closeTab(tabId, taskId);
        break;
      case "execute-js":
        if (!tabId || !jsFunction) throw new Error("Missing tabId or jsFunction for execute-js");
        result = await executeJSInTab(tabId, jsFunction);
        break;
      case "switch-tab":
        if (!tabId) throw new Error("Missing tabId for switch-tab");
        result = await switchTab(tabId);
        break;
      default:
        throw new Error(`Unknown command: ${command}`);
    }
    console.log(`Task ${taskId} executed successfully:`, result);
    await debouncedReportResult(taskId, result);
  } catch (error) {
    console.error(`Task execution error for ${taskId}:`, error);
    await reportError(taskId, error.message);
  }
}


function openTab(url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url }, (tab) => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError.message);
      }
      // Listener to check when the tab has fully loaded
      const checkTabLoaded = (updatedTabId, changeInfo, updatedTab) => {
        if (updatedTabId === tab.id && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(checkTabLoaded);
          chrome.windows.get(tab.windowId, {}, (window) => {
            if (chrome.runtime.lastError) {
              return reject(chrome.runtime.lastError.message);
            }
            resolve({ tabId: tab.id, windowId: tab.windowId, url: updatedTab.url });
          });
        }
      };
      chrome.tabs.onUpdated.addListener(checkTabLoaded);
    });
  });
}

function closeTab(tabId, taskId) {
  return new Promise((resolve, reject) => {
    if (!tabId) {
      return reject("No tabId provided to close-tab command");
    }
    chrome.tabs.remove(tabId, () => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError.message);
      }
      
      console.log(`Tab closed: ID=${tabId}`);

      // Report result using the original taskId (fixes timeout issue)
      reportResult(taskId, { closedTabId: tabId });

      resolve({ closedTabId: tabId });
    });
  });
}



async function executeJSInTab(tabId, jsFunction) {
  if (!tabId) {
    throw new Error("No tabId provided to execute-js command");
  }
  if (!jsFunction) {
    throw new Error("No jsFunction provided for execution");
  }
  try {
    const [{ result, error }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (code) => {
        return new Promise((resolve, reject) => {
          const resultId = "result_" + Date.now();
          let blobURL, script;
          function messageListener(event) {
            if (event.data && event.data.resultId === resultId) {
              window.removeEventListener("message", messageListener);
              if (script && script.parentNode) {
                script.parentNode.removeChild(script);
              }
              if (blobURL) {
                URL.revokeObjectURL(blobURL);
              }
              if (event.data.error) {
                reject(event.data.error);
              } else {
                resolve(event.data.result);
              }
            }
          }
          window.addEventListener("message", messageListener);
          const scriptContent = `
            (function() {
              try {
                const result = (function() { ${code} })();
                window.postMessage({ resultId: '${resultId}', result: result }, "*");
              } catch(e) {
                window.postMessage({ resultId: '${resultId}', error: e.toString() }, "*");
              }
            })();
          `;
          const blob = new Blob([scriptContent], { type: 'text/javascript' });
          blobURL = URL.createObjectURL(blob);
          script = document.createElement("script");
          script.src = blobURL;
          document.body.appendChild(script);
        });
      },
      args: [jsFunction],
    });
    if (error) throw new Error(error);
    return { result: result };
  } catch (error) {
    throw new Error(`Failed to execute JS in tab ${tabId}: ${error.message}`);
  }
}

async function switchTab(tabId) {
  if (!tabId) {
    throw new Error("No tabId provided to switch-tab command");
  }
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) {
      throw new Error(`Tab with ID ${tabId} does not exist.`);
    }
    await chrome.tabs.update(tabId, { active: true });
    return { switchedToTabId: tabId };
  } catch (error) {
    throw new Error(`Failed to switch to tab ${tabId}: ${error.message}`);
  }
}

async function reportResult(taskId, data) {
  try {
    const response = await fetch(`${API_BASE_URL}/report-result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

async function reportError(taskId, errorMessage) {
  try {
    const response = await fetch(`${API_BASE_URL}/report-result/error`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

async function syncOpenedTabs() {
  try {
    console.log("Syncing opened tabs with the server...");
    chrome.tabs.query({}, async (tabs) => {
      const tabsToSync = tabs.map((tab) => ({
        tabId: tab.id,
        windowId: tab.windowId,
        url: tab.url,
      }));
      const response = await fetch(`${API_BASE_URL}/sync-tabs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

chrome.tabs.onCreated.addListener((tab) => {
  console.log(`Tab created: ID=${tab.id}, WindowID=${tab.windowId}, URL=${tab.url}`);
  const autoTaskId = `auto-open-${tab.id}-${Date.now()}`;
  debouncedReportResult(autoTaskId, { tabId: tab.id, windowId: tab.windowId, url: tab.url });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  console.log(`Tab closed: ID=${tabId}`);
  const autoTaskId = `auto-close-${tabId}-${Date.now()}`;
  debouncedReportResult(autoTaskId, { closedTabId: tabId });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    console.log(`Tab updated: ID=${tabId}, New URL=${changeInfo.url}`);
    const autoTaskId = `auto-update-${tabId}-${Date.now()}`;
    debouncedReportResult(autoTaskId, { tabId: tabId, windowId: tab.windowId, url: tab.url });
  }
});

chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
  console.log(`Tab moved: ID=${tabId}, From Index=${moveInfo.fromIndex}, To Index=${moveInfo.toIndex}, WindowID=${moveInfo.windowId}`);
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) {
      console.error(`Error fetching tab ${tabId}:`, chrome.runtime.lastError.message);
      return;
    }
    const autoTaskId = `auto-move-${tabId}-${Date.now()}`;
    debouncedReportResult(autoTaskId, { tabId: tab.id, windowId: tab.windowId, url: tab.url });
  });
});

chrome.windows.onCreated.addListener((window) => {
  console.log(`Window created: ID=${window.id}, Type=${window.type}`);
});

chrome.windows.onRemoved.addListener((windowId) => {
  console.log(`Window closed: ID=${windowId}`);
});
