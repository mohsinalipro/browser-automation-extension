// index.js

const express = require("express");
const bodyParser = require("body-parser");
// const cors = require("cors");
const TaskQueue = require("./managers/TaskQueue");
const TabManager = require("./managers/TabManager");
const winston = require("winston");

const app = express();
app.use(bodyParser.json());

// Setup CORS to allow requests from the extension
// app.use(cors({
//   origin: "chrome-extension://<your-extension-id>", // Replace with your actual extension ID
//   methods: ["GET", "POST"],
//   allowedHeaders: ["Content-Type"],
// }));

// Setup Winston logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "server.log" }),
  ],
});

// Middleware to log each request
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url} - Body: ${JSON.stringify(req.body)}`);
  next();
});

const taskQueue = new TaskQueue();
const tabManager = new TabManager(); // Loads or initializes openedTabs.json

// Map to track pending tasks and their corresponding Promise resolvers
const pendingTasks = new Map();

/**
 * Utility function to wait for a task to be completed or timeout.
 * @param {string} taskId - The unique identifier for the task.
 * @param {number} timeoutMs - Timeout in milliseconds.
 * @returns {Promise} - Resolves with task data or rejects on timeout/error.
 */
function waitForTaskCompletion(taskId, timeoutMs = 30000) { // 30 seconds timeout
  return new Promise((resolve, reject) => {
    // Store the resolve and reject functions in the pendingTasks map
    pendingTasks.set(taskId, { resolve, reject });

    // Set up a timeout to reject the promise if not resolved in time
    const timeout = setTimeout(() => {
      if (pendingTasks.has(taskId)) {
        pendingTasks.get(taskId).reject(new Error("Task timed out."));
        pendingTasks.delete(taskId);
      }
    }, timeoutMs);

    // Attach the timeout to the resolver for cleanup
    pendingTasks.get(taskId).timeout = timeout;
  });
}

// ------------------------------------
// 1. Add a Task (No tabId needed for open-tab)
app.post("/add-task", async (req, res) => {
  try {
    const { taskId, command, url, jsFunction, tabId } = req.body;

    // Validate command
    const validCommands = ["open-tab", "close-tab", "find-tab", "execute-js"];
    if (!validCommands.includes(command)) {
      return res.status(400).json({ success: false, error: `Invalid command: ${command}` });
    }

    // Generate a unique taskId if not provided
    const newTaskId = taskId || `task-${Date.now()}`;

    const task = {
      taskId: newTaskId,
      command,
      tabId: tabId || null,
      url: url || null,
      jsFunction: jsFunction || null,
    };

    taskQueue.addTask(task);
    logger.info(`Added task: ${JSON.stringify(task)}`);

    // Wait for the task to be completed
    try {
      const result = await waitForTaskCompletion(newTaskId);
      res.json({ success: true, task, result });
    } catch (error) {
      logger.error(`Task ${newTaskId} failed: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  } catch (error) {
    logger.error(`Error in /add-task: ${error.message}`);
    res.status(400).json({ success: false, error: error.message });
  }
});

