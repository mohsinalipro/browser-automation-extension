// managers/TaskQueue.js

/**
 * Simple TaskQueue implementation using an array.
 */
class TaskQueue {
  constructor() {
    this.queue = [];
  }

  /**
   * Add a task to the queue.
   * @param {Object} task - The task object to add.
   */
  addTask(task) {
    this.queue.push(task);
  }

  /**
   * Get the next task from the queue.
   * @returns {Object|null} - The next task or null if the queue is empty.
   */
  getNextTask() {
    if (this.queue.length === 0) return null;
    return this.queue.shift();
  }

  /**
   * Peek at the next task without removing it.
   * @returns {Object|null} - The next task or null if the queue is empty.
   */
  peekNextTask() {
    if (this.queue.length === 0) return null;
    return this.queue[0];
  }

  /**
   * Check if the queue contains a task matching the criteria.
   * @param {Function} predicate - Function to test each task.
   * @returns {boolean} - True if a matching task exists, else false.
   */
  hasTask(predicate) {
    return this.queue.some(predicate);
  }
}

module.exports = TaskQueue;
