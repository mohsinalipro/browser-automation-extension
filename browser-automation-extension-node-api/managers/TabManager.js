// managers/TabManager.js

const fs = require("fs");
const path = require("path");

/**
 * TabManager now tracks tabs and their associated windows with optimized file writes.
 */
class TabManager {
  constructor() {
    this.dbFilePath = path.join(__dirname, "..", "openedTabs.json");
    this.openedTabs = [];
    this.openedWindows = [];
    this.saveInProgress = false;
    this.saveQueued = false;

    this.loadData();
  }

  /**
   * Load opened tabs and windows from the JSON file.
   */
  loadData() {
    if (fs.existsSync(this.dbFilePath)) {
      try {
        const jsonData = fs.readFileSync(this.dbFilePath, "utf-8");
        const data = JSON.parse(jsonData);
        this.openedTabs = data.openedTabs || [];
        this.openedWindows = data.openedWindows || [];
        console.log(`Loaded ${this.openedTabs.length} tabs and ${this.openedWindows.length} windows from ${this.dbFilePath}`);
      } catch (error) {
        console.error("Error reading openedTabs.json:", error);
        this.openedTabs = [];
        this.openedWindows = [];
      }
    } else {
      this.openedTabs = [];
      this.openedWindows = [];
    }
  }

  /**
   * Persist the opened tabs and windows to the JSON file asynchronously.
   */
  saveData() {
    const data = {
      openedTabs: this.openedTabs,
      openedWindows: this.openedWindows,
    };
    fs.writeFile(this.dbFilePath, JSON.stringify(data, null, 2), (err) => {
      if (err) {
        console.error("Error writing to openedTabs.json:", err);
      } else {
        console.log(`Successfully saved data to ${this.dbFilePath}`);
      }
      this.saveInProgress = false;
      if (this.saveQueued) {
        this.saveQueued = false;
        this.scheduleSave();
      }
    });
  }

  /**
   * Schedule a save operation with debouncing to optimize file writes.
   */
  scheduleSave() {
    if (this.saveInProgress) {
      this.saveQueued = true;
      return;
    }

    this.saveInProgress = true;
    this.saveData();
  }

  /**
   * Add or update an opened tab.
   * @param {number} tabId - The Chrome tab ID.
   * @param {number} windowId - The Chrome window ID.
   * @param {string} url - The tab's URL.
   */
  addOrUpdateTab(tabId, windowId, url) {
    const now = new Date().toISOString();
    const tabIndex = this.openedTabs.findIndex((t) => t.tabId === tabId);

    if (tabIndex !== -1) {
      // Update existing tab
      this.openedTabs[tabIndex].url = url;
      this.openedTabs[tabIndex].windowId = windowId;
      this.openedTabs[tabIndex].lastUpdated = now;
      console.log(`Updated tab ${tabId} with new URL: ${url}`);
    } else {
      // Add new tab
      this.openedTabs.push({
        tabId,
        windowId,
        url,
        openedAt: now,
        lastUpdated: now,
      });
      console.log(`Added new tab ${tabId} with URL: ${url}`);
    }

    // Update window association
    this.associateTabWithWindow(tabId, windowId);

    // Schedule an asynchronous save
    this.scheduleSave();
  }

  /**
   * Associate a tab with a window.
   * @param {number} tabId - The Chrome tab ID.
   * @param {number} windowId - The Chrome window ID.
   */
  associateTabWithWindow(tabId, windowId) {
    const window = this.openedWindows.find((w) => w.windowId === windowId);
    if (window) {
      if (!window.tabs.includes(tabId)) {
        window.tabs.push(tabId);
        console.log(`Associated tab ${tabId} with existing window ${windowId}`);
      }
    } else {
      // Add new window
      this.openedWindows.push({
        windowId,
        tabs: [tabId],
        openedAt: new Date().toISOString(),
      });
      console.log(`Created new window ${windowId} and associated tab ${tabId}`);
    }
  }

  /**
   * Remove a closed tab.
   * @param {number} tabId - The Chrome tab ID.
   */
  removeClosedTab(tabId) {
    const tabIndex = this.openedTabs.findIndex((t) => t.tabId === tabId);
    if (tabIndex !== -1) {
      const [removedTab] = this.openedTabs.splice(tabIndex, 1);
      console.log(`Removed tab ${tabId}`);

      // Remove tab from its window
      const window = this.openedWindows.find((w) => w.windowId === removedTab.windowId);
      if (window) {
        window.tabs = window.tabs.filter((id) => id !== tabId);
        if (window.tabs.length === 0) {
          // Remove window if no tabs remain
          const windowIndex = this.openedWindows.findIndex((w) => w.windowId === removedTab.windowId);
          if (windowIndex !== -1) {
            this.openedWindows.splice(windowIndex, 1);
            console.log(`Removed window ${removedTab.windowId} as it has no more tabs.`);
          }
        }
      }

      // Schedule an asynchronous save
      this.scheduleSave();
    } else {
      console.warn(`Attempted to remove non-existent tab ${tabId}`);
    }
  }

  /**
   * Bulk add or update opened tabs (used during synchronization).
   * @param {Array} tabs - Array of { tabId, windowId, url }.
   */
  bulkAddOrUpdateTabs(tabs) {
    tabs.forEach(({ tabId, windowId, url }) => {
      this.addOrUpdateTab(tabId, windowId, url);
    });
    console.log(`Bulk added/updated ${tabs.length} tabs.`);
  }

  /**
   * Replace all existing tabs and windows with the new set.
   * This is used during full synchronization to ensure data integrity.
   * @param {Array} tabs - Array of { tabId, windowId, url }.
   */
  replaceAllTabs(tabs) {
    // Clear existing data
    this.openedTabs = [];
    this.openedWindows = [];

    // Add all new tabs
    tabs.forEach(({ tabId, windowId, url }) => {
      const now = new Date().toISOString();
      this.openedTabs.push({
        tabId,
        windowId,
        url,
        openedAt: now,
        lastUpdated: now,
      });

      // Associate with window
      const window = this.openedWindows.find((w) => w.windowId === windowId);
      if (window) {
        if (!window.tabs.includes(tabId)) {
          window.tabs.push(tabId);
        }
      } else {
        this.openedWindows.push({
          windowId,
          tabs: [tabId],
          openedAt: now,
        });
      }
    });

    console.log(`Replaced all tabs and windows with ${tabs.length} tabs.`);

    // Schedule an asynchronous save
    this.scheduleSave();
  }

  /**
   * Get all opened tabs.
   * @returns {Array} - Array of opened tab objects.
   */
  getAllOpenedTabs() {
    return this.openedTabs;
  }

  /**
   * Clear all tracked tabs and windows (for testing or full resync).
   */
  clearAll() {
    this.openedTabs = [];
    this.openedWindows = [];
    this.saveData();
    console.log("Cleared all opened tabs and windows.");
  }
}

module.exports = TabManager;
