// Create a new panel in DevTools
chrome.devtools.panels.create(
  "Request Copier",
  "icons/icon16.png",
  "panel.html",
  (panel) => {
    console.log("Network Request Copier panel created");
  }
);