// ------------------------------------
// 2. Get the Next Available Task
app.get("/get-task", (req, res) => {
  try {
    const nextTask = taskQueue.getNextTask();
    if (nextTask) {
      logger.info(`Providing next task: ${JSON.stringify(nextTask)}`);
      res.json(nextTask);
    } else {
      logger.info("No tasks available to provide.");
      res.json({});
    }
  } catch (error) {
    logger.error(`Error in /get-task: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ------------------------------------
// 3. Report a Successful Result
app.post("/report-result", (req, res) => {
  try {
    const { taskId, data } = req.body;
    logger.info(`Task ${taskId} completed successfully: ${JSON.stringify(data)}`);

    // If this was an open-tab or tab update command, data includes { tabId, windowId, url }
    if (data && data.tabId && data.windowId && data.url) {
      tabManager.addOrUpdateTab(data.tabId, data.windowId, data.url);
      logger.info(`Added/Updated tab ${data.tabId} in window ${data.windowId} with URL ${data.url}`);
    }

    // If this was a close-tab command, data includes { closedTabId }
    if (data && data.closedTabId) {
      tabManager.removeClosedTab(data.closedTabId);
      logger.info(`Removed tab ${data.closedTabId}`);
    }

    // Resolve the pending task if it exists
    if (pendingTasks.has(taskId)) {
      const { resolve, timeout } = pendingTasks.get(taskId);
      clearTimeout(timeout); // Clear the timeout
      resolve(data);
      pendingTasks.delete(taskId);
    }

    res.json({ success: true });
  } catch (error) {
    logger.error(`Error in /report-result: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ------------------------------------
// 4. Get All Opened Tabs (Public Endpoint)
app.get("/opened-tabs", (req, res) => {
  try {
    const allTabs = tabManager.getAllOpenedTabs();
    res.json({ success: true, tabs: allTabs });
  } catch (error) {
    logger.error(`Error in /opened-tabs: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ------------------------------------
// 5. Report an Error
app.post("/report-result/error", (req, res) => {
  try {
    const { taskId, error: errorMsg } = req.body;
    logger.error(`Task ${taskId} failed with error: ${errorMsg}`);

    // Reject the pending task if it exists
    if (pendingTasks.has(taskId)) {
      const { reject, timeout } = pendingTasks.get(taskId);
      clearTimeout(timeout); // Clear the timeout
      reject(new Error(errorMsg));
      pendingTasks.delete(taskId);
    }

    res.json({ success: true });
  } catch (error) {
    logger.error(`Error in /report-result/error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ------------------------------------
// 6. Sync Opened Tabs (New Endpoint)
app.post("/sync-tabs", async (req, res) => {
  try {
    const { tabs } = req.body; // Expecting an array of { tabId, windowId, url }

    if (!Array.isArray(tabs)) {
      return res.status(400).json({ success: false, error: "Invalid tabs format. Expected an array." });
    }

    // Replace the entire list of opened tabs and windows
    tabManager.replaceAllTabs(tabs);

    logger.info(`Synchronized ${tabs.length} tabs from the extension.`);

    res.json({ success: true, syncedTabs: tabs });
  } catch (error) {
    logger.error(`Error in /sync-tabs: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ------------------------------------
// 7. New Endpoint: Switch Tab by tabId
app.post("/switch-tab", async (req, res) => {
  try {
    const { tabId } = req.body;

    if (typeof tabId !== 'number') {
      return res.status(400).json({ success: false, error: "Invalid or missing 'tabId'. It should be a number." });
    }

    // Check for existing switch-tab tasks for the same tabId to prevent duplicates
    const existingTask = taskQueue.queue.find(task => task.command === "switch-tab" && task.tabId === tabId);
    if (existingTask) {
      return res.status(409).json({ success: false, error: `A switch-tab task for tabId ${tabId} is already pending.` });
    }

    // Create a new task to switch the tab
    const newTaskId = `switch-tab-${tabId}-${Date.now()}`;
    const task = {
      taskId: newTaskId,
      command: "switch-tab",
      tabId,
    };

    taskQueue.addTask(task);
    logger.info(`Added switch-tab task: ${JSON.stringify(task)}`);

    // Wait for the task to be completed
    try {
      const result = await waitForTaskCompletion(newTaskId);
      res.json({ success: true, task, result });
    } catch (error) {
      logger.error(`Task ${newTaskId} failed: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }

  } catch (error) {
    logger.error(`Error in /switch-tab: ${error.message}`);
    res.status(400).json({ success: false, error: error.message });
  }
});

// ------------------------------------
// 8. New Endpoint: Execute JS Function by tabId
app.post("/execute-js", async (req, res) => {
  try {
    const { tabId, jsFunction } = req.body;

    if (typeof tabId !== 'number') {
      return res.status(400).json({ success: false, error: "Invalid or missing 'tabId'. It should be a number." });
    }

    if (typeof jsFunction !== 'string') {
      return res.status(400).json({ success: false, error: "Invalid or missing 'jsFunction'. It should be a string." });
    }

    // Create a new task to execute the JS function
    const newTaskId = `execute-js-${tabId}-${Date.now()}`;
    const task = {
      taskId: newTaskId,
      command: "execute-js",
      tabId,
      jsFunction,
    };

    taskQueue.addTask(task);
    logger.info(`Added execute-js task: ${JSON.stringify(task)}`);

    // Wait for the task to be completed
    try {
      const result = await waitForTaskCompletion(newTaskId);
      res.json({ success: true, task, result });
    } catch (error) {
      logger.error(`Task ${newTaskId} failed: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }

  } catch (error) {
    logger.error(`Error in /execute-js: ${error.message}`);
    res.status(400).json({ success: false, error: error.message });
  }
});

// ------------------------------------
const PORT = 3000;
app.listen(PORT, () => {
  logger.info(`Node.js API listening on port ${PORT}`);
});
