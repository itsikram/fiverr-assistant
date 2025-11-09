(() => {
  const hasBrowserAPI = typeof browser !== "undefined";
  const api = hasBrowserAPI ? browser : chrome;

  if (!api || !api.tabs || !api.runtime) {
    return;
  }

  const storage =
    hasBrowserAPI && browser.storage && browser.storage.local
      ? browser.storage.local
      : typeof chrome !== "undefined" && chrome.storage && chrome.storage.local
      ? chrome.storage.local
      : null;

  const coerceBoolean = (value, fallback = false) => {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(normalized)) {
        return true;
      }
      if (["false", "0", "no", "off"].includes(normalized)) {
        return false;
      }
    }
    if (value == null) {
      return fallback;
    }
    return Boolean(value);
  };

  const AUTO_RELOAD_KEY = "autoReloadEnabled";
  let autoReloadEnabled = false;

  const storageGet = (keys) => {
    if (!storage) {
      return Promise.resolve({});
    }
    if (hasBrowserAPI && typeof storage.get === "function" && storage.get.length <= 1) {
      return storage.get(keys);
    }
    return new Promise((resolve, reject) => {
      try {
        storage.get(keys, (result) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(result || {});
        });
      } catch (error) {
        reject(error);
      }
    });
  };

  const refreshAutoReloadSetting = async () => {
    try {
      const result = await storageGet([AUTO_RELOAD_KEY]);
      if (result && Object.prototype.hasOwnProperty.call(result, AUTO_RELOAD_KEY)) {
        autoReloadEnabled = coerceBoolean(result[AUTO_RELOAD_KEY], true);
      } else {
        autoReloadEnabled = true;
      }
    } catch (error) {
      autoReloadEnabled = true;
      console.warn("Fiverr Assistant: unable to read auto reload setting", error);
    }

    if (!autoReloadEnabled) {
      cancelEnsureFiverrTab();
    }
  };


  const FIVERR_URL_PATTERNS = ["https://www.fiverr.com/*", "https://fiverr.com/*","www.fiverr.com/*","fiverr.com/*"];
  const FIVERR_HOME_URL = "https://www.fiverr.com/";
  let ensureTimeoutId = null;

  const cancelEnsureFiverrTab = () => {
    if (ensureTimeoutId) {
      clearTimeout(ensureTimeoutId);
      ensureTimeoutId = null;
    }
  };

  const scheduleEnsureFiverrTab = (delay = 100) => {
    if (!autoReloadEnabled) {
      cancelEnsureFiverrTab();
      return;
    }
    if (ensureTimeoutId) {
      clearTimeout(ensureTimeoutId);
    }
    ensureTimeoutId = setTimeout(() => {
      ensureTimeoutId = null;
      ensureFiverrTabExists();
    }, delay);
  };

  const ensureFiverrTabExists = () => {
    if (!autoReloadEnabled) {
      return;
    }
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

  const handleStorageChange = (changes, areaName) => {
    if (areaName && areaName !== "local") {
      return;
    }
    if (!changes || !Object.prototype.hasOwnProperty.call(changes, AUTO_RELOAD_KEY)) {
      return;
    }
    const changeRecord = changes[AUTO_RELOAD_KEY];
    const nextValue =
      changeRecord && Object.prototype.hasOwnProperty.call(changeRecord, "newValue")
        ? changeRecord.newValue
        : undefined;
    autoReloadEnabled = coerceBoolean(nextValue, true);
    if (!autoReloadEnabled) {
      cancelEnsureFiverrTab();
    } else {
      scheduleEnsureFiverrTab(500);
    }
  };

  if (storage) {
    if (hasBrowserAPI && browser.storage && browser.storage.onChanged) {
      browser.storage.onChanged.addListener(handleStorageChange);
    } else if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChange);
    }
  }

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
  refreshAutoReloadSetting()
    .then(() => {
      if (autoReloadEnabled) {
        scheduleEnsureFiverrTab(500);
      }
    })
    .catch(() => {
      scheduleEnsureFiverrTab(500);
    });
})();

