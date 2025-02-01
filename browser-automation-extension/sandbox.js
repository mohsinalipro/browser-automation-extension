// sandbox.js

window.addEventListener("message", (event) => {
    // Optionally validate event.origin if needed.
    if (event.data && event.data.jsCode && event.data.id) {
      try {
        // Dynamic evaluation is allowed in this sandbox (due to its relaxed CSP).
        const result = new Function(event.data.jsCode)();
        event.source.postMessage({ id: event.data.id, result: result }, event.origin);
      } catch (e) {
        event.source.postMessage({ id: event.data.id, error: e.toString() }, event.origin);
      }
    }
  });
  