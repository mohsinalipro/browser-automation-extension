// runner.js

// Get the sandbox iframe’s window
const sandboxFrame = document.getElementById("sandboxFrame").contentWindow;

// Relay messages from the sandbox iframe to the background script.
window.addEventListener("message", (event) => {
  // Forward the result (or error) along with its unique id.
  chrome.runtime.sendMessage(event.data);
});

// Listen for messages from the background script to execute dynamic code.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.jsCode && message.id) {
    // Post the message to the sandbox iframe.
    sandboxFrame.postMessage({ jsCode: message.jsCode, id: message.id }, "*");
  }
});
