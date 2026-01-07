(async function () {
  // Filter out known third-party errors to reduce console noise
  const originalConsoleError = console.error;
  console.error = function(...args) {
    const errorString = args.join(' ');
    // Filter out Qualtrics chunk loading errors
    if (errorString.includes('Loading chunk') && errorString.includes('qualtrics.com')) {
      return; // Suppress this error
    }
    // Call original console.error for all other errors
    originalConsoleError.apply(console, args);
  };

  // Handle unhandled promise rejections from third-party scripts
  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason;
    const errorMessage = error?.message || String(error || '');
    const errorStack = error?.stack || '';
    
    // Filter out Qualtrics chunk loading errors
    if (errorMessage.includes('Loading chunk') && (errorMessage.includes('qualtrics.com') || errorStack.includes('qualtrics.com'))) {
      event.preventDefault(); // Suppress the error
      return;
    }
    
    // Filter out WebTransport errors (common third-party errors)
    if (error?.name === 'WebTransportError' || errorMessage.includes('WebTransport')) {
      event.preventDefault();
      return;
    }
  });

  const hasBrowserAPI = typeof browser !== "undefined";
  const hasChromeAPI = typeof chrome !== "undefined";

  const extensionStorage =
    hasBrowserAPI && browser.storage && browser.storage.local
      ? browser.storage.local
      : hasChromeAPI && chrome.storage && chrome.storage.local
      ? chrome.storage.local
      : null;
  const runtime =
    hasBrowserAPI && browser.runtime
      ? browser.runtime
      : hasChromeAPI && chrome.runtime
      ? chrome.runtime
      : null;

  function coerceBooleanSetting(value, defaultValue = false) {
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
      return defaultValue;
    }
    return Boolean(value);
  }

  function sendMessageToRuntime(message) {
    if (!runtime || typeof runtime.sendMessage !== "function") {
      return Promise.reject(new Error("Runtime messaging unavailable"));
    }

    if (hasBrowserAPI && runtime.sendMessage.length <= 1) {
      try {
        const result = runtime.sendMessage(message);
        return result && typeof result.then === "function" ? result : Promise.resolve(result);
      } catch (error) {
        return Promise.reject(error);
      }
    }

    return new Promise((resolve, reject) => {
      try {
        runtime.sendMessage(message, (response) => {
          if (
            hasChromeAPI &&
            typeof chrome !== "undefined" &&
            chrome.runtime &&
            chrome.runtime.lastError
          ) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  const removeStatusDisplay = () => {
    if (statusUpdateIntervalId) {
      clearInterval(statusUpdateIntervalId);
      statusUpdateIntervalId = null;
    }
    if (statusDisplayElement && statusDisplayElement.parentElement) {
      statusDisplayElement.remove();
    }
    statusDisplayElement = null;
  };

  const readAutoReloadPreference = () => {
    try {
      const storedValue = localStorage.getItem("autoReloadEnabled");
      return coerceBooleanSetting(storedValue, true);
    } catch (error) {
      console.warn("Fiverr Auto Reloader: unable to read stored auto reload preference", error);
      return true;
    }
  };

  let siteDomain = window.location.hostname;
  let inboxUrl = "https://www.fiverr.com/inbox";
  let autoReload = readAutoReloadPreference();
  var audioElement = false;
  var lastAction = Date.now();
  var isF10Clicked = false;
  var mailData = JSON.parse(localStorage.getItem("mailData")) || [];

  const RELOAD_COUNT_KEY = "farReloadCount";
  const RELOAD_DATE_KEY = "farReloadDate";
  const NEXT_RELOAD_TIMESTAMP_KEY = "farNextReloadTimestamp";
  const MIN_SECONDS_BETWEEN_ACTION_AND_RELOAD = 60;
  const CONNECTION_TIME_KEY = "farConnectionTime";
  const MONITORING_TIME_KEY = "farMonitoringTime";
  const CONNECTION_DATE_KEY = "farConnectionDate";
  const MONITORING_DATE_KEY = "farMonitoringDate";
  const CONNECTION_START_KEY = "farConnectionStart";
  const MONITORING_START_KEY = "farMonitoringStart";
  
  const getTodayDateString = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  
  const checkAndResetDailyCount = () => {
    const today = getTodayDateString();
    const storedDate = localStorage.getItem(RELOAD_DATE_KEY);
    
    if (storedDate !== today) {
      // Date has changed, reset the count
      reloadCount = 0;
      try {
        localStorage.setItem(RELOAD_DATE_KEY, today);
        localStorage.setItem(RELOAD_COUNT_KEY, "0");
      } catch (_) {}
      return true; // Count was reset
    }
    return false; // Count was not reset
  };
  
  // Initialize reload count with daily check
  const storedDate = localStorage.getItem(RELOAD_DATE_KEY);
  const today = getTodayDateString();
  if (storedDate !== today) {
    // New day, reset count
    reloadCount = 0;
    try {
      localStorage.setItem(RELOAD_DATE_KEY, today);
      localStorage.setItem(RELOAD_COUNT_KEY, "0");
    } catch (_) {}
  } else {
    // Same day, load existing count
    reloadCount = parseInt(localStorage.getItem(RELOAD_COUNT_KEY), 10) || 0;
  }
  let nextReloadTimestamp = null;
  let nextReloadTimeoutId = null;
  let statusUpdateIntervalId = null;
  let statusDisplayElement = null;
  let featuresInitialized = false;
  let initializePromise = null;
  let offlineCheckIntervalId = null;

  const readSessionStorage = (key) => {
    try {
      if (typeof sessionStorage === "undefined") {
        return null;
      }
      return sessionStorage.getItem(key);
    } catch (_) {
      return null;
    }
  };

  const writeSessionStorage = (key, value) => {
    try {
      if (typeof sessionStorage === "undefined") {
        return;
      }
      sessionStorage.setItem(key, value);
    } catch (_) {}
  };

  const removeSessionStorage = (key) => {
    try {
      if (typeof sessionStorage === "undefined") {
        return;
      }
      sessionStorage.removeItem(key);
    } catch (_) {}
  };

  const PRIMARY_TAB_ID_STORAGE_KEY = "farPrimaryTabId";
  let designatedPrimaryTabId = null;
  let currentTabId = null;
  let hasPrimaryOverride = false;

  const getCurrentTabId = async () => {
    if (!runtime) {
      return null;
    }
    try {
      const response = await sendMessageToRuntime({ type: "getTabId" });
      if (response && typeof response.tabId === "number") {
        return response.tabId;
      }
    } catch (error) {
      console.warn("Fiverr Auto Reloader: unable to determine current tab id", error);
    }
    return null;
  };

  const readDesignatedPrimaryTabId = async () => {
    if (extensionStorage) {
      try {
        const result = await extensionStorage.get(PRIMARY_TAB_ID_STORAGE_KEY);
        const value = result ? result[PRIMARY_TAB_ID_STORAGE_KEY] : null;
        if (typeof value === "number" && !Number.isNaN(value)) {
          return value;
        }
        if (typeof value === "string" && value.trim() !== "") {
          const parsed = parseInt(value, 10);
          if (!Number.isNaN(parsed)) {
            return parsed;
          }
        }
      } catch (error) {
        console.warn("Fiverr Auto Reloader: unable to read primary tab id", error);
      }
    }

    try {
      const stored = localStorage.getItem(PRIMARY_TAB_ID_STORAGE_KEY);
      if (stored == null || stored === "") {
        return null;
      }
      const parsed = parseInt(stored, 10);
      return Number.isNaN(parsed) ? null : parsed;
    } catch (_) {
      return null;
    }
  };

  try {
    currentTabId = await getCurrentTabId();
  } catch (_) {
    currentTabId = null;
  }

  try {
    designatedPrimaryTabId = await readDesignatedPrimaryTabId();
  } catch (_) {
    designatedPrimaryTabId = null;
  }

  hasPrimaryOverride = typeof designatedPrimaryTabId === "number" && !Number.isNaN(designatedPrimaryTabId);

  if (hasPrimaryOverride) {
    try {
      localStorage.setItem(PRIMARY_TAB_ID_STORAGE_KEY, String(designatedPrimaryTabId));
    } catch (_) {}
  } else {
    try {
      localStorage.removeItem(PRIMARY_TAB_ID_STORAGE_KEY);
    } catch (_) {}
  }

  if (hasPrimaryOverride && (currentTabId == null || currentTabId !== designatedPrimaryTabId)) {
    if (
      runtime &&
      runtime.onMessage &&
      typeof runtime.onMessage.addListener === "function"
    ) {
      runtime.onMessage.addListener((message) => {
        if (
          message &&
          message.type === "primaryTabStatus" &&
          message.isPrimary
        ) {
          window.location.reload();
        }
      });
    }
    return;
  }

  let updateStatusDisplay = () => {};
  const persistReloadState = () => {
    // Check if we need to reset for a new day before persisting
    checkAndResetDailyCount();
    
    try {
      const today = getTodayDateString();
      localStorage.setItem(RELOAD_COUNT_KEY, String(reloadCount));
      localStorage.setItem(RELOAD_DATE_KEY, today);
    } catch (_) {}

    if (extensionStorage) {
      const today = getTodayDateString();
      const payload = {
        [RELOAD_COUNT_KEY]: reloadCount,
        [RELOAD_DATE_KEY]: today,
        [NEXT_RELOAD_TIMESTAMP_KEY]: nextReloadTimestamp || 0,
      };

      try {
        const result = extensionStorage.set(payload);
        if (result && typeof result.catch === "function") {
          result.catch((error) => console.warn("Fiverr Auto Reloader: unable to persist reload state", error));
        }
      } catch (error) {
        console.warn("Fiverr Auto Reloader: unable to persist reload state", error);
      }
    }
  };

  let clearScheduledReload = ({ updateDisplay = true, persist = true } = {}) => {
    if (nextReloadTimeoutId) {
      clearTimeout(nextReloadTimeoutId);
      nextReloadTimeoutId = null;
    }
    nextReloadTimestamp = null;
    if (persist) {
      persistReloadState();
    }
    if (updateDisplay) {
      updateStatusDisplay();
    }
  };
  let scheduleNextReload = () => {};
  let pauseAutoReload = () => {
    autoReload = false;
    stopMonitoringTracking();
    clearScheduledReload();
    clearMessageCheckInterval();
    stopMessageObserver();
    removeStatusDisplay();
    stopOfflineErrorChecking();
    // Clear notification pause timeout if auto-reload is manually paused
    if (notificationPauseTimeoutId) {
      clearTimeout(notificationPauseTimeoutId);
      notificationPauseTimeoutId = null;
    }
  };
  let enableAutoReload = () => {
    autoReload = true;
    isF10Clicked = false;
    if (featuresInitialized) {
      startMonitoringTracking();
      ensureMessageCheckInterval();
      scheduleNextReload();
      updateStatusDisplay();
      startOfflineErrorChecking();
    } else {
      initialize();
    }
  };

  // Function to pause auto-reload for 5 minutes when notification sound plays
  let pauseAutoReloadForNotification = () => {
    // Clear any existing notification pause timeout
    if (notificationPauseTimeoutId) {
      clearTimeout(notificationPauseTimeoutId);
      notificationPauseTimeoutId = null;
    }
    
    // Pause auto-reload
    pauseAutoReload();
    
    // Resume after 5 minutes (300000 milliseconds)
    notificationPauseTimeoutId = setTimeout(() => {
      notificationPauseTimeoutId = null;
      if (!isF10Clicked && featuresInitialized) {
        enableAutoReload();
        console.log("Fiverr Assistant: Auto-reload resumed after 5-minute notification pause");
      }
    }, 300000); // 5 minutes
    
    console.log("Fiverr Assistant: Auto-reload paused for 5 minutes due to notification");
  };

  // Time tracking variables
  let connectionStartTime = null;
  let monitoringStartTime = null;
  let timeTrackingIntervalId = null;
  
  const getStoredTime = (timeKey, dateKey) => {
    try {
      const today = getTodayDateString();
      const storedDate = localStorage.getItem(dateKey);
      
      // If date doesn't match today, return 0 (new day)
      if (storedDate !== today) {
        return 0;
      }
      
      const stored = localStorage.getItem(timeKey);
      return stored ? parseInt(stored, 10) : 0;
    } catch (_) {
      return 0;
    }
  };
  
  const setStoredTime = (timeKey, dateKey, value) => {
    try {
      const today = getTodayDateString();
      localStorage.setItem(timeKey, String(value));
      localStorage.setItem(dateKey, today);
      if (extensionStorage) {
        extensionStorage.set({ [timeKey]: value, [dateKey]: today }).catch(() => {});
      }
    } catch (_) {}
  };
  
  const checkAndResetDailyTime = (timeKey, dateKey) => {
    const today = getTodayDateString();
    const storedDate = localStorage.getItem(dateKey);
    
    if (storedDate !== today) {
      // New day, reset time
      try {
        localStorage.setItem(timeKey, "0");
        localStorage.setItem(dateKey, today);
        if (extensionStorage) {
          extensionStorage.set({ [timeKey]: 0, [dateKey]: today }).catch(() => {});
        }
      } catch (_) {}
      return true; // Time was reset
    }
    return false; // Time was not reset
  };
  
  const updateTimeTracking = () => {
    const now = Date.now();
    
    // Check and reset daily time if needed
    checkAndResetDailyTime(CONNECTION_TIME_KEY, CONNECTION_DATE_KEY);
    checkAndResetDailyTime(MONITORING_TIME_KEY, MONITORING_DATE_KEY);
    
    // Update connection time if online
    if (isOnline && connectionStartTime) {
      const elapsed = now - connectionStartTime;
      const currentTotal = getStoredTime(CONNECTION_TIME_KEY, CONNECTION_DATE_KEY);
      setStoredTime(CONNECTION_TIME_KEY, CONNECTION_DATE_KEY, currentTotal + elapsed);
      connectionStartTime = now;
      try {
        localStorage.setItem(CONNECTION_START_KEY, String(connectionStartTime));
      } catch (_) {}
    }
    
    // Update monitoring time if monitoring is active
    if (monitoringStartTime && autoReload && featuresInitialized && isPrimaryTab) {
      const elapsed = now - monitoringStartTime;
      const currentTotal = getStoredTime(MONITORING_TIME_KEY, MONITORING_DATE_KEY);
      setStoredTime(MONITORING_TIME_KEY, MONITORING_DATE_KEY, currentTotal + elapsed);
      monitoringStartTime = now;
      try {
        localStorage.setItem(MONITORING_START_KEY, String(monitoringStartTime));
      } catch (_) {}
    }
  };
  
  const startConnectionTracking = () => {
    if (isOnline && !connectionStartTime) {
      // Check if we need to reset for new day
      checkAndResetDailyTime(CONNECTION_TIME_KEY, CONNECTION_DATE_KEY);
      
      const storedStart = localStorage.getItem(CONNECTION_START_KEY);
      const today = getTodayDateString();
      const storedDate = localStorage.getItem(CONNECTION_DATE_KEY);
      
      // Only restore start time if it's from today
      if (storedStart && storedDate === today) {
        connectionStartTime = parseInt(storedStart, 10);
      } else {
        connectionStartTime = Date.now();
        localStorage.setItem(CONNECTION_START_KEY, String(connectionStartTime));
      }
    }
  };
  
  const stopConnectionTracking = () => {
    if (connectionStartTime) {
      updateTimeTracking();
      connectionStartTime = null;
      localStorage.removeItem(CONNECTION_START_KEY);
    }
  };
  
  const startMonitoringTracking = () => {
    if (autoReload && featuresInitialized && isPrimaryTab && !monitoringStartTime) {
      // Check if we need to reset for new day
      checkAndResetDailyTime(MONITORING_TIME_KEY, MONITORING_DATE_KEY);
      
      const storedStart = localStorage.getItem(MONITORING_START_KEY);
      const today = getTodayDateString();
      const storedDate = localStorage.getItem(MONITORING_DATE_KEY);
      
      // Only restore start time if it's from today
      if (storedStart && storedDate === today) {
        monitoringStartTime = parseInt(storedStart, 10);
      } else {
        monitoringStartTime = Date.now();
        localStorage.setItem(MONITORING_START_KEY, String(monitoringStartTime));
      }
    }
  };
  
  const stopMonitoringTracking = () => {
    if (monitoringStartTime) {
      updateTimeTracking();
      monitoringStartTime = null;
      localStorage.removeItem(MONITORING_START_KEY);
    }
  };
  
  const initializeTimeTracking = () => {
    // Start connection tracking if online
    startConnectionTracking();
    
    // Start monitoring tracking if conditions are met
    if (autoReload && featuresInitialized && isPrimaryTab) {
      startMonitoringTracking();
    }
    
    // Set up periodic updates (every 30 seconds)
    if (!timeTrackingIntervalId) {
      timeTrackingIntervalId = setInterval(() => {
        updateTimeTracking();
      }, 30000);
    }
  };
  
  // Offline detection
  let isOnline = navigator.onLine;
  let wasOffline = !navigator.onLine;
  let consecutiveReloadAttempts = 0;
  let lastReloadCheckTime = 0;
  let pageLoadCheckDone = false; // Flag to prevent multiple checks on same page load
  const MAX_CONSECUTIVE_RELOADS = 10; // Maximum reload attempts before giving up
  const RELOAD_CHECK_DELAY = 8000; // Wait 8 seconds after page load before checking (increased from 5)
  
  // Function to detect if page is showing "no internet connection" error
  const isShowingOfflineError = () => {
    if (siteDomain !== "www.fiverr.com" && siteDomain !== "fiverr.com") {
      return false;
    }
    
    // Wait a bit for page to load before checking
    const timeSinceLoad = Date.now() - lastReloadCheckTime;
    if (timeSinceLoad < RELOAD_CHECK_DELAY && lastReloadCheckTime > 0) {
      // Too soon after load, don't check yet
      return false;
    }
    
    if (!document.body) {
      return false;
    }
    
    const title = document.title.toLowerCase();
    const bodyText = document.body ? document.body.textContent.toLowerCase() : "";
    
    // Check for STRONG error indicators in title first (most reliable)
    const strongErrorIndicators = [
      "the connection has timed out",
      "connection has timed out",
      "this site can't be reached",
      "err_internet_disconnected",
      "dns_probe_finished_no_internet",
      "unable to find the server",
      "server not found"
    ];
    
    if (strongErrorIndicators.some(indicator => title.includes(indicator))) {
      return true;
    }
    
    // Check for Firefox-specific error page - must have ALL these texts together
    const firefoxErrorTexts = [
      "the connection has timed out",
      "the server at",
      "is taking too long to respond"
    ];
    
    // Only consider it an error if ALL Firefox error texts are present AND we have very little content
    if (firefoxErrorTexts.every(text => bodyText.includes(text))) {
      // Additional check: error pages have very little content
      if (document.body.textContent.trim().length < 500) {
        return true;
      }
    }
    
    // Check for Chrome error pages - must have specific error text AND minimal content
    if (bodyText.includes("this site can't be reached") || bodyText.includes("err_internet_disconnected")) {
      if (document.body.textContent.trim().length < 500) {
        return true;
      }
    }
    
    // Only check for missing Fiverr content if we have very little content overall
    // This prevents false positives during normal page loads
    const bodyTextLength = document.body.textContent.trim().length;
    if (bodyTextLength < 100) {
      // Very little content - might be an error page
      const hasFiverrContent = document.querySelector('header, nav, [class*="header"], [class*="nav"], [id*="header"], [id*="nav"], [class*="fiverr"], main, [role="main"], [data-testid]');
      if (!hasFiverrContent) {
        // No Fiverr content and very little text - likely error page
        return true;
      }
    }
    
    return false;
  };
  
  // Function to check and reload if showing offline error
  const checkAndReloadIfOffline = () => {
    if (!autoReload || !isPrimaryTab || siteDomain !== "www.fiverr.com") {
      consecutiveReloadAttempts = 0; // Reset if conditions not met
      return;
    }
    
    if (isShowingOfflineError()) {
      consecutiveReloadAttempts++;
      
      if (consecutiveReloadAttempts > MAX_CONSECUTIVE_RELOADS) {
        console.warn(`Fiverr Assistant: Max reload attempts (${MAX_CONSECUTIVE_RELOADS}) reached, stopping auto-reload for offline errors`);
        return;
      }
      
      console.log(`Fiverr Assistant: Detected offline/error page (attempt ${consecutiveReloadAttempts}/${MAX_CONSECUTIVE_RELOADS}), reloading...`);
      markPrimaryNavigation();
      lastReloadCheckTime = Date.now();
      window.location.reload();
    } else {
      // Page loaded successfully, reset counter
      if (consecutiveReloadAttempts > 0) {
        console.log("Fiverr Assistant: Page loaded successfully after offline error");
        consecutiveReloadAttempts = 0;
      }
    }
  };
  
  // Check on page load if we're still showing an error (after a delay to let page load)
  const checkPageLoadStatus = () => {
    if (!autoReload || !isPrimaryTab || siteDomain !== "www.fiverr.com") {
      consecutiveReloadAttempts = 0; // Reset if conditions not met
      pageLoadCheckDone = false;
      return;
    }
    
    // Prevent multiple checks on the same page load
    if (pageLoadCheckDone) {
      return;
    }
    
    // Mark that we're checking this page load
    pageLoadCheckDone = true;
    lastReloadCheckTime = Date.now();
    
    // Wait longer for the page to fully load before checking
    setTimeout(() => {
      // Only check if we're still on the same page and conditions are still met
      if (!autoReload || !isPrimaryTab || siteDomain !== "www.fiverr.com") {
        pageLoadCheckDone = false;
        return;
      }
      
      if (isShowingOfflineError()) {
        console.log("Fiverr Assistant: Page still showing error after load, will reload...");
        checkAndReloadIfOffline();
      } else {
        // Page loaded successfully, reset counter
        if (consecutiveReloadAttempts > 0) {
          console.log("Fiverr Assistant: Page loaded successfully after offline error");
        }
        consecutiveReloadAttempts = 0;
        pageLoadCheckDone = false; // Reset flag for next page load
      }
    }, RELOAD_CHECK_DELAY);
  };
  
  window.addEventListener("online", () => {
    const wasOfflineBefore = wasOffline;
    isOnline = true;
    wasOffline = false;
    startConnectionTracking();
    
    // Reload page when coming back online (if we were offline before)
    if (wasOfflineBefore && autoReload && isPrimaryTab && siteDomain === "www.fiverr.com") {
      console.log("Fiverr Assistant: Connection restored, reloading page...");
      markPrimaryNavigation();
      // Small delay to ensure connection is stable
      setTimeout(() => {
        window.location.reload();
      }, 500);
      return;
    }
    
    if (autoReload) {
      scheduleNextReload();
    }
    updateStatusDisplay();
  });
  
  window.addEventListener("offline", () => {
    isOnline = false;
    wasOffline = true;
    stopConnectionTracking();
    clearScheduledReload();
    updateStatusDisplay();
  });
  
  // Periodically check for offline error pages (every 10 seconds)
  const startOfflineErrorChecking = () => {
    if (offlineCheckIntervalId) {
      return;
    }
    
    // Don't check immediately - let the page load first
    // The page load event handler will check after the page is fully loaded
    
    offlineCheckIntervalId = setInterval(() => {
      if (isOnline && autoReload && isPrimaryTab) {
        // Only check if enough time has passed since last check
        const timeSinceLastCheck = Date.now() - lastReloadCheckTime;
        if (timeSinceLastCheck >= RELOAD_CHECK_DELAY) {
          checkAndReloadIfOffline();
        }
      }
    }, 15000); // Check every 15 seconds (increased from 10 to be less aggressive)
  };
  
  const stopOfflineErrorChecking = () => {
    if (offlineCheckIntervalId) {
      clearInterval(offlineCheckIntervalId);
      offlineCheckIntervalId = null;
    }
  };

  // Cleanup time tracking on page unload
  window.addEventListener("beforeunload", () => {
    updateTimeTracking();
    stopConnectionTracking();
    stopMonitoringTracking();
    stopOfflineErrorChecking();
    if (timeTrackingIntervalId) {
      clearInterval(timeTrackingIntervalId);
      timeTrackingIntervalId = null;
    }
  });

  const PRIMARY_TAB_KEY = "farPrimaryTab";
  const PRIMARY_TAB_HEARTBEAT_INTERVAL = 5000;
  const PRIMARY_TAB_STALE_THRESHOLD = PRIMARY_TAB_HEARTBEAT_INTERVAL * 3;
  const TAB_IDENTIFIER_STORAGE_KEY = "farTabIdentifier";
  const SKIP_PRIMARY_RELEASE_KEY = "farSkipPrimaryRelease";
  let tabIdentifier = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const storedTabIdentifier = readSessionStorage(TAB_IDENTIFIER_STORAGE_KEY);
  if (storedTabIdentifier) {
    tabIdentifier = storedTabIdentifier;
  } else {
    writeSessionStorage(TAB_IDENTIFIER_STORAGE_KEY, tabIdentifier);
  }
  removeSessionStorage(SKIP_PRIMARY_RELEASE_KEY);
  const markPrimaryNavigation = () => {
    writeSessionStorage(SKIP_PRIMARY_RELEASE_KEY, "1");
  };
  const MESSAGE_CHECK_INTERVAL_MS = 5000;
  let messageCheckIntervalId = null;
  let messageObserver = null;
  let processedNewClientMessages = new Set(); // Track processed new client messages
  let notificationPauseTimeoutId = null; // Track timeout for 5-minute pause after notification
  
  // DOM query caching for performance
  let cachedUnreadIcon = null;
  let cachedNewClientFlag = null;
  let cachedUnreadIconSelector = null;
  let cachedNewClientFlagSelector = null;
  let cacheTimestamp = 0;
  const DOM_CACHE_TTL = 500; // Cache DOM queries for 500ms

  const clearMessageCheckInterval = () => {
    if (messageCheckIntervalId) {
      clearInterval(messageCheckIntervalId);
      messageCheckIntervalId = null;
    }
  };

  const stopMessageObserver = () => {
    if (messageObserver) {
      try {
        if (messageObserver.debounceTimer) {
          clearTimeout(messageObserver.debounceTimer);
          messageObserver.debounceTimer = null;
        }
        messageObserver.disconnect();
      } catch (error) {
        console.warn("Fiverr Assistant: Error disconnecting message observer", error);
      }
      messageObserver = null;
    }
    processedNewClientMessages.clear();
    // Clear DOM cache when stopping observer
    cachedUnreadIcon = null;
    cachedNewClientFlag = null;
    cacheTimestamp = 0;
  };

  // Function to activate the Fiverr tab
  const activateFiverrTab = async () => {
    if (!runtime) {
      return;
    }
    try {
      await sendMessageToRuntime({ type: "activateTab" });
    } catch (error) {
      console.warn("Fiverr Assistant: Failed to activate tab", error);
    }
  };

  // Function to check and handle new client message instantly
  const checkNewClientMessageInstantly = () => {
    if (siteDomain !== "www.fiverr.com") {
      return;
    }

    const unreadIconSelector = settings.selectorUnreadIcon || defaultSettings.selectorUnreadIcon;
    const newClientFlagSelector = settings.selectorNewClientFlag || defaultSettings.selectorNewClientFlag;
    
    // Use cached DOM queries if available and fresh
    const now = Date.now();
    let hasMessage;
    let newClientFlag;
    
    if (now - cacheTimestamp < DOM_CACHE_TTL && 
        cachedUnreadIconSelector === unreadIconSelector && 
        cachedNewClientFlagSelector === newClientFlagSelector &&
        cachedUnreadIcon && document.body.contains(cachedUnreadIcon)) {
      // Use cached results
      hasMessage = cachedUnreadIcon;
      newClientFlag = cachedNewClientFlag && document.body.contains(cachedNewClientFlag) ? cachedNewClientFlag : null;
    } else {
      // Refresh cache
      hasMessage = document.querySelector(unreadIconSelector);
      newClientFlag = hasMessage ? document.querySelector(newClientFlagSelector) : null;
      
      // Update cache
      cachedUnreadIcon = hasMessage;
      cachedNewClientFlag = newClientFlag;
      cachedUnreadIconSelector = unreadIconSelector;
      cachedNewClientFlagSelector = newClientFlagSelector;
      cacheTimestamp = now;
    }

    if (hasMessage) {
      if (newClientFlag) {
        // Create a unique identifier for this new client message
        // Use the flag element's position or parent structure as identifier
        const messageId = newClientFlag.textContent || newClientFlag.getAttribute('data-id') || 
                         (newClientFlag.parentElement ? newClientFlag.parentElement.textContent.substring(0, 50) : '') ||
                         Date.now().toString();
        
        // Only process if we haven't seen this message before
        if (!processedNewClientMessages.has(messageId)) {
          processedNewClientMessages.add(messageId);
          
          // Try to extract client username from DOM
          let clientUsername = null;
          try {
            // Try to find username in the message element or nearby
            const messageElement = newClientFlag.closest('[class*="message"], [class*="conversation"], [class*="chat"]');
            if (messageElement) {
              const usernameElement = messageElement.querySelector('[class*="username"], [class*="name"], [class*="user"]');
              if (usernameElement) {
                clientUsername = usernameElement.textContent?.trim();
              }
            }
            // Fallback: try to get from the flag's parent structure
            if (!clientUsername && newClientFlag.parentElement) {
              const parentText = newClientFlag.parentElement.textContent || '';
              const usernameMatch = parentText.match(/(?:from|by|@)\s*([a-zA-Z0-9_-]+)/i);
              if (usernameMatch) {
                clientUsername = usernameMatch[1];
              }
            }
          } catch (e) {
            console.warn("Fiverr Assistant: Error extracting username", e);
          }
          
          // Play sound instantly
          playAudio("new");
          sendNotification("New client Message");
          
          // Pause auto-reload for 5 minutes when notification plays
          pauseAutoReloadForNotification();
          
          activateFiverrTab();
          
          // Instantly redirect to inbox when new message is detected
          if (window.location.href !== inboxUrl && isOnline) {
            markPrimaryNavigation();
            window.location.href = inboxUrl;
          }
          
          console.log("Fiverr Assistant: New client message detected instantly, sound played, redirecting to inbox, reloader paused for 5 minutes", {
            messageId,
            clientUsername
          });
          
          // Clean up old processed messages (keep only last 10)
          if (processedNewClientMessages.size > 10) {
            const firstItem = processedNewClientMessages.values().next().value;
            processedNewClientMessages.delete(firstItem);
          }
          
          // Invalidate cache after detecting new message
          cacheTimestamp = 0;
        }
      } else {
        // Has message but not a new client - could be an old client message
        // Still show alert but with different message
        const messageId = hasMessage.textContent || hasMessage.getAttribute('data-id') || 
                         Date.now().toString();
        
        if (!processedNewClientMessages.has(messageId)) {
          processedNewClientMessages.add(messageId);
          
          // Play appropriate sound based on targeted clients
          const targetClients = (targetedClients || "").split(",").map(c => c.trim());
          // Note: We can't determine if it's targeted without more context, so play old client sound
          playAudio("old");
          sendNotification("New Message");
          
          activateFiverrTab();
          
          // Instantly redirect to inbox when new message is detected
          if (window.location.href !== inboxUrl && isOnline) {
            markPrimaryNavigation();
            window.location.href = inboxUrl;
          }
          
          console.log("Fiverr Assistant: New message detected (not new client), redirecting to inbox");
          
          // Clean up old processed messages
          if (processedNewClientMessages.size > 10) {
            const firstItem = processedNewClientMessages.values().next().value;
            processedNewClientMessages.delete(firstItem);
          }
          
          cacheTimestamp = 0;
        }
      }
    }
  };

  const runMessageCheck = () => {
    if (siteDomain !== "www.fiverr.com") {
      return;
    }

    const unreadIconSelector = settings.selectorUnreadIcon || defaultSettings.selectorUnreadIcon;
    const newClientFlagSelector = settings.selectorNewClientFlag || defaultSettings.selectorNewClientFlag;
    
    // Use cached DOM queries if available and fresh
    const now = Date.now();
    let hasMessage;
    let newClientFlag;
    
    if (now - cacheTimestamp < DOM_CACHE_TTL && 
        cachedUnreadIconSelector === unreadIconSelector && 
        cachedNewClientFlagSelector === newClientFlagSelector &&
        cachedUnreadIcon && document.body.contains(cachedUnreadIcon)) {
      // Use cached results
      hasMessage = cachedUnreadIcon;
      newClientFlag = cachedNewClientFlag && document.body.contains(cachedNewClientFlag) ? cachedNewClientFlag : null;
    } else {
      // Refresh cache
      hasMessage = document.querySelector(unreadIconSelector);
      newClientFlag = hasMessage ? document.querySelector(newClientFlagSelector) : null;
      
      // Update cache
      cachedUnreadIcon = hasMessage;
      cachedNewClientFlag = newClientFlag;
      cachedUnreadIconSelector = unreadIconSelector;
      cachedNewClientFlagSelector = newClientFlagSelector;
      cacheTimestamp = now;
    }

    // Check if it's a new client message
    if (hasMessage) {
      if (newClientFlag) {
        // New client message detected - activate the tab
        activateFiverrTab();
      }
    }

    // Respect recent user interaction: do NOT auto-redirect to inbox
    // if the last click/keypress was within the last MIN_SECONDS_BETWEEN_ACTION_AND_RELOAD seconds.
    const secondsSinceLastAction = (Date.now() - lastAction) / 1000;

    if (
      hasMessage &&
      isOnline &&
      window.location.href !== inboxUrl &&
      secondsSinceLastAction > MIN_SECONDS_BETWEEN_ACTION_AND_RELOAD
    ) {
      markPrimaryNavigation();
      window.location.href = inboxUrl;
    }
  };

  const startMessageObserver = () => {
    stopMessageObserver();

    if (siteDomain !== "www.fiverr.com") {
      return;
    }

    // Check immediately
    checkNewClientMessageInstantly();

    // Set up MutationObserver to watch for new client messages
    try {
      messageObserver = new MutationObserver((mutations) => {
        // Filter mutations to only process relevant changes
        // Skip if no mutations or if mutations don't affect message-related areas
        if (!mutations || mutations.length === 0) {
          return;
        }
        
        // Check if any mutation affects message-related elements
        const hasRelevantChanges = mutations.some(mutation => {
          const target = mutation.target;
          if (!target || !target.nodeType) return false;
          
          // Check if mutation is in message-related containers
          const isInMessageArea = target.closest && (
            target.closest('.messages-wrapper') ||
            target.closest('.inbox-container') ||
            target.closest('nav') ||
            target.closest('header') ||
            target.closest('[class*="message"]') ||
            target.closest('[class*="inbox"]')
          );
          
          // Also check if the target itself is a message-related element
          const isMessageElement = target.classList && (
            target.classList.contains('unread-icon') ||
            target.classList.contains('messages-wrapper') ||
            target.classList.contains('inbox-container') ||
            target.matches && target.matches('[class*="message"]')
          );
          
          return isInMessageArea || isMessageElement || mutation.type === 'childList';
        });
        
        // Only process if there are relevant changes
        if (!hasRelevantChanges) {
          return;
        }
        
        // Use minimal debounce for instant detection
        if (messageObserver.debounceTimer) {
          clearTimeout(messageObserver.debounceTimer);
        }
        messageObserver.debounceTimer = setTimeout(() => {
          // Invalidate cache before checking to ensure fresh results
          cacheTimestamp = 0;
          checkNewClientMessageInstantly();
        }, 50); // Reduced to 50ms for near-instant detection
      });

      // Try to find a more specific container for messages, otherwise observe body
      const unreadIconSelector = settings.selectorUnreadIcon || defaultSettings.selectorUnreadIcon;
      const unreadIcon = document.querySelector(unreadIconSelector);
      let targetElement = null;
      
      // Try to narrow the observation scope
      if (unreadIcon) {
        // Try to find the closest message container
        targetElement = unreadIcon.closest('.messages-wrapper') ||
                       unreadIcon.closest('.inbox-container') ||
                       unreadIcon.closest('nav') ||
                       unreadIcon.closest('header');
      }
      
      // Fallback to body if no specific container found
      targetElement = targetElement || document.body;
      
      // Observe the target element for changes
      // Always use subtree: true to catch all DOM changes for instant detection
      messageObserver.observe(targetElement || document.body || document.documentElement, {
        childList: true,
        subtree: true, // Always use subtree to catch all changes instantly
        attributes: true,
        attributeFilter: ['class', 'style', 'data-testid'] // Watch for class/style/data changes
      });

      console.log("Fiverr Assistant: Message observer started for instant new client detection", {
        targetElement: targetElement ? targetElement.tagName : 'body',
        useSubtree: true
      });
    } catch (error) {
      console.warn("Fiverr Assistant: Failed to start message observer", error);
    }
  };

  const ensureMessageCheckInterval = () => {
    clearMessageCheckInterval();

    if (siteDomain !== "www.fiverr.com") {
      return;
    }

    runMessageCheck();
    messageCheckIntervalId = setInterval(runMessageCheck, MESSAGE_CHECK_INTERVAL_MS);
    
    // Start the observer for instant detection
    startMessageObserver();
  };
  let isPrimaryTab = false;
  let primaryTabHeartbeatTimer = null;
  let primaryTabMonitorTimer = null;

  const readPrimaryTabRecord = () => {
    try {
      const raw = localStorage.getItem(PRIMARY_TAB_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch (error) {
      console.warn("Fiverr Auto Reloader: unable to parse primary tab record", error);
    }
    return null;
  };

  const writePrimaryTabRecord = () => {
    try {
      localStorage.setItem(PRIMARY_TAB_KEY, JSON.stringify({ id: tabIdentifier, timestamp: Date.now() }));
    } catch (error) {
      console.warn("Fiverr Auto Reloader: unable to write primary tab record", error);
    }
  };

  const isRecordStale = (record) => {
    if (!record || typeof record !== "object") {
      return true;
    }
    if (!record.timestamp || typeof record.timestamp !== "number") {
      return true;
    }
    return Date.now() - record.timestamp > PRIMARY_TAB_STALE_THRESHOLD;
  };

  const attemptToClaimPrimaryTab = () => {
    const record = readPrimaryTabRecord();
    if (!record || record.id === tabIdentifier || isRecordStale(record)) {
      writePrimaryTabRecord();
      return true;
    }
    return false;
  };

  const releasePrimaryTab = () => {
    if (primaryTabHeartbeatTimer) {
      clearInterval(primaryTabHeartbeatTimer);
      primaryTabHeartbeatTimer = null;
    }
    const skipRelease = readSessionStorage(SKIP_PRIMARY_RELEASE_KEY) === "1";
    if (skipRelease) {
      removeSessionStorage(SKIP_PRIMARY_RELEASE_KEY);
      return;
    }
    const record = readPrimaryTabRecord();
    if (record && record.id === tabIdentifier) {
      localStorage.removeItem(PRIMARY_TAB_KEY);
    }
  };

  if (autoReload) {
    isPrimaryTab = attemptToClaimPrimaryTab();

    if (!isPrimaryTab) {
      const promoteToPrimaryTab = () => {
        if (attemptToClaimPrimaryTab()) {
          if (primaryTabMonitorTimer) {
            clearInterval(primaryTabMonitorTimer);
            primaryTabMonitorTimer = null;
          }
          window.removeEventListener("storage", handlePrimaryTabRelease);
          if (isOnline) {
            markPrimaryNavigation();
            window.location.href = "https://www.fiverr.com/";
          } else {
            const redirectWhenOnline = () => {
              window.removeEventListener("online", redirectWhenOnline);
              try {
                markPrimaryNavigation();
                window.location.href = "https://www.fiverr.com/";
              } catch (error) {
                console.warn("Fiverr Auto Reloader: failed to redirect primary tab when back online", error);
              }
            };
            window.addEventListener("online", redirectWhenOnline);
          }
        }
      };

      const handlePrimaryTabRelease = (event) => {
        if (event.key === PRIMARY_TAB_KEY) {
          const record = readPrimaryTabRecord();
          if (!record || isRecordStale(record)) {
            promoteToPrimaryTab();
          }
        }
      };

      primaryTabMonitorTimer = setInterval(() => {
        const record = readPrimaryTabRecord();
        if (!record || isRecordStale(record)) {
          promoteToPrimaryTab();
        }
      }, PRIMARY_TAB_HEARTBEAT_INTERVAL);

      window.addEventListener("storage", handlePrimaryTabRelease);
      return;
    }

    primaryTabHeartbeatTimer = setInterval(() => {
      writePrimaryTabRecord();
    }, PRIMARY_TAB_HEARTBEAT_INTERVAL);

    window.addEventListener("beforeunload", releasePrimaryTab);
    window.addEventListener("pagehide", releasePrimaryTab);
  } else {
    isPrimaryTab = true;
  }

  const defaultSound = "https://storefrontsignonline.com/wp-content/uploads/2025/10/money_trees.mp3";
  const defaultSettings = {
    profile: "",
    profileUsername: "",
    targetedClients: "",
    pageLinks: "",
    new_client_sound: defaultSound,
    targeted_client_sound: defaultSound,
    old_client_sound: "https://storefrontsignonline.com/wp-content/uploads/2025/10/bicycle-ring.mp3",
    relStart: "30",
    relEnd: "180",
    autoReloadEnabled: "true",
    selectorUnreadIcon: ".seller-nav-right ul li:nth-child(3) .messages-wrapper .unread-icon",
    selectorNewClientFlag: ".first > div:nth-child(2) > div:nth-child(1) > span:nth-child(2)",
    selectorMessageContent: ".message-flow .content",
  };

  const settings = { ...defaultSettings };
  const supportsIndexedDB = (() => {
    try {
      return typeof indexedDB !== "undefined";
    } catch (error) {
      console.warn("Fiverr Auto Reloader: IndexedDB unavailable", error);
      return false;
    }
  })();
  const AUDIO_DB_NAME = "farAudioCache";
  const AUDIO_STORE_NAME = "sounds";
  const AUDIO_SETTING_KEYS = ["new_client_sound", "targeted_client_sound", "old_client_sound"];
  const SOUND_TYPE_TO_SETTING_KEY = {
    new: "new_client_sound",
    targated: "targeted_client_sound",
    targeted: "targeted_client_sound",
    old: "old_client_sound",
    default: "new_client_sound",
  };
  let audioDbPromise = null;
  const inFlightAudioCache = new Map();

  const normalizeUrl = (value) => (typeof value === "string" ? value.trim() : "");

  const fetchAudioViaRuntime = async (url) => {
    if (!url || typeof url !== "string") {
      return null;
    }

    try {
      const response = await sendMessageToRuntime({ type: "fetchAudio", url });
      if (!response || !response.ok || !response.buffer) {
        return null;
      }
      const blobOptions = {};
      if (response.contentType) {
        blobOptions.type = response.contentType;
      }
      return new Blob([response.buffer], blobOptions);
    } catch (error) {
      console.warn("Fiverr Auto Reloader: background audio fetch failed", error);
      return null;
    }
  };

  const getAudioDb = () => {
    if (!supportsIndexedDB) {
      return Promise.reject(new Error("IndexedDB not supported"));
    }
    if (audioDbPromise) {
      return audioDbPromise;
    }
    audioDbPromise = new Promise((resolve, reject) => {
      try {
        const request = indexedDB.open(AUDIO_DB_NAME, 1);
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(AUDIO_STORE_NAME)) {
            db.createObjectStore(AUDIO_STORE_NAME);
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            audioDbPromise = null;
          };
          resolve(db);
        };
        request.onerror = () => {
          reject(request.error);
        };
        request.onblocked = () => {
          console.warn("Fiverr Auto Reloader: IndexedDB open request blocked");
        };
      } catch (error) {
        reject(error);
      }
    }).catch((error) => {
      console.warn("Fiverr Auto Reloader: unable to open audio cache database", error);
      audioDbPromise = null;
      throw error;
    });
    return audioDbPromise;
  };

  const readCachedAudioRecord = async (key) => {
    if (!supportsIndexedDB) {
      return null;
    }
    try {
      const db = await getAudioDb();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(AUDIO_STORE_NAME, "readonly");
        const store = transaction.objectStore(AUDIO_STORE_NAME);
        const request = store.get(key);
        request.onsuccess = () => {
          resolve(request.result || null);
        };
        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (error) {
      console.warn("Fiverr Auto Reloader: failed to read cached audio", error);
      return null;
    }
  };

  const getCachedAudioBlobForUrl = async (key, url) => {
    if (!supportsIndexedDB) {
      return null;
    }
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl) {
      return null;
    }
    const record = await readCachedAudioRecord(key);
    if (record && record.sourceUrl === normalizedUrl && record.blob instanceof Blob) {
      console.info("Fiverr Auto Reloader: audio cache hit", {
        settingKey: key,
        sourceUrl: normalizedUrl,
        cachedAt: record.timestamp,
      });
      return record.blob;
    }
    return null;
  };

  const writeCachedAudioRecord = async (key, value) => {
    if (!supportsIndexedDB) {
      console.warn("Fiverr Assistant: IndexedDB not supported, cannot save audio to IndexedDB", { settingKey: key });
      return;
    }
    try {
      const db = await getAudioDb();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(AUDIO_STORE_NAME, "readwrite");
        const store = transaction.objectStore(AUDIO_STORE_NAME);
        const request = store.put(value, key);
        request.onsuccess = () => {
          console.info("Fiverr Assistant: Audio file saved to IndexedDB", {
            settingKey: key,
            sourceUrl: value.sourceUrl,
            blobSize: value.blob?.size || "unknown",
            timestamp: value.timestamp,
          });
          resolve();
        };
        request.onerror = () => {
          console.error("Fiverr Assistant: Failed to save audio to IndexedDB", {
            settingKey: key,
            sourceUrl: value.sourceUrl,
            error: request.error?.message || "Unknown error",
          });
          reject(request.error);
        };
      });
    } catch (error) {
      console.error("Fiverr Assistant: Exception while saving audio to IndexedDB", {
        settingKey: key,
        sourceUrl: value?.sourceUrl,
        error: error.message,
      });
    }
  };

  const deleteCachedAudioRecord = async (key) => {
    if (!supportsIndexedDB) {
      return;
    }
    try {
      const db = await getAudioDb();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(AUDIO_STORE_NAME, "readwrite");
        const store = transaction.objectStore(AUDIO_STORE_NAME);
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn("Fiverr Auto Reloader: failed to delete cached audio", error);
    }
  };

  const fetchAndCacheAudio = async (key, url) => {
    if (!supportsIndexedDB || !url) {
      if (!supportsIndexedDB) {
        console.warn("Fiverr Assistant: IndexedDB not supported, cannot save audio file", { settingKey: key });
      }
      return null;
    }
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl) {
      console.warn("Fiverr Assistant: Invalid audio URL", { settingKey: key, url });
      return null;
    }
    try {
      console.log("Fiverr Assistant: Fetching audio file to save to IndexedDB", {
        settingKey: key,
        sourceUrl: normalizedUrl,
      });
      const response = await fetch(normalizedUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const blob = await response.blob();
      console.info("Fiverr Assistant: Audio file fetched, saving to IndexedDB", {
        settingKey: key,
        sourceUrl: normalizedUrl,
        blobSize: blob.size,
        blobType: blob.type,
      });
      await writeCachedAudioRecord(key, {
        sourceUrl: normalizedUrl,
        blob,
        timestamp: Date.now(),
      });
      console.info("Fiverr Assistant: Audio file successfully saved to IndexedDB", {
        settingKey: key,
        sourceUrl: normalizedUrl,
        blobSize: blob.size,
      });
      return blob;
    } catch (error) {
      console.warn("Fiverr Assistant: Failed to fetch audio directly, trying background fetch", {
        settingKey: key,
        sourceUrl: normalizedUrl,
        error: error.message,
      });
      const fallbackBlob = await fetchAudioViaRuntime(normalizedUrl);
      if (!fallbackBlob) {
        console.error("Fiverr Assistant: Failed to fetch audio via background, cannot save to IndexedDB", {
          settingKey: key,
          sourceUrl: normalizedUrl,
        });
        return null;
      }
      console.info("Fiverr Assistant: Audio file fetched via background, saving to IndexedDB", {
        settingKey: key,
        sourceUrl: normalizedUrl,
        blobSize: fallbackBlob.size,
        blobType: fallbackBlob.type,
      });
      await writeCachedAudioRecord(key, {
        sourceUrl: normalizedUrl,
        blob: fallbackBlob,
        timestamp: Date.now(),
      });
      console.info("Fiverr Assistant: Audio file successfully saved to IndexedDB via background fetch", {
        settingKey: key,
        sourceUrl: normalizedUrl,
        blobSize: fallbackBlob.size,
      });
      return fallbackBlob;
    }
  };

  const ensureAudioBlob = async (key, url) => {
    if (!supportsIndexedDB) {
      console.warn("Fiverr Assistant: IndexedDB not supported, cannot cache audio");
      return null;
    }
    const normalizedUrl = typeof url === "string" ? url.trim() : "";
    const cacheKey = `${key}:${normalizedUrl}`;

    if (!normalizedUrl) {
      await deleteCachedAudioRecord(key);
      return null;
    }

    if (inFlightAudioCache.has(cacheKey)) {
      return inFlightAudioCache.get(cacheKey);
    }

    const promise = (async () => {
      try {
        const existing = await readCachedAudioRecord(key);
        if (existing && existing.sourceUrl === normalizedUrl && existing.blob instanceof Blob) {
          console.info("Fiverr Assistant: Audio already cached in IndexedDB", {
            settingKey: key,
            sourceUrl: normalizedUrl,
          });
          return existing.blob;
        }
        
        // Audio not in cache, fetch and save it
        console.log("Fiverr Assistant: Audio not in IndexedDB, fetching and saving...", {
          settingKey: key,
          sourceUrl: normalizedUrl,
        });
        const blob = await fetchAndCacheAudio(key, normalizedUrl);
        if (blob) {
          console.info("Fiverr Assistant: Audio successfully saved to IndexedDB", {
            settingKey: key,
            sourceUrl: normalizedUrl,
            blobSize: blob.size,
          });
        } else {
          console.warn("Fiverr Assistant: Failed to fetch and cache audio", {
            settingKey: key,
            sourceUrl: normalizedUrl,
          });
        }
        return blob;
      } catch (error) {
        console.error("Fiverr Assistant: Error ensuring audio blob", {
          settingKey: key,
          sourceUrl: normalizedUrl,
          error: error.message,
        });
        return null;
      }
    })();

    inFlightAudioCache.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      inFlightAudioCache.delete(cacheKey);
    }
  };

  const warmAudioCache = async () => {
    if (!supportsIndexedDB) {
      console.warn("Fiverr Assistant: IndexedDB not supported, cannot cache audio files");
      return;
    }
    console.log("Fiverr Assistant: Warming audio cache - checking and saving all notification sounds to IndexedDB");
    const uniqueKeys = [...new Set(AUDIO_SETTING_KEYS)];
    const results = await Promise.allSettled(
      uniqueKeys.map(async (key) => {
        let currentUrl = settings[key] || "";
        if (!currentUrl) {
          try {
            currentUrl = localStorage.getItem(key) || "";
          } catch (_) {
            currentUrl = "";
          }
        }
        const normalizedUrl = normalizeUrl(currentUrl);
        if (normalizedUrl) {
          const blob = await ensureAudioBlob(key, normalizedUrl);
          if (blob) {
            console.info("Fiverr Assistant: Audio file saved/verified in IndexedDB", {
              settingKey: key,
              sourceUrl: normalizedUrl,
              blobSize: blob.size,
            });
            return { key, url: normalizedUrl, success: true, blobSize: blob.size };
          } else {
            console.warn("Fiverr Assistant: Failed to save audio file to IndexedDB", {
              settingKey: key,
              sourceUrl: normalizedUrl,
            });
            return { key, url: normalizedUrl, success: false };
          }
        } else {
          console.log("Fiverr Assistant: No URL configured for audio setting", { settingKey: key });
          return { key, url: null, success: true }; // No URL is not an error
        }
      })
    );
    
    const successful = results.filter(r => r.status === "fulfilled" && r.value?.success).length;
    const failed = results.filter(r => r.status === "rejected" || (r.status === "fulfilled" && !r.value?.success)).length;
    console.log("Fiverr Assistant: Audio cache warm-up complete", {
      total: uniqueKeys.length,
      successful,
      failed,
    });
  };

  // Function to verify and save all audio files if not already saved
  const verifyAndSaveAllAudioFiles = async () => {
    if (!supportsIndexedDB) {
      console.warn("Fiverr Assistant: IndexedDB not supported, cannot verify audio files");
      return;
    }
    console.log("Fiverr Assistant: Verifying all notification sound files are saved to IndexedDB");
    const uniqueKeys = [...new Set(AUDIO_SETTING_KEYS)];
    const verificationResults = [];
    
    for (const key of uniqueKeys) {
      let currentUrl = settings[key] || "";
      if (!currentUrl) {
        try {
          currentUrl = localStorage.getItem(key) || "";
        } catch (_) {
          currentUrl = "";
        }
      }
      const normalizedUrl = normalizeUrl(currentUrl);
      
      if (normalizedUrl) {
        try {
          // Check if already in cache
          const cached = await readCachedAudioRecord(key);
          if (cached && cached.sourceUrl === normalizedUrl && cached.blob instanceof Blob) {
            console.log("Fiverr Assistant: Audio file already saved in IndexedDB", {
              settingKey: key,
              sourceUrl: normalizedUrl,
              blobSize: cached.blob.size,
            });
            verificationResults.push({ key, url: normalizedUrl, status: "already_saved", blobSize: cached.blob.size });
          } else {
            // Not in cache, fetch and save
            console.log("Fiverr Assistant: Audio file not in IndexedDB, fetching and saving...", {
              settingKey: key,
              sourceUrl: normalizedUrl,
            });
            const blob = await fetchAndCacheAudio(key, normalizedUrl);
            if (blob) {
              console.info("Fiverr Assistant: Audio file successfully saved to IndexedDB", {
                settingKey: key,
                sourceUrl: normalizedUrl,
                blobSize: blob.size,
              });
              verificationResults.push({ key, url: normalizedUrl, status: "saved", blobSize: blob.size });
            } else {
              console.error("Fiverr Assistant: Failed to save audio file to IndexedDB", {
                settingKey: key,
                sourceUrl: normalizedUrl,
              });
              verificationResults.push({ key, url: normalizedUrl, status: "failed" });
            }
          }
        } catch (error) {
          console.error("Fiverr Assistant: Error verifying/saving audio file", {
            settingKey: key,
            sourceUrl: normalizedUrl,
            error: error.message,
          });
          verificationResults.push({ key, url: normalizedUrl, status: "error", error: error.message });
        }
      } else {
        verificationResults.push({ key, url: null, status: "no_url" });
      }
    }
    
    const summary = {
      total: uniqueKeys.length,
      already_saved: verificationResults.filter(r => r.status === "already_saved").length,
      saved: verificationResults.filter(r => r.status === "saved").length,
      failed: verificationResults.filter(r => r.status === "failed" || r.status === "error").length,
      no_url: verificationResults.filter(r => r.status === "no_url").length,
    };
    
    console.log("Fiverr Assistant: Audio file verification complete", summary);
    return { results: verificationResults, summary };
  };
  let targetedClients = "";
  let pageLinks = [];
  let minReloadingSecond = 30;
  let maxReloadingSecond = 180;

  const processPageLinks = (links) => {
    if (!links || typeof links !== "string") {
      return [];
    }
    return links
      .split(",")
      .map((link) => link.trim())
      .filter(Boolean);
  };

  const updateSetting = (key, value) => {
    settings[key] = value;
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      console.error("Unable to persist setting in localStorage:", key, err);
    }
    if (extensionStorage) {
      extensionStorage.set({ [key]: value }).catch((error) => console.error("Failed to persist setting:", error));
    }
    if (AUDIO_SETTING_KEYS.includes(key)) {
      // Ensure audio file is saved to IndexedDB when setting is updated
      const normalizedUrl = normalizeUrl(value);
      if (normalizedUrl) {
        console.log("Fiverr Assistant: Audio setting updated, ensuring file is saved to IndexedDB", {
          settingKey: key,
          sourceUrl: normalizedUrl,
        });
        ensureAudioBlob(key, normalizedUrl).catch((error) => {
          console.error("Fiverr Assistant: Failed to save audio to IndexedDB", {
            settingKey: key,
            sourceUrl: normalizedUrl,
            error: error.message,
          });
        });
      } else {
        // If URL is empty, remove from cache
        deleteCachedAudioRecord(key).catch((error) => {
          console.warn("Fiverr Assistant: Failed to delete cached audio", {
            settingKey: key,
            error: error.message,
          });
        });
      }
    }
    // Invalidate DOM cache if selector settings changed
    if (key === "selectorUnreadIcon" || key === "selectorNewClientFlag") {
      cachedUnreadIcon = null;
      cachedNewClientFlag = null;
      cacheTimestamp = 0;
    }
  };

  const hydrateSettings = async () => {
    let stored = {};
    if (extensionStorage) {
      const storageKeys = [
        ...Object.keys(defaultSettings),
        RELOAD_COUNT_KEY,
        RELOAD_DATE_KEY,
        NEXT_RELOAD_TIMESTAMP_KEY,
        PRIMARY_TAB_ID_STORAGE_KEY,
      ];
      try {
        stored = await extensionStorage.get(storageKeys);
      } catch (error) {
        console.error("Failed to load settings from storage", error);
      }
    }

    if (stored && Object.prototype.hasOwnProperty.call(stored, PRIMARY_TAB_ID_STORAGE_KEY)) {
      const storedPrimaryId = stored[PRIMARY_TAB_ID_STORAGE_KEY];
      if (typeof storedPrimaryId === "number" && !Number.isNaN(storedPrimaryId)) {
        designatedPrimaryTabId = storedPrimaryId;
      } else if (typeof storedPrimaryId === "string" && storedPrimaryId.trim() !== "") {
        const parsedPrimaryId = parseInt(storedPrimaryId, 10);
        if (!Number.isNaN(parsedPrimaryId)) {
          designatedPrimaryTabId = parsedPrimaryId;
        }
      }
    }

    const pendingStorageUpdates = {};

    Object.keys(defaultSettings).forEach((key) => {
      const localValue = localStorage.getItem(key);
      const storedValue = stored[key];
      const defaultValue = defaultSettings[key];

      if (localValue !== null && localValue !== undefined) {
        settings[key] = localValue;
        if (storedValue !== localValue) {
          pendingStorageUpdates[key] = localValue;
        }
      } else if (storedValue !== undefined && storedValue !== null && storedValue !== "") {
        settings[key] = storedValue;
        try {
          localStorage.setItem(key, storedValue);
        } catch (err) {
          console.error("Unable to sync setting to localStorage:", key, err);
        }
      } else if (defaultValue !== undefined && defaultValue !== null && defaultValue !== "") {
        settings[key] = defaultValue;
        try {
          localStorage.setItem(key, defaultValue);
        } catch (err) {
          console.error("Unable to write default setting to localStorage:", key, err);
        }
        pendingStorageUpdates[key] = defaultValue;
      } else {
        settings[key] = "";
      }
    });

    // Check if we need to reset for a new day
    checkAndResetDailyCount();
    
    const storedReloadCount = stored[RELOAD_COUNT_KEY];
    const storedDate = stored[RELOAD_DATE_KEY];
    const today = getTodayDateString();
    
    // Only use stored count if it's from today
    if (storedDate === today && storedReloadCount !== undefined && storedReloadCount !== null) {
      const parsedCount = parseInt(storedReloadCount, 10);
      if (!Number.isNaN(parsedCount)) {
        reloadCount = parsedCount;
        try {
          localStorage.setItem(RELOAD_COUNT_KEY, String(reloadCount));
          localStorage.setItem(RELOAD_DATE_KEY, today);
        } catch (_) {}
      }
    } else {
      // Date mismatch or no stored date, reset count
      reloadCount = 0;
      try {
        localStorage.setItem(RELOAD_COUNT_KEY, "0");
        localStorage.setItem(RELOAD_DATE_KEY, today);
      } catch (_) {}
    }

    const storedNextReload = stored[NEXT_RELOAD_TIMESTAMP_KEY];
    if (storedNextReload !== undefined && storedNextReload !== null) {
      const parsedNextReload = parseInt(storedNextReload, 10);
      if (!Number.isNaN(parsedNextReload)) {
        nextReloadTimestamp = parsedNextReload > 0 ? parsedNextReload : null;
      }
    }

    // Ensure pageLinks has a sensible default if still empty.
    if (!settings.pageLinks) {
      const profileUsername = settings.profileUsername || "";
      if (profileUsername) {
        const defaultLinks = `/users/${profileUsername}/seller_dashboard,/users/${profileUsername}/manage_gigs,/earnings?source=header_nav,/users/${profileUsername}/seller_analytics_dashboard?source=header_nav&tab=overview,/users/${profileUsername}/manage_orders?source=header_nav`;
        settings.pageLinks = defaultLinks;
        try {
          localStorage.setItem("pageLinks", defaultLinks);
        } catch (err) {
          console.error("Unable to write default pageLinks:", err);
        }
        pendingStorageUpdates.pageLinks = defaultLinks;
      }
    }

    if (extensionStorage && Object.keys(pendingStorageUpdates).length > 0) {
      try {
        await extensionStorage.set(pendingStorageUpdates);
      } catch (error) {
        console.error("Failed to persist pending settings:", error);
      }
    }

    await warmAudioCache();

    targetedClients = settings.targetedClients || "";
    pageLinks = processPageLinks(settings.pageLinks);
    minReloadingSecond = parseInt(settings.relStart, 10) || 30;
    maxReloadingSecond = parseInt(settings.relEnd, 10) || 180;
    autoReload = coerceBooleanSetting(settings.autoReloadEnabled, true);
    if (!autoReload) {
      clearScheduledReload({ updateDisplay: false });
      removeStatusDisplay();
    }
    updateStatusDisplay();
  };

  let getVal = (id) => {
    return localStorage.getItem(id) || null;
  };

  // Declare playAudio and sendNotification outside initialize so they're accessible to message observer
  let playAudio = async () => {};
  let sendNotification = () => {};
  
  // Track currently playing audio elements so we can stop them on user interaction
  const playingAudioElements = new Set();
  
  // Function to stop all currently playing notification sounds
  const stopAllNotificationSounds = () => {
    playingAudioElements.forEach((audio) => {
      try {
        if (audio && !audio.paused) {
          audio.pause();
          audio.currentTime = 0;
        }
      } catch (error) {
        console.warn("Fiverr Assistant: Error stopping audio", error);
      }
    });
    playingAudioElements.clear();
  };

  const deactivatePrimaryTabFeatures = () => {
    pauseAutoReload();
    stopMonitoringTracking();
    clearScheduledReload({ updateDisplay: false });
    removeStatusDisplay();
    stopOfflineErrorChecking();
    releasePrimaryTab();
    if (primaryTabMonitorTimer) {
      clearInterval(primaryTabMonitorTimer);
      primaryTabMonitorTimer = null;
    }
    if (primaryTabHeartbeatTimer) {
      clearInterval(primaryTabHeartbeatTimer);
      primaryTabHeartbeatTimer = null;
    }
    if (timeTrackingIntervalId) {
      clearInterval(timeTrackingIntervalId);
      timeTrackingIntervalId = null;
    }
    featuresInitialized = false;
    isPrimaryTab = false;
    autoReload = false;
  };

  if (runtime && runtime.onMessage) {
    runtime.onMessage.addListener((message) => {
      console.log("Fiverr Assistant Content: Received message", message?.type, message?.payload ? Object.keys(message.payload) : "no payload");
      
      if (!message || message.type !== "settingsUpdated" || !message.payload) {
        if (message && message.type === "primaryTabStatus") {
          const { primaryTabId, isPrimary } = message;
          if (typeof primaryTabId === "number" && !Number.isNaN(primaryTabId)) {
            designatedPrimaryTabId = primaryTabId;
            try {
              localStorage.setItem(PRIMARY_TAB_ID_STORAGE_KEY, String(primaryTabId));
            } catch (_) {}
          } else {
            designatedPrimaryTabId = null;
            try {
              localStorage.removeItem(PRIMARY_TAB_ID_STORAGE_KEY);
            } catch (_) {}
          }

          if (isPrimary) {
            initialize().catch(() => {});
          } else {
            deactivatePrimaryTabFeatures();
          }
          return;
        }
        
        if (message && message.type === "pauseAutoReloadFor15Minutes") {
          // Trigger the same pause functionality as F8 key
          if (featuresInitialized && typeof pauseAutoReload === "function") {
            pauseAutoReload();
            console.log("Fiverr Assistant: Auto-reload paused for 15 minutes from options page");
            
            // Resume after 15 minutes (900000 milliseconds)
            setTimeout(() => {
              if (!isF10Clicked && featuresInitialized) {
                enableAutoReload();
                console.log("Fiverr Assistant: Auto-reload resumed after 15-minute pause from options page");
              }
            }, 900000);
          }
          return;
        }
        
        return;
      }

      Object.entries(message.payload).forEach(([key, value]) => {
        if (value === undefined || value === null) {
          value = "";
        }
        updateSetting(key, value);
      });

      // Use payload values directly instead of reading from localStorage to avoid timing issues
      targetedClients = message.payload.targetedClients !== undefined ? String(message.payload.targetedClients || "") : (getVal("targetedClients") || "");
      pageLinks = message.payload.pageLinks !== undefined ? processPageLinks(String(message.payload.pageLinks || "")) : processPageLinks(getVal("pageLinks"));
      minReloadingSecond = message.payload.relStart !== undefined ? (parseInt(String(message.payload.relStart), 10) || 30) : (parseInt(getVal("relStart"), 10) || minReloadingSecond);
      maxReloadingSecond = message.payload.relEnd !== undefined ? (parseInt(String(message.payload.relEnd), 10) || 180) : (parseInt(getVal("relEnd"), 10) || maxReloadingSecond);
      
      console.log("Fiverr Assistant Content: Settings updated", {
        pageLinks: pageLinks,
        pageLinksLength: pageLinks.length,
        minReloadingSecond: minReloadingSecond,
        maxReloadingSecond: maxReloadingSecond,
        autoReloadEnabled: message.payload.autoReloadEnabled
      });
      
      if (Object.prototype.hasOwnProperty.call(message.payload, "autoReloadEnabled")) {
        const shouldEnable = coerceBooleanSetting(message.payload.autoReloadEnabled, true);
        if (shouldEnable) {
          console.log("Fiverr Assistant Content: Enabling auto-reload, featuresInitialized:", featuresInitialized);
          enableAutoReload();
        } else {
          pauseAutoReload();
        }
        return;
      }

      autoReload = coerceBooleanSetting(settings.autoReloadEnabled, true);

      if (autoReload) {
        scheduleNextReload();
      } else {
        removeStatusDisplay();
      }
    });
  }

  async function initialize() {
    if (initializePromise) {
      return initializePromise;
    }

    initializePromise = (async () => {
      await hydrateSettings();

      if (!autoReload) {
        removeStatusDisplay();
        return;
      }

      if (featuresInitialized) {
        scheduleNextReload();
        updateStatusDisplay();
        return;
      }

      try {
      const newClientFlagSelector = settings.selectorNewClientFlag || defaultSettings.selectorNewClientFlag;
      var isNewClient = document.querySelector(newClientFlagSelector) ? true : false;

      function isWithinLastTenMinutes(givenTime) {
        if (givenTime == null) return null;
        const now = new Date();
        const tenMinutesAgo = new Date(now);
        tenMinutesAgo.setMinutes(now.getMinutes() - 10);

        return givenTime >= tenMinutesAgo && givenTime <= now;
      }

      let isMailSent = (username) => {
        if (mailData.length < 1) return null;
        const index = mailData.findIndex((item) => item.username === username);
        let lastMailTime = mailData[index] ? mailData[index].time : null;
        return isWithinLastTenMinutes(lastMailTime);
      };

      function scrollAllToBottom() {
        const messageContentSelector = settings.selectorMessageContent || defaultSettings.selectorMessageContent;
        const elements = document.querySelectorAll(messageContentSelector);

        elements.forEach((element) => {
          element.scrollTop = element.scrollHeight;
        });
      }

      function getFormattedTime() {
        const now = new Date();
        const day = String(now.getDate()).padStart(2, "0");
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const year = String(now.getFullYear()).slice(-2);
        const hours = String(now.getHours()).padStart(2, "0");
        const minutes = String(now.getMinutes()).padStart(2, "0");

        return `${day}/${month}/${year} ${hours}:${minutes}`;
      }

      const getRandomMiliSecond = (min, max) => {
        if (typeof min !== "number" || typeof max !== "number") {
          throw new Error("Both arguments must be numbers.");
        }
        if (min > max) {
          throw new Error("The first parameter must be less than or equal to the second parameter.");
        }

        return (Math.floor(Math.random() * (max - min + 1)) + min) * 1000;
      };

      const applyStyles = (element, styleObject) => {
        for (let item in styleObject) {
          element.style[item] = styleObject[item];
        }
      };

      const statusContainerCss = {
        position: "fixed",
        bottom: "20px",
        right: "100px",
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        color: "#ffffff",
        padding: "12px 16px",
        borderRadius: "8px",
        fontSize: "14px",
        lineHeight: "1.4",
        zIndex: "1001",
        fontFamily: "Arial, sans-serif",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
        minWidth: "220px",
        textAlign: "left",
      };

      const ensureStatusDisplayElement = () => {
        if (statusDisplayElement && document.body.contains(statusDisplayElement)) {
          return statusDisplayElement;
        }

        statusDisplayElement = document.createElement("div");
        statusDisplayElement.id = "farReloadStatus";
        applyStyles(statusDisplayElement, statusContainerCss);
        document.body.appendChild(statusDisplayElement);

        if (!statusUpdateIntervalId) {
          statusUpdateIntervalId = setInterval(() => {
            // Only update if page is visible to save CPU when tab is in background
            if (!document.hidden) {
              updateStatusDisplay();
            }
          }, 1000);
        }

        return statusDisplayElement;
      };

      const formatCountdown = (milliseconds) => {
        if (milliseconds <= 0) {
          return "Imminent";
        }
        const totalSeconds = Math.ceil(milliseconds / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const minutePart = minutes > 0 ? `${minutes}m ` : "";
        const secondPart = `${seconds}s`;
        return `${minutePart}${secondPart}`.trim();
      };

      const formatClockTime = (timestamp) => {
        return new Date(timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
      };

      const deriveNextReloadLabel = () => {
        if (!autoReload) {
          return "Paused";
        }
        if (!isOnline) {
          return "Offline";
        }
        if (siteDomain !== "www.fiverr.com") {
          return "Unavailable";
        }
        if (!Array.isArray(pageLinks) || pageLinks.length === 0) {
          return "No pages configured";
        }
        if (!nextReloadTimestamp) {
          return "Scheduling...";
        }
        const remaining = nextReloadTimestamp - Date.now();
        const countdown = formatCountdown(remaining);
        const clockTime = formatClockTime(nextReloadTimestamp);
        return `${countdown} (${clockTime})`;
      };

      updateStatusDisplay = () => {
        if (!document.body) {
          return;
        }

        if (!autoReload) {
          removeStatusDisplay();
          return;
        }

        if (siteDomain !== "www.fiverr.com") {
          removeStatusDisplay();
          return;
        }

        const container = ensureStatusDisplayElement();
        const nextReloadLabel = deriveNextReloadLabel();

        container.textContent = "";

        const reloadWrapper = document.createElement("div");
        const reloadStrong = document.createElement("strong");
        reloadStrong.textContent = "Reloads today:";
        reloadWrapper.appendChild(reloadStrong);
        reloadWrapper.appendChild(document.createTextNode(` ${reloadCount}`));

        const nextWrapper = document.createElement("div");
        const nextStrong = document.createElement("strong");
        nextStrong.textContent = "Next reload:";
        nextWrapper.appendChild(nextStrong);
        nextWrapper.appendChild(document.createTextNode(` ${nextReloadLabel}`));

        container.appendChild(reloadWrapper);
        container.appendChild(nextWrapper);
      };

      pauseAutoReload = () => {
        autoReload = false;
        stopMonitoringTracking();
        clearScheduledReload();
        clearMessageCheckInterval();
        stopMessageObserver();
        removeStatusDisplay();
        stopOfflineErrorChecking();
        // Clear notification pause timeout if auto-reload is manually paused
        if (notificationPauseTimeoutId) {
          clearTimeout(notificationPauseTimeoutId);
          notificationPauseTimeoutId = null;
        }
      };

      // Redefine pauseAutoReloadForNotification to use local pauseAutoReload and enableAutoReload
      pauseAutoReloadForNotification = () => {
        // Clear any existing notification pause timeout
        if (notificationPauseTimeoutId) {
          clearTimeout(notificationPauseTimeoutId);
          notificationPauseTimeoutId = null;
        }
        
        // Pause auto-reload
        pauseAutoReload();
        
        // Resume after 5 minutes (300000 milliseconds)
        notificationPauseTimeoutId = setTimeout(() => {
          notificationPauseTimeoutId = null;
          if (!isF10Clicked && featuresInitialized) {
            enableAutoReload();
            console.log("Fiverr Assistant: Auto-reload resumed after 5-minute notification pause");
          }
        }, 300000); // 5 minutes
        
        console.log("Fiverr Assistant: Auto-reload paused for 5 minutes due to notification");
      };

      enableAutoReload = () => {
        autoReload = true;
        isF10Clicked = false;
        startMonitoringTracking();
        ensureMessageCheckInterval();
        scheduleNextReload();
        updateStatusDisplay();
        startOfflineErrorChecking();
      };

      scheduleNextReload = () => {
        clearScheduledReload({ updateDisplay: false, persist: false });

        const finalizeWithoutSchedule = () => {
          persistReloadState();
          updateStatusDisplay();
        };

        console.log("Fiverr Assistant Content: scheduleNextReload called", {
          autoReload: autoReload,
          isOnline: isOnline,
          siteDomain: siteDomain,
          pageLinks: pageLinks,
          pageLinksLength: Array.isArray(pageLinks) ? pageLinks.length : "not an array"
        });

        if (!autoReload || !isOnline) {
          console.log("Fiverr Assistant Content: Not scheduling reload - autoReload:", autoReload, "isOnline:", isOnline);
          finalizeWithoutSchedule();
          return;
        }

        if (siteDomain !== "www.fiverr.com") {
          console.log("Fiverr Assistant Content: Not scheduling reload - wrong domain:", siteDomain);
          finalizeWithoutSchedule();
          return;
        }

        if (!Array.isArray(pageLinks) || pageLinks.length === 0) {
          console.log("Fiverr Assistant Content: Not scheduling reload - pageLinks empty or invalid", pageLinks);
          finalizeWithoutSchedule();
          return;
        }
        
        console.log("Fiverr Assistant Content: Scheduling next reload with pageLinks:", pageLinks);

        const delay = getRandomMiliSecond(minReloadingSecond, maxReloadingSecond);
        nextReloadTimestamp = Date.now() + delay;
        persistReloadState();
        updateStatusDisplay();

        nextReloadTimeoutId = setTimeout(() => {
          nextReloadTimeoutId = null;

          if (!autoReload || !isOnline) {
            scheduleNextReload();
            return;
          }

          if (siteDomain !== "www.fiverr.com") {
            persistReloadState();
            updateStatusDisplay();
            return;
          }

          if (!Array.isArray(pageLinks) || pageLinks.length === 0) {
            scheduleNextReload();
            return;
          }

          const diffInSecond = (Date.now() - lastAction) / 1000;
          if (diffInSecond <= MIN_SECONDS_BETWEEN_ACTION_AND_RELOAD) {
            scheduleNextReload();
            return;
          }

          const randomInt = Math.floor(Math.random() * pageLinks.length);
          const fallbackLink = "/users/" + (getVal("profileUsername") || "") + "/seller_dashboard";
          const goToLink = pageLinks[randomInt] || fallbackLink;
          const newLink = new URL("https://www.fiverr.com" + goToLink).toString();

          // Check if we need to reset for a new day before incrementing
          checkAndResetDailyCount();
          reloadCount += 1;
          nextReloadTimestamp = null;
          persistReloadState();
          updateStatusDisplay();
          markPrimaryNavigation();
          window.location.href = newLink;
        }, delay);
      };

      updateStatusDisplay();


      playAudio = async (type) => {
        const settingKey = SOUND_TYPE_TO_SETTING_KEY[type] || SOUND_TYPE_TO_SETTING_KEY.default;
        const configuredUrl = getVal(settingKey) || settings[settingKey] || defaultSettings[settingKey] || "";
        const normalizedUrl = normalizeUrl(configuredUrl);

        let audioSource = configuredUrl;
        let objectUrl = null;
        let blobFromCache = null;

        // Always try to use IndexedDB cache first for notifications
        if (supportsIndexedDB && normalizedUrl) {
          try {
            // First, try to get from cache
            blobFromCache = await getCachedAudioBlobForUrl(settingKey, normalizedUrl);
            
            // If not in cache, fetch and save it to IndexedDB before playing
            if (!blobFromCache) {
              console.log("Fiverr Assistant: Audio not in IndexedDB cache, fetching and saving before playing", {
                settingKey,
                sourceUrl: normalizedUrl,
              });
              blobFromCache = await ensureAudioBlob(settingKey, normalizedUrl);
              
              if (blobFromCache) {
                console.info("Fiverr Assistant: Audio fetched and saved to IndexedDB, now playing from cache", {
                  settingKey,
                  sourceUrl: normalizedUrl,
                  blobSize: blobFromCache.size,
                });
              } else {
                console.warn("Fiverr Assistant: Failed to fetch and cache audio, will play from URL", {
                  settingKey,
                  sourceUrl: normalizedUrl,
                });
              }
            } else {
              console.info("Fiverr Assistant: Playing notification sound from IndexedDB cache", {
                settingKey,
                sourceUrl: normalizedUrl,
                blobSize: blobFromCache.size,
              });
            }
          } catch (error) {
            console.warn("Fiverr Assistant: Error loading audio from IndexedDB cache, falling back to URL", {
              settingKey,
              sourceUrl: normalizedUrl,
              error: error.message,
            });
          }
        } else if (supportsIndexedDB && !normalizedUrl) {
          try {
            await deleteCachedAudioRecord(settingKey);
          } catch (error) {
            console.warn("Fiverr Auto Reloader: failed to clear cached audio", error);
          }
        }

        // Use cached blob if available, otherwise fall back to URL
        if (blobFromCache instanceof Blob) {
          objectUrl = URL.createObjectURL(blobFromCache);
          audioSource = objectUrl;
          console.info("Fiverr Assistant: Using IndexedDB cached audio for notification", {
            settingKey,
            sourceUrl: normalizedUrl,
            blobSize: blobFromCache.size,
          });
        } else if (supportsIndexedDB && normalizedUrl) {
          // If we couldn't get from cache but have a URL, try to cache it in background for next time
          ensureAudioBlob(settingKey, normalizedUrl).catch(() => {});
          console.info("Fiverr Assistant: Playing notification sound from URL (cache unavailable)", {
            settingKey,
            sourceUrl: normalizedUrl,
          });
        }

        if (!audioSource) {
          console.warn(`Fiverr Auto Reloader: no audio source configured for ${settingKey}`);
          return Promise.resolve();
        }

        const audio = new Audio(audioSource);

        let cleanedUp = false;
        const cleanup = () => {
          if (cleanedUp) {
            return;
          }
          cleanedUp = true;
          // Remove from tracking set
          playingAudioElements.delete(audio);
          if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
          }
          audio.removeEventListener("ended", cleanup);
          audio.removeEventListener("error", cleanup);
          audio.removeEventListener("pause", cleanup);
        };

        // Add event listeners for cleanup
        audio.addEventListener("ended", cleanup);
        audio.addEventListener("error", cleanup);
        audio.addEventListener("pause", () => {
          // Remove from tracking set when paused (but don't cleanup objectUrl yet in case it resumes)
          playingAudioElements.delete(audio);
        });

        try {
          const playPromise = audio.play();
          if (playPromise && typeof playPromise.then === "function") {
            // Modern browsers - play() returns a promise
            playPromise.then(() => {
              // Audio started playing successfully, add to tracking set
              playingAudioElements.add(audio);
            }).catch((error) => {
              cleanup();
              console.warn("Audio playback blocked:", error, {
                settingKey,
                sourceUrl: normalizedUrl || configuredUrl,
              });
            });
          } else {
            // Older browsers or immediate play - add to tracking set
            playingAudioElements.add(audio);
          }
          // Log whether playing from cache or URL
          if (objectUrl) {
            console.info("Fiverr Assistant: Notification sound playing from IndexedDB cache", {
              settingKey,
              sourceUrl: normalizedUrl || configuredUrl,
            });
          } else {
            console.info("Fiverr Assistant: Notification sound playing from URL (cache not available)", {
              settingKey,
              sourceUrl: normalizedUrl || configuredUrl,
            });
          }
          return playPromise;
        } catch (error) {
          cleanup();
          console.warn("Audio playback blocked:", error, {
            settingKey,
            sourceUrl: normalizedUrl || configuredUrl,
          });
          return Promise.reject(error);
        }
      };

      document.body.addEventListener("click", () => {
        lastAction = Date.now();
        // Stop any playing notification sounds when user clicks
        stopAllNotificationSounds();
        if (autoReload) {
          scheduleNextReload();
        } else {
          updateStatusDisplay();
        }
      });

      window.addEventListener("keydown", (event) => {
        lastAction = Date.now();
        // Stop any playing notification sounds when user presses any key
        stopAllNotificationSounds();

        if (event.code === "F8") {
          pauseAutoReload();
          alert("Fiverr Auto Reloader Disabled For 15 Minutes");
          setTimeout(() => {
            if (!isF10Clicked) {
              enableAutoReload();
            }
          }, 900000);
        }

        if (event.code === "F10") {
          alert("Fiverr Auto Reloader Turned Off");
          isF10Clicked = true;
          pauseAutoReload();
        }

        if (event.code === "F6") {
          // F6 key functionality removed - sendMail requires a target parameter
        }

        if (event.code === "F4") {
          event.preventDefault();
          const attemptFallbackOpen = () => {
            if (runtime && typeof runtime.getURL === "function") {
              const url = runtime.getURL("options.html");
              window.open(url, "_blank", "noopener,noreferrer");
            } else if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.getURL === "function") {
              const url = chrome.runtime.getURL("options.html");
              window.open(url, "_blank", "noopener,noreferrer");
            }
          };

          if (runtime && typeof runtime.openOptionsPage === "function") {
            try {
              const result = runtime.openOptionsPage();
              if (result && typeof result.catch === "function") {
                result.catch(attemptFallbackOpen);
              }
            } catch (error) {
              attemptFallbackOpen();
            }
          } else if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.openOptionsPage === "function") {
            chrome.runtime.openOptionsPage(() => {
              if (chrome.runtime.lastError) {
                attemptFallbackOpen();
              }
            });
          } else {
            attemptFallbackOpen();
          }
        }

        if (autoReload) {
          scheduleNextReload();
        } else {
          updateStatusDisplay();
        }
      });

      sendNotification = (message) => {
        if ("Notification" in window) {
          Notification.requestPermission().then(function (permission) {
            if (permission === "granted") {
              var options = {
                body: message,
                icon: "https://fiverr-res.cloudinary.com/npm-assets/layout-service/favicon-32x32.8f21439.png",
                tag: "fiverr-notification",
              };
              new Notification(message, options);
            }
          });
        } else {
          console.log("Your browser does not support notifications.");
        }
      };

      if (window.location.href === inboxUrl) {
        const unreadIconSelector = settings.selectorUnreadIcon || defaultSettings.selectorUnreadIcon;
        const newClientFlagSelector = settings.selectorNewClientFlag || defaultSettings.selectorNewClientFlag;
        let hasMessage = document.querySelector(unreadIconSelector);

        if (hasMessage) {
          let newClientFlag = document.querySelector(newClientFlagSelector);
          if (newClientFlag) {
            // Try to extract username
            let clientUsername = null;
            try {
              const messageElement = newClientFlag.closest('[class*="message"], [class*="conversation"]');
              if (messageElement) {
                const usernameElement = messageElement.querySelector('[class*="username"], [class*="name"]');
                if (usernameElement) {
                  clientUsername = usernameElement.textContent?.trim();
                }
              }
            } catch (e) {
              console.warn("Fiverr Assistant: Error extracting username on page load", e);
            }
            
            // Show alert for new client message
            playAudio("new");
            sendNotification("New client Message");
            // Pause auto-reload for 5 minutes when notification plays
            pauseAutoReloadForNotification();
            // Activate the tab when new client message is detected
            activateFiverrTab();
          } else {
            // Show alert for old client message too
            let targetClients = targetedClients.split(",");
            let isTargeted = targetClients.some((client) => client.trim() === "programerikram");
            if (isTargeted) {
              playAudio("targeted");
              sendNotification("Old client Message");
            } else {
              playAudio("old");
              sendNotification("Old client Message");
            }
          }
        }
      }

      if (siteDomain === "www.fiverr.com") {
        ensureMessageCheckInterval();

        if (autoReload) {
          scheduleNextReload();
        } else {
          updateStatusDisplay();
        }
      } else {
        clearMessageCheckInterval();
      }
      featuresInitialized = true;
      initializeTimeTracking();
      if (autoReload && isPrimaryTab) {
        startOfflineErrorChecking();
      }
    } catch (error) {
      console.log(error);
      setTimeout(() => {
        if (isOnline) {
          markPrimaryNavigation();
          window.location.reload();
        }
      }, 3000);
    }

    })();

    try {
      await initializePromise;
    } finally {
      initializePromise = null;
    }
  }

  // Initialize connection tracking on load
  if (isOnline) {
    startConnectionTracking();
  }
  
  // Check page load status only once when page fully loads
  // Use a single listener to avoid multiple checks
  const handlePageLoad = () => {
    if (pageLoadCheckDone) {
      return; // Already checked this page load
    }
    
    lastReloadCheckTime = Date.now();
    if (siteDomain === "www.fiverr.com" && autoReload && isPrimaryTab) {
      // Wait for page to fully load before checking
      setTimeout(() => {
        checkPageLoadStatus();
      }, RELOAD_CHECK_DELAY);
    }
  };
  
  // Only check once when page is fully loaded
  if (document.readyState === "complete") {
    // Page already loaded
    handlePageLoad();
  } else {
    // Wait for page to fully load
    window.addEventListener("load", handlePageLoad, { once: true });
  }
  
  initialize();
})();


