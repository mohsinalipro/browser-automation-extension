# **Browser Automation System Documentation**

## **1. Introduction**

The **Browser Automation System** is designed to efficiently control and manage browser tabs and windows through a combination of a **Node.js API** and a **Chrome Extension**. This system provides a seamless interface for automating browser operations, ensuring real-time synchronization between the backend and the browser environment.

### **Key Features**

- Automated opening, closing, and switching of browser tabs
- Execution of JavaScript functions inside browser tabs using a CSP-compliant workaround
- Real-time task broadcasting and connection management using Socket.IO
- Synchronization of tab and window states between the browser and the backend
- Continuous monitoring of browser events for accurate tracking
- Consistency between backend records and the browser’s actual state

* * *

## **2. System Components**

### **2.1 Node.js API (Backend)**

The **Node.js API** serves as the central management system, handling all browser automation requests and maintaining the state of open tabs and windows.

#### **Core Responsibilities**

- Managing a queue of automation tasks
- Maintaining a synchronized record of open browser tabs and windows
- Exposing REST API endpoints for tab management, execution control, and reporting
- Implementing real-time task broadcasting using Socket.IO
- Ensuring synchronous task execution by waiting for confirmation from the extension
- Logging events and errors for debugging and monitoring

#### **Key Modules**

1. **TaskQueue.js**

    - Manages task queuing and execution flow
    - Supports adding, retrieving, and processing automation tasks
2. **TabManager.js**

    - Maintains the `openedTabs.json` file for tracking browser state
    - Handles tab creation, updates, and removal
    - Synchronizes browser state with the backend
3. **index.js** (Main API File)

    - Defines REST API endpoints for task management, tab control, and synchronization
    - Integrates Socket.IO for real-time task broadcasting and robust connection management
    - Processes incoming requests and emits pending and new tasks to connected clients
    - Logs events and handles task completion reporting

### **2.2 Chrome Extension (Frontend)**

The **Chrome Extension** executes tasks within the browser, monitors tab activity, and synchronizes changes with the backend.

#### **Core Responsibilities**

- Establishing a robust Socket.IO connection to receive real-time tasks from the Node.js API
- Executing tasks in the browser (e.g., opening/closing tabs, executing JavaScript)
- Implementing a CSP-friendly JavaScript execution workaround via Blob URL injection
- Monitoring tab events (creation, updates, removal, movement) and synchronizing them with the API
- Reporting task execution results and errors back to the API
- Handling connection errors gracefully and retrying until the Node API is available

#### **Key Files**

1. **background.js**

    - Implements real-time task handling using Socket.IO
    - Contains the CSP JS workaround for executing JavaScript in tabs
    - Monitors browser events and synchronizes state with the backend
    - Provides robust connection management (automatic reconnection and error notifications)
2. **manifest.json**

    - Defines permissions required for tab management, script execution, and notifications
    - Configures the extension’s background service worker and web-accessible resources
    - Ensures compliance with Chrome’s Content Security Policy (CSP) by avoiding unsafe-eval

* * *

## **3. Features & Functionalities**

### **3.1 Task Management**

- **Task Creation:**  
The API allows automation tasks to be added via `/add-task`, which are queued for execution.
- **Task Execution:**  
The extension processes tasks in real time as they are broadcast using Socket.IO.
- **Result Reporting:**  
The extension reports back execution results (or errors) to the API for logging and confirmation.

### **3.2 Tab & Window Control**

- **Open Tab:** Creates a new tab with a specified URL
- **Close Tab:** Closes a specified tab
- **Switch Tab:** Activates a specified tab
- **Find Tab:** Locates and activates a tab by URL

### **3.3 JavaScript Execution**

- **CSP JS Workaround:**  
JavaScript execution in a tab is handled via a Blob URL injection technique that complies with Chrome’s CSP, avoiding the use of unsafe-eval.
- **/execute-js Endpoint:**  
Executes user-defined JavaScript functions inside a browser tab and returns the result.

### **3.4 Real-Time Communication**

- **Socket.IO Integration:**  
The API and the extension communicate in real time using Socket.IO.
- **Robust Connection Management:**  
The extension implements reconnection logic, error notifications, and handles pending tasks (queued before connection) immediately upon activation.

### **3.5 Synchronization on Browser Startup**

- **Full Sync:**  
On startup, the extension synchronizes open tabs by calling `/sync-tabs` to update `openedTabs.json`.
- **Real-Time Updates:**  
The extension continuously listens to tab events to maintain an accurate record of the browser’s state.

* * *

## **4. API Endpoints**

### **4.1 Task Execution Endpoints**

| Endpoint | Method | Description |
| --- | --- | --- |
| `/get-task` | GET | Retrieves the next task in the queue (fallback) |
| `/report-result` | POST | Reports a successful task execution |
| `/report-result/error` | POST | Reports a task execution failure |

### **4.2 Tab Management Endpoints**

| Endpoint | Method | Description |
| --- | --- | --- |
| `/opened-tabs` | GET | Retrieves a list of all currently open tabs |

### **4.3 Synchronization Endpoint**

| Endpoint | Method | Description |
| --- | --- | --- |
| `/sync-tabs` | POST | Synchronizes the backend with current tabs |

### **4.4 Task Management Endpoint**

| Endpoint | Method | Description |
| --- | --- | --- |
| `/add-task` | POST | Adds a task to the execution queue |
| `/execute-js` | POST | Executes JavaScript in a specified browser tab |
| `/switch-tab` | POST | Switches focus to a specified browser tab |

* * *

## **5. Data Persistence**

- **`openedTabs.json`** stores the current state of open tabs and windows
- Automatically updated during:
    - Task execution (e.g., opening, closing, switching tabs)
    - Browser events (e.g., URL changes, tab movements)
    - Synchronization initiated by the extension

* * *

## **6. Interaction Flow**

### **Task Execution Process**

1. **Task Creation:**  
A task is added via the API and stored in the queue.
2. **Task Broadcasting:**  
New and pending tasks are broadcast in real time to the Chrome Extension using Socket.IO.
3. **Task Processing:**  
The extension receives, executes, and reports back the task result.
4. **Task Completion:**  
The API receives confirmation and updates internal records.

### **Synchronization Process**

1. **On Browser Startup:**  
The extension synchronizes the state of open tabs via `/sync-tabs`.
2. **Real-Time Updates:**  
The extension listens to tab events and receives task updates in real time, ensuring consistency between the browser and backend.

* * *

## **7. Security Considerations**

- **Authentication:**  
Future enhancements may include API key-based authentication for additional security.
- **Error Handling:**  
Robust error reporting is implemented to catch and log execution failures.
- **JavaScript Execution Control:**  
The CSP JS workaround avoids the use of unsafe-eval, maintaining a secure environment for dynamic code execution.

* * *

## **8. Future Enhancements**

- **Socket.IO Enhancements:**  
Further improvements to real-time communication, including advanced connection metrics and user-facing notifications.
- **Advanced Logging:**  
Implementation of structured and centralized logging for improved debugging and monitoring.
- **Extension UI:**  
Consider developing an extension interface for manual task management and status monitoring.
- **Database Migration:**  
Transition from JSON file storage to a more scalable database solution for tab state management.

* * *

## **9. Summary**

The **Browser Automation System** integrates a **Node.js API** with a **Chrome Extension** to provide a powerful automation framework for browser interactions. With features such as automated tab control, CSP-compliant JavaScript execution, and real-time task broadcasting using Socket.IO, the system ensures high responsiveness and synchronization between the backend and the browser. Future enhancements will continue to improve security, scalability, and user experience, further solidifying the system’s position as a robust automation solution.