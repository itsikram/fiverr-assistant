(() => {
  const hasBrowserAPI = typeof browser !== "undefined";
  const api = hasBrowserAPI ? browser : chrome;

  if (!api || !api.tabs || !api.runtime) {
    return;
  }

  const FIVERR_URL_PATTERNS = ["https://www.fiverr.com/*", "https://fiverr.com/*"];
  const FIVERR_HOME_URL = "https://www.fiverr.com/";
  let ensureTimeoutId = null;

  const scheduleEnsureFiverrTab = (delay = 100) => {
    if (ensureTimeoutId) {
      clearTimeout(ensureTimeoutId);
    }
    ensureTimeoutId = setTimeout(() => {
      ensureTimeoutId = null;
      ensureFiverrTabExists();
    }, delay);
  };

  const ensureFiverrTabExists = () => {
    try {
      api.tabs.query({ url: FIVERR_URL_PATTERNS }, (tabs) => {
        if (api.runtime.lastError) {
          console.warn("Fiverr Assistant: unable to query tabs", api.runtime.lastError);
          return;
        }
        if (Array.isArray(tabs) && tabs.length > 0) {
          return;
        }
        api.tabs.create({ url: FIVERR_HOME_URL }, () => {
          if (api.runtime.lastError) {
            console.warn("Fiverr Assistant: unable to open Fiverr tab", api.runtime.lastError);
          }
        });
      });
    } catch (error) {
      console.warn("Fiverr Assistant: failed to ensure Fiverr tab exists", error);
    }
  };

  api.tabs.onRemoved.addListener(() => {
    scheduleEnsureFiverrTab(200);
  });

  api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!changeInfo || !changeInfo.url) {
      return;
    }
    const url = changeInfo.url;
    const isFiverrUrl =
      typeof url === "string" &&
      (url.startsWith("https://www.fiverr.com/") || url.startsWith("https://fiverr.com/"));
    if (!isFiverrUrl) {
      scheduleEnsureFiverrTab(200);
    }
  });

  api.runtime.onStartup.addListener(() => {
    scheduleEnsureFiverrTab(1000);
  });

  api.runtime.onInstalled.addListener(() => {
    scheduleEnsureFiverrTab(1000);
  });

  const fetchAudio = async (url) => {
    const response = await fetch(url, { cache: "no-store", credentials: "omit" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    const contentType = response.headers ? response.headers.get("content-type") : "";
    return { buffer, contentType };
  };

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "fetchAudio") {
      return false;
    }

    const { url } = message;
    if (typeof url !== "string" || !url) {
      sendResponse({ ok: false, error: "Invalid URL" });
      return false;
    }

    fetchAudio(url)
      .then(({ buffer, contentType }) => {
        sendResponse({ ok: true, buffer, contentType });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
      });

    return true;
  });

  // Initial check when background initializes.
  scheduleEnsureFiverrTab(500);
})();

