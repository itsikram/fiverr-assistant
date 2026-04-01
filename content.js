(async function () {
  // Global flag to track if fabs extension is active
  let fabsReloaderDetected = false;
  
  // Check function to detect if "fabs fiverr reloader assistant" is active
  const checkForFabsReloader = () => {
    // Check for window properties that might be set by fabs extension
    if (window.fabsReloader || window.fabsFiverrReloader || window.__fabsReloader) {
      return true;
    }
    
    // Check for localStorage/sessionStorage flags
    try {
      if (localStorage.getItem('fabsReloaderActive') === 'true' || 
          localStorage.getItem('fabsFiverrReloader') === 'true' ||
          sessionStorage.getItem('fabsReloaderActive') === 'true') {
        return true;
      }
    } catch (e) {}
    
    // Check for DOM elements or classes that might indicate fabs extension
    if (document.querySelector('[data-fabs-reloader]') || 
        document.querySelector('.fabs-reloader') ||
        document.querySelector('#fabs-reloader')) {
      return true;
    }
    
    // Check for script tags with fabs identifier
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      if (script.src && (script.src.includes('fabs') && script.src.includes('reloader'))) {
        return true;
      }
      if (script.textContent && script.textContent.includes('fabs') && script.textContent.includes('reloader')) {
        return true;
      }
    }
    
    // Check for extension-specific global variables (common patterns)
    if (typeof window.fabs !== 'undefined' || 
        typeof window.fabsReloader !== 'undefined' ||
        typeof window.fabsFiverrReloader !== 'undefined') {
      return true;
    }
    
    // Check for any element with fabs in id or class
    if (document.querySelector('[id*="fabs"]') || document.querySelector('[class*="fabs"]')) {
      return true;
    }
    
    return false;
  };
  
  // Exit early if fabs reloader is detected at startup
  if (checkForFabsReloader()) {
    fabsReloaderDetected = true;
    console.log('Fiverr Assistant: fabs fiverr reloader assistant is active. Exiting to prevent conflicts.');
    return; // Exit the entire script
  }
  
  // Set up periodic monitoring for fabs extension (check every 2 seconds)
  const fabsMonitorInterval = setInterval(() => {
    if (checkForFabsReloader()) {
      fabsReloaderDetected = true;
      console.log('Fiverr Assistant: fabs fiverr reloader assistant detected. Stopping all functionality to prevent conflicts.');
      clearInterval(fabsMonitorInterval);
      
      // Stop all intervals and timeouts
      if (messageCheckIntervalId) clearInterval(messageCheckIntervalId);
      if (nextReloadTimeoutId) clearTimeout(nextReloadTimeoutId);
      if (statusUpdateIntervalId) clearInterval(statusUpdateIntervalId);
      if (offlineCheckIntervalId) clearInterval(offlineCheckIntervalId);
      
      // Remove status display
      removeStatusDisplay();
      
      return; // Exit monitoring
    }
  }, 2000);
  
  // Helper function to check if we should continue execution
  const shouldContinueExecution = () => {
    if (fabsReloaderDetected || checkForFabsReloader()) {
      fabsReloaderDetected = true;
      return false;
    }
    return true;
  };
  
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
let lastCallTime = 0; // stores the timestamp of the last API call
const phoneCall = () => {
  // Don't make phone calls or show alerts if fabs reloader is active
  // Check the global flag directly (it's defined before this function)
  if (typeof fabsReloaderDetected !== 'undefined' && fabsReloaderDetected) {
    return;
  }
  
  const now = Date.now(); // current timestamp in milliseconds
  const FIVE_MINUTES = 5 * 60 * 1000; // 5 minutes in ms

  if (now - lastCallTime >= FIVE_MINUTES) {
    // it's been more than 5 minutes since last call
    fetch("https://connect-server-7h7d.onrender.com/api/connect/phone-call?to=8801581400711&text=you have new client message in fiverr please check this out i am repeating again  you have received message from new client in fiverr.")
      .then(res => {
        // Check if response is ok
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        // Check content-type before parsing as JSON
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          return res.json();
        } else {
          // If not JSON, return the text response
          return res.text().then(text => {
            console.warn("API response is not JSON:", text);
            return { success: true, message: text };
          });
        }
      })
      .then(data  => {
        // Check again before showing alert
        if (typeof fabsReloaderDetected !== 'undefined' && fabsReloaderDetected) {
          return;
        }
        alert('call made successfully');
        console.log("Call API response:", data)
      })
      .catch(err => console.error("Error calling API:", err));

    lastCallTime = now; // update last call timestamp
  } else {
    console.log("API call skipped: called less than 5 minutes ago");
  }
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

  const readAutoReloadPreference = async () => {
    // First try to read from chrome.storage.local (persistent across page reloads)
    if (extensionStorage) {
      try {
        const result = await extensionStorage.get("autoReloadEnabled");
        if (result && Object.prototype.hasOwnProperty.call(result, "autoReloadEnabled")) {
          return coerceBooleanSetting(result.autoReloadEnabled, true);
        }
      } catch (error) {
        console.warn("Fiverr Auto Reloader: unable to read auto reload preference from extension storage", error);
      }
    }
    // Fallback to localStorage for backward compatibility
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
  let autoReload = true; // Default to true, will be updated from storage
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
  let autoReactivateTimeoutId = null; // Track timeout for auto-reactivation after pause

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
    // Clear any existing auto-reactivation timeout
    if (autoReactivateTimeoutId) {
      clearTimeout(autoReactivateTimeoutId);
      autoReactivateTimeoutId = null;
    }
    // Save the stopped state to chrome.storage.local so it persists after page reload
    if (extensionStorage) {
      const reactivateTimestamp = Date.now() + AUTO_REACTIVATE_DELAY_MS;
      extensionStorage.set({ 
        autoReloadEnabled: false,
        [AUTO_REACTIVATE_TIMESTAMP_KEY]: reactivateTimestamp
      }).catch((error) => {
        console.warn("Fiverr Assistant: Failed to save auto-reload stopped state", error);
      });
      
      // Set timeout to auto-reactivate after 1 minute
      autoReactivateTimeoutId = setTimeout(() => {
        autoReactivateTimeoutId = null;
        if (!isF10Clicked && featuresInitialized) {
          enableAutoReload();
          console.log("Fiverr Assistant: Auto-reload auto-reactivated after 1 minute");
        }
        // Remove the timestamp from storage
        if (extensionStorage) {
          extensionStorage.remove(AUTO_REACTIVATE_TIMESTAMP_KEY).catch(() => {});
        }
      }, AUTO_REACTIVATE_DELAY_MS);
      
      console.log("Fiverr Assistant: Auto-reload paused, will auto-reactivate in 1 minute");
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
    // Clear auto-reactivation timeout if manually enabled before timeout
    if (autoReactivateTimeoutId) {
      clearTimeout(autoReactivateTimeoutId);
      autoReactivateTimeoutId = null;
    }
    // Save the enabled state to chrome.storage.local so it persists after page reload
    if (extensionStorage) {
      extensionStorage.set({ 
        autoReloadEnabled: true
      }).then(() => {
        // Remove reactivation timestamp if it exists
        return extensionStorage.remove(AUTO_REACTIVATE_TIMESTAMP_KEY);
      }).catch((error) => {
        console.warn("Fiverr Assistant: Failed to save auto-reload enabled state", error);
      });
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
  let lastNotificationTime = 0; // Track last notification time to prevent rapid repeats
  const NOTIFICATION_COOLDOWN_MS = 5000; // 5 second cooldown between notifications
  
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

  // Function to validate if an element is actually a new client indicator (clock icon)
  // and not an old client with Pro Client badge
  const isValidNewClientFlag = (element) => {
    if (!element) return false;
    
    // First, check for Pro Client badge (old client) - if found, it's NOT a new client
    const allSvgs = element.querySelectorAll('svg');
    for (let svg of allSvgs) {
      const paths = svg.querySelectorAll('path');
      for (let path of paths) {
        const d = path.getAttribute('d') || '';
        // Pro Client badge has these specific path patterns - if found, reject as new client
        if (d.includes('M13.657 4.476') || d.includes('M8.8 7.086') || d.includes('M6 0C2.5')) {
          return false;
        }
      }
    }
    
    // Now check for clock icon (new client indicator)
    // Clock icon has viewBox="0 0 16 17" and specific path patterns
    const clockIcon = element.querySelector('svg[viewBox="0 0 16 17"]');
    if (clockIcon) {
      const paths = clockIcon.querySelectorAll('path');
      for (let path of paths) {
        const d = path.getAttribute('d') || '';
        // Clock icon has these specific path patterns
        if (d.includes('M8 5.8') || d.includes('M8 15.25a6.75') || d.includes('v2.7l1.35')) {
          return true;
        }
      }
    }
    
    // Also check any SVG for clock icon patterns (fallback)
    for (let svg of allSvgs) {
      const paths = svg.querySelectorAll('path');
      for (let path of paths) {
        const d = path.getAttribute('d') || '';
        // Clock icon patterns (but only if we didn't find Pro Client badge above)
        if (d.includes('M8 5.8') || (d.includes('M8 15.25a6.75') && d.includes('6.75 6.75 0 1 0'))) {
          return true;
        }
      }
    }
    
    // If we can't determine, default to false to avoid false positives
    return false;
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
      const cachedFlag = cachedNewClientFlag && document.body.contains(cachedNewClientFlag) ? cachedNewClientFlag : null;
      // Validate cached flag to ensure it's actually a new client (clock icon)
      newClientFlag = cachedFlag && isValidNewClientFlag(cachedFlag) ? cachedFlag : null;
    } else {
      // Refresh cache
      hasMessage = document.querySelector(unreadIconSelector);
      const foundFlag = hasMessage ? document.querySelector(newClientFlagSelector) : null;
      // Validate found flag to ensure it's actually a new client (clock icon), not Pro Client badge
      newClientFlag = foundFlag && isValidNewClientFlag(foundFlag) ? foundFlag : null;
      
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
          // This is a new message, process it immediately
          processedNewClientMessages.add(messageId);
          lastNotificationTime = Date.now();
          
          // Try to extract client name from DOM using comprehensive extraction function
          let clientName = extractClientName(newClientFlag);
          
          // Fallback: If extraction failed but messageId looks like a name, use it
          // This handles cases where newClientFlag.textContent IS the name (like "Luciano")
          if (!clientName && messageId && typeof messageId === 'string') {
            const namePattern = /^[a-zA-Z0-9_-]{2,50}$/;
            const excludedWords = /^(new|message|unread|read|sent|received|ago|min|hour|day|view|reply|delete|first|second|third|inbox|conversation|chat|the|a|an|and|or|but|is|are|was|were|has|have|had|will|would|could|should|may|might|can|must)$/i;
            if (namePattern.test(messageId.trim()) && !excludedWords.test(messageId.trim())) {
              clientName = messageId.trim();
            }
          }
          
          // Check if client is in ignored list - skip audio and notification if ignored
          const isIgnored = clientName ? isClientIgnored(clientName) : false;
          
          if (!isIgnored) {
          // Play sound instantly (if enabled in settings)
          if (coerceBooleanSetting(settings.enable_new_client_sound, true)) {
            phoneCall()
            playAudio("new");
          }
          if (coerceBooleanSetting(settings.enable_new_client_notification, true)) {
            sendNotification("New client Message", clientName);
            }
          
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
            clientName
          });
          } else {
            console.log("Fiverr Assistant: Client is in ignored list, skipping audio, notification, tab activation, and redirect", { clientName });
          }
          
          // Clean up old processed messages (keep only last 20 for better tracking)
          if (processedNewClientMessages.size > 20) {
            const firstItem = processedNewClientMessages.values().next().value;
            processedNewClientMessages.delete(firstItem);
          }
          
          // Invalidate cache after detecting new message
          cacheTimestamp = 0;
        } else {
          // Message already processed - check cooldown to prevent rapid repeated notifications
          const timeSinceLastNotification = Date.now() - lastNotificationTime;
          if (timeSinceLastNotification < NOTIFICATION_COOLDOWN_MS) {
            console.log("Fiverr Assistant: New client message already processed, cooldown active - skipping duplicate notification");
            return;
          } else {
            console.log("Fiverr Assistant: New client message already processed, but cooldown passed - this is likely a duplicate detection");
          }
        }
      } else {
        // Has message but not a new client - could be an old client message
        // Still show alert but with different message
        
        // Create a stable messageId by looking at the conversation/message element
        // Try to find the actual conversation element to get a stable identifier
        let messageId = null;
        let useTimestampFallback = false;
        
        try {
          // Try to find the conversation element that contains the unread icon
          const conversationElement = hasMessage.closest('[class*="message"], [class*="conversation"], [class*="chat"], [class*="inbox-item"], li, a');
          if (conversationElement) {
            // Try to get a stable ID from the conversation element
            messageId = conversationElement.getAttribute('data-id') || 
                       conversationElement.getAttribute('data-conversation-id') ||
                       conversationElement.getAttribute('id');
            
            // If we have an href, use it as the ID (most stable)
            if (!messageId && conversationElement.href) {
              const href = conversationElement.href;
              // Extract conversation ID from URL if possible
              const urlMatch = href.match(/\/inbox\/([^\/\?]+)/);
              if (urlMatch) {
                messageId = `old-client-${urlMatch[1]}`;
              } else if (href.includes('fiverr.com')) {
                // Use a hash of the URL for stability
                messageId = `old-client-url-${href.split('?')[0]}`;
              }
            }
            
            // Fallback: use text content from conversation element (first 100 chars)
            if (!messageId && conversationElement.textContent) {
              const textContent = conversationElement.textContent.trim().substring(0, 100);
              if (textContent && textContent.length > 10) {
                messageId = `old-client-${textContent}`;
              }
            }
          }
        } catch (e) {
          console.warn("Fiverr Assistant: Error extracting conversation ID", e);
        }
        
        // Final fallback: use unread icon's parent structure
        if (!messageId) {
          try {
            if (hasMessage.parentElement) {
              const parentText = hasMessage.parentElement.textContent?.trim().substring(0, 100) || '';
              if (parentText && parentText.length > 10) {
                messageId = `old-client-${parentText}`;
              }
            }
          } catch (e) {
            console.warn("Fiverr Assistant: Error extracting parent text", e);
          }
        }
        
        // Last resort: use unread icon itself (but this is less stable)
        if (!messageId) {
          messageId = hasMessage.getAttribute('data-id') || 
                     hasMessage.getAttribute('id');
          if (!messageId && hasMessage.textContent) {
            const iconText = hasMessage.textContent.trim().substring(0, 50);
            if (iconText && iconText.length > 0) {
              messageId = `old-client-icon-${iconText}`;
            }
          }
        }
        
        // If still no stable ID, use a timestamp-based approach with cooldown protection
        if (!messageId) {
          // Use a combination of current URL and a rounded timestamp (to nearest 10 seconds)
          // This prevents loops while still allowing notifications
          const roundedTime = Math.floor(Date.now() / 10000) * 10000; // Round to nearest 10 seconds
          const currentUrl = window.location.href.split('?')[0];
          messageId = `old-client-fallback-${currentUrl}-${roundedTime}`;
          useTimestampFallback = true;
          console.log("Fiverr Assistant: Using timestamp-based fallback for messageId", messageId);
        }
        
        // Check cooldown first if using timestamp fallback (to prevent rapid notifications)
        if (useTimestampFallback) {
          const timeSinceLastNotification = Date.now() - lastNotificationTime;
          if (timeSinceLastNotification < NOTIFICATION_COOLDOWN_MS) {
            console.log("Fiverr Assistant: Using timestamp fallback, cooldown active - skipping duplicate notification");
            return;
          }
        }
        
        // Only process if we haven't seen this message before
        if (!processedNewClientMessages.has(messageId)) {
          // This is a new message, process it immediately
          processedNewClientMessages.add(messageId);
          lastNotificationTime = Date.now();
          
          // Try to extract client name from DOM
          let clientName = extractClientName(hasMessage);
          
          console.log("Fiverr Assistant: Extracted client name for old client message", {
            clientName,
            messageId: messageId ? messageId.substring(0, 100) : null
          });
          
          // Check if client is in ignored list - skip audio and notification if ignored
          const isIgnored = clientName ? isClientIgnored(clientName) : false;
          
          if (!isIgnored) {
          // Check if client is targeted and play appropriate sound
          const isTargeted = clientName ? isClientTargeted(clientName) : false;
          
          console.log("Fiverr Assistant: Sound decision for old client message", {
            clientName,
            isTargeted,
            isIgnored,
            enableOldClientSound: coerceBooleanSetting(settings.enable_old_client_sound, true)
          });
          
          if (isTargeted) {
            // Play targeted client sound
            if (coerceBooleanSetting(settings.enable_old_client_sound, true)) {
              const targetedSoundUrl = getVal("targeted_client_sound") || settings.targeted_client_sound || defaultSettings.targeted_client_sound || "";
              console.log("Fiverr Assistant: Playing targeted client sound for", {
                clientName,
                isTargeted: true,
                targetedSoundUrl: targetedSoundUrl ? targetedSoundUrl.substring(0, 100) : "NOT CONFIGURED - will use default"
              });
              // Always play targeted sound, even if URL is not configured (will use default)
              playAudio("targeted");
            } else {
              console.log("Fiverr Assistant: Targeted client sound is disabled in settings");
            }
          } else {
            // Play old client sound for non-targeted clients
            if (coerceBooleanSetting(settings.enable_old_client_sound, true)) {
              console.log("Fiverr Assistant: Playing old client sound for non-targeted client", {
                clientName,
                isTargeted: false
              });
              playAudio("old");
              phoneCall();
            }
          }
          
          if (coerceBooleanSetting(settings.enable_old_client_notification, true)) {
            sendNotification("New Message", clientName);
            }
          
          // Instantly redirect to inbox when new message is detected
          if (window.location.href !== inboxUrl && isOnline) {
            markPrimaryNavigation();
            window.location.href = inboxUrl;
          }
          } else {
            console.log("Fiverr Assistant: Client is in ignored list, skipping audio, notification, and redirect", { clientName });
          }
          
          console.log("Fiverr Assistant: New message detected (not new client), redirecting to inbox (tab not focused)", {
            messageId: messageId.substring(0, 100),
            useTimestampFallback
          });
          
          // Clean up old processed messages (keep only last 20 for better tracking)
          if (processedNewClientMessages.size > 20) {
            const firstItem = processedNewClientMessages.values().next().value;
            processedNewClientMessages.delete(firstItem);
          }
          
          cacheTimestamp = 0;
        } else {
          // Message already processed - check cooldown to prevent rapid repeated notifications
          const timeSinceLastNotification = Date.now() - lastNotificationTime;
          if (timeSinceLastNotification < NOTIFICATION_COOLDOWN_MS) {
            console.log("Fiverr Assistant: Old client message already processed, cooldown active - skipping duplicate notification");
            return;
          } else {
            console.log("Fiverr Assistant: Old client message already processed, but cooldown passed - this is likely a duplicate detection");
          }
        }
      }
    }
  };

  const runMessageCheck = () => {
    // Check if fabs reloader is active - exit if detected
    if (!shouldContinueExecution()) {
      return;
    }
    
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
      const cachedFlag = cachedNewClientFlag && document.body.contains(cachedNewClientFlag) ? cachedNewClientFlag : null;
      // Validate cached flag to ensure it's actually a new client (clock icon)
      newClientFlag = cachedFlag && isValidNewClientFlag(cachedFlag) ? cachedFlag : null;
    } else {
      // Refresh cache
      hasMessage = document.querySelector(unreadIconSelector);
      const foundFlag = hasMessage ? document.querySelector(newClientFlagSelector) : null;
      // Validate found flag to ensure it's actually a new client (clock icon), not Pro Client badge
      newClientFlag = foundFlag && isValidNewClientFlag(foundFlag) ? foundFlag : null;
      
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
        }, 50); // Minimal debounce for near-instant detection (cooldown prevents loops)
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
    // Check if fabs reloader is active - exit if detected
    if (!shouldContinueExecution()) {
      return;
    }
    
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
    ignoreClients: "",
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
    enable_new_client_sound: true,
    enable_old_client_sound: true,
    enable_new_client_notification: true,
    enable_old_client_notification: true,
    inboxTranslateEnabled: "true",
    inboxTranslateClientLang: "",
    inboxTranslateDebounceMs: "500",
    openaiApiKey: "",
    openaiModel: "gpt-4o-mini",
    inboxMessageListSelector: "",
    inboxMessageRowSelector: "",
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
    // Check if audio is already saved in IndexedDB before fetching
    const existing = await readCachedAudioRecord(key);
    if (existing && existing.sourceUrl === normalizedUrl && existing.blob instanceof Blob) {
      console.info("Fiverr Assistant: Audio already saved in IndexedDB, skipping fetch", {
        settingKey: key,
        sourceUrl: normalizedUrl,
        blobSize: existing.blob.size,
        timestamp: existing.timestamp,
      });
      return existing.blob;
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
  let ignoreClients = "";
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
    ignoreClients = settings.ignoreClients || "";
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

  let inboxTranslateComposerObserver = null;
  let inboxTranslateEnhanceScheduled = false;
  let inboxTranslateThreadPath = "";
  let inboxTranslateCachedLang = null;
  let farInboxHistoryListenStarted = false;

  const INBOX_CLIENT_LANG_MAP_KEY = "farInboxClientTranslateLangMap";

  const INBOX_TRANSLATE_LANG_OPTIONS = [
    { value: "", label: "Auto" },
    { value: "en", label: "English" },
    { value: "es", label: "Spanish" },
    { value: "de", label: "German" },
    { value: "fr", label: "French" },
    { value: "it", label: "Italian" },
    { value: "pt", label: "Portuguese" },
    { value: "nl", label: "Dutch" },
    { value: "pl", label: "Polish" },
    { value: "ru", label: "Russian" },
    { value: "uk", label: "Ukrainian" },
    { value: "tr", label: "Turkish" },
    { value: "ar", label: "Arabic" },
    { value: "hi", label: "Hindi" },
    { value: "ja", label: "Japanese" },
    { value: "ko", label: "Korean" },
    { value: "zh-CN", label: "中文" },
    { value: "vi", label: "Vietnamese" },
    { value: "id", label: "Indonesian" },
    { value: "th", label: "Thai" },
    { value: "cs", label: "Czech" },
    { value: "ro", label: "Romanian" },
    { value: "sv", label: "Swedish" },
    { value: "no", label: "Norwegian" },
    { value: "da", label: "Danish" },
    { value: "fi", label: "Finnish" },
    { value: "el", label: "Greek" },
    { value: "he", label: "Hebrew" },
    { value: "hu", label: "Hungarian" },
    { value: "ms", label: "Malay" },
    { value: "tl", label: "Filipino" },
    { value: "custom", label: "Other…" },
  ];

  const getInboxClientKeyFromPath = () => {
    try {
      const p = window.location.pathname || "";
      const m = p.match(/^\/inbox\/([^/]+)/i);
      if (!m) {
        return null;
      }
      const seg = decodeURIComponent(m[1]).trim().toLowerCase();
      if (!seg || ["offers", "templates"].includes(seg)) {
        return null;
      }
      return seg;
    } catch (_) {
      return null;
    }
  };

  const loadClientTranslateLangMap = async () => {
    let map = {};
    if (extensionStorage) {
      try {
        const r = await extensionStorage.get(INBOX_CLIENT_LANG_MAP_KEY);
        const rawMap = r && r[INBOX_CLIENT_LANG_MAP_KEY];
        if (rawMap && typeof rawMap === "object" && !Array.isArray(rawMap)) {
          map = { ...rawMap };
        }
      } catch (_) {}
    }
    if (Object.keys(map).length === 0) {
      try {
        const raw = localStorage.getItem(INBOX_CLIENT_LANG_MAP_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            map = { ...parsed };
          }
        }
      } catch (_) {}
    }
    return map;
  };

  const saveClientTranslateLangMap = async (map) => {
    try {
      localStorage.setItem(INBOX_CLIENT_LANG_MAP_KEY, JSON.stringify(map));
    } catch (_) {}
    if (extensionStorage) {
      try {
        await extensionStorage.set({ [INBOX_CLIENT_LANG_MAP_KEY]: map });
      } catch (_) {}
    }
  };

  const applyLangSelectionToUI = (langSelect, customInput, customWrap, savedCode) => {
    const s = String(savedCode || "").trim();
    if (!s || s.toLowerCase() === "auto") {
      langSelect.value = "";
      customInput.value = "";
      if (customWrap) {
        customWrap.style.display = "none";
      }
      return;
    }
    const lower = s.toLowerCase();
    let found = "";
    for (let i = 0; i < langSelect.options.length; i++) {
      const o = langSelect.options[i];
      if (!o.value || o.value === "custom") {
        continue;
      }
      if (o.value.toLowerCase() === lower) {
        found = o.value;
        break;
      }
    }
    if (found) {
      langSelect.value = found;
      customInput.value = "";
      if (customWrap) {
        customWrap.style.display = "none";
      }
    } else {
      langSelect.value = "custom";
      customInput.value = s;
      if (customWrap) {
        customWrap.style.display = "block";
      }
    }
  };

  const getPersistedLangCodeFromUI = (langSelect, customInput) => {
    const v = langSelect.value;
    if (v === "custom") {
      return (customInput.value || "").trim();
    }
    return (v || "").trim();
  };

  const persistInboxClientLang = async (clientKey, langSelect, customInput) => {
    if (!clientKey) {
      return;
    }
    const code = getPersistedLangCodeFromUI(langSelect, customInput);
    const map = await loadClientTranslateLangMap();
    const next = { ...map };
    if (!code) {
      delete next[clientKey];
    } else {
      next[clientKey] = code;
    }
    await saveClientTranslateLangMap(next);
  };

  const ensureInboxTranslateStyles = () => {
    if (document.getElementById("far-inbox-translate-styles")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "far-inbox-translate-styles";
    style.textContent =
      ".far-inbox-translate-root{display:flex;align-items:flex-start;gap:8px;width:100%;min-width:0;box-sizing:border-box;}" +
      ".far-inbox-translate-left{display:flex;flex-direction:column;align-items:center;flex-shrink:0;padding-top:4px;}" +
      ".far-inbox-translate-toolbar-row{display:flex;flex-direction:row;align-items:center;gap:6px;}" +
      ".far-inbox-translate-toggle{display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:8px;border:1px solid #c4c4c4;background:#fff;color:#222325;cursor:pointer;padding:0;font-family:inherit;}" +
      ".far-inbox-translate-toggle:hover{background:#f5f5f5;}" +
      ".far-inbox-translate-toggle--active{background:#1dbf73;color:#fff;border-color:#1dbf73;}" +
      ".far-inbox-translate-icon{display:block;flex-shrink:0;pointer-events:none;}" +
      ".far-inbox-translate-to-from-row{display:flex;flex-direction:row;align-items:center;gap:10px;width:100%;min-width:0;}" +
      ".far-inbox-translate-to-col{flex:0 0 112px;min-width:0;display:flex;flex-direction:column;gap:4px;}" +
      ".far-inbox-translate-from-col{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;}" +
      ".far-inbox-translate-lang-label{font-size:10px;font-weight:600;color:#64748b;line-height:1.2;}" +
      ".far-inbox-translate-lang{font:inherit;font-size:11px;padding:5px 6px;border-radius:6px;border:1px solid #c4c4c4;background:#fff;color:#222325;width:100%;box-sizing:border-box;cursor:pointer;}" +
      ".far-inbox-translate-lang:focus{outline:2px solid rgba(29,191,115,0.35);outline-offset:1px;}" +
      ".far-inbox-translate-custom{font:inherit;font-size:11px;padding:4px 6px;border-radius:6px;border:1px solid #c4c4c4;width:100%;box-sizing:border-box;}" +
      ".far-inbox-translate-english-wrap{display:none;flex-direction:column;gap:8px;width:100%;}" +
      ".far-inbox-translate-english{width:100%;box-sizing:border-box;min-height:44px;padding:8px 10px;border:1px solid #c4c4c4;border-radius:6px;font:inherit;line-height:1.4;resize:vertical;background:#fff;color:#222325;}" +
      ".far-inbox-translate-from-label{font-size:11px;font-weight:600;color:#64748b;}" +
      ".far-inbox-translate-status{font-size:12px;color:#64748b;min-height:16px;line-height:1.3;}";
    document.documentElement.appendChild(style);
  };

  const ensureFarInboxLocationListeners = () => {
    if (farInboxHistoryListenStarted) {
      return;
    }
    farInboxHistoryListenStarted = true;
    const notifyRoots = () => {
      const path = window.location.pathname || "";
      document.querySelectorAll("[data-far-inbox-translate-root]").forEach((root) => {
        if (root.dataset.farClientPath !== path) {
          root.dataset.farClientPath = path;
          root.dispatchEvent(new CustomEvent("far-inbox-client-changed", { bubbles: false }));
        }
      });
    };
    window.addEventListener("popstate", notifyRoots);
    try {
      if (!window.__farFarInboxHistoryPatched) {
        window.__farFarInboxHistoryPatched = true;
        ["pushState", "replaceState"].forEach((method) => {
          const orig = history[method];
          history[method] = function (...args) {
            const ret = orig.apply(this, args);
            queueMicrotask(notifyRoots);
            return ret;
          };
        });
      }
    } catch (_) {}
  };

  const normalizeLangForMyMemory = (code) => {
    if (!code || typeof code !== "string") {
      return "en";
    }
    const c = code.trim().toLowerCase().replace("_", "-");
    if (c === "zh" || c.startsWith("zh-")) {
      return "zh-CN";
    }
    return c.length > 2 ? c.slice(0, 2) : c;
  };

  const setReactTextareaValue = (el, value) => {
    if (!el) {
      return;
    }
    const proto = window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype;
    const desc = proto ? Object.getOwnPropertyDescriptor(proto, "value") : null;
    if (desc && desc.set) {
      desc.set.call(el, value);
    } else {
      el.value = value;
    }
    try {
      el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
    } catch (_) {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };

  const translateWithMyMemory = async (text, from, to) => {
    const maxChunk = 420;
    const parts = [];
    let i = 0;
    const fromN = normalizeLangForMyMemory(from);
    const toN = normalizeLangForMyMemory(to);
    while (i < text.length) {
      let end = Math.min(i + maxChunk, text.length);
      if (end < text.length) {
        const sp = text.lastIndexOf(" ", end);
        if (sp > i + 40) {
          end = sp;
        }
      }
      const chunk = text.slice(i, end);
      const url =
        "https://api.mymemory.translated.net/get?q=" +
        encodeURIComponent(chunk) +
        "&langpair=" +
        encodeURIComponent(fromN + "|" + toN);
      const res = await fetch(url);
      const json = await res.json();
      const status = json && json.responseStatus;
      const translated = json && json.responseData && json.responseData.translatedText;
      if (status !== 200 || !translated) {
        const err = (json && json.responseData && json.responseData.error) || "Translation error";
        throw new Error(String(err));
      }
      parts.push(translated);
      i = end;
      while (i < text.length && (text[i] === " " || text[i] === "\n")) {
        i += 1;
      }
    }
    return parts.join("");
  };

  const detectThreadLanguageLibre = async () => {
    const flow =
      document.querySelector(".message-flow") ||
      document.querySelector('[class*="message-flow"]');
    if (!flow) {
      return null;
    }
    const seen = new Set();
    const chunks = [];
    flow.querySelectorAll("p, span").forEach((n) => {
      const t = (n.textContent || "").trim();
      if (t.length < 12) {
        return;
      }
      const key = t.slice(0, 48);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      chunks.push(t);
    });
    const sample = chunks.slice(-10).join("\n").slice(0, 600);
    if (sample.length < 24) {
      return null;
    }
    try {
      const r = await fetch("https://libretranslate.de/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: sample.slice(0, 280) }),
      });
      if (!r.ok) {
        return null;
      }
      const data = await r.json();
      if (Array.isArray(data) && data[0] && data[0].language) {
        return normalizeLangForMyMemory(data[0].language);
      }
    } catch (_) {
      return null;
    }
    return null;
  };

  const enhanceSendMessageTextarea = (sendTa) => {
    if (!sendTa || sendTa.id !== "send-message-text-area") {
      return;
    }
    if (sendTa.closest("[data-far-inbox-translate-root]")) {
      return;
    }
    const innerStack = sendTa.parentElement;
    const hostStack = innerStack && innerStack.parentElement;
    const parentOfHost = hostStack && hostStack.parentElement;
    if (!innerStack || !hostStack || !parentOfHost) {
      return;
    }

    const path = window.location.pathname || "";
    if (inboxTranslateThreadPath !== path) {
      inboxTranslateThreadPath = path;
      inboxTranslateCachedLang = null;
    }

    const root = document.createElement("div");
    root.dataset.farInboxTranslateRoot = "1";
    root.className = "far-inbox-translate-root";
    root.dataset.farClientPath = path;

    const leftCol = document.createElement("div");
    leftCol.className = "far-inbox-translate-left";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "far-inbox-translate-toggle";
    toggle.setAttribute("aria-label", "Toggle translation composer");
    toggle.title = "Compose in English; translated text fills the message box below";
    toggle.innerHTML =
      '<svg class="far-inbox-translate-icon" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="m5 8 6 6"/><path d="M4 14 10 8l2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>' +
      "</svg>";

    const toLabel = document.createElement("div");
    toLabel.className = "far-inbox-translate-lang-label";
    toLabel.textContent = "Translate to";

    const langSelect = document.createElement("select");
    langSelect.className = "far-inbox-translate-lang";
    langSelect.title = "Target language (saved for this client)";
    langSelect.setAttribute("aria-label", "Translate message to language");
    INBOX_TRANSLATE_LANG_OPTIONS.forEach(({ value, label }) => {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label;
      langSelect.appendChild(o);
    });

    const customWrap = document.createElement("div");
    customWrap.style.cssText = "display:none;width:100%;";
    const customInput = document.createElement("input");
    customInput.type = "text";
    customInput.className = "far-inbox-translate-custom";
    customInput.placeholder = "ISO code";
    customInput.setAttribute("aria-label", "Custom language code");
    customWrap.appendChild(customInput);

    const toolbarRow = document.createElement("div");
    toolbarRow.className = "far-inbox-translate-toolbar-row";
    toolbarRow.appendChild(toggle);
    leftCol.appendChild(toolbarRow);

    if (typeof window.FarInboxAi !== "undefined" && window.FarInboxAi.attachToolbarButton) {
      window.FarInboxAi.attachToolbarButton(toolbarRow, sendTa, root, () => ({
        profile: settings.profile,
        profileUsername: settings.profileUsername,
        openaiApiKey: settings.openaiApiKey,
        openaiModel: settings.openaiModel,
        inboxMessageListSelector: settings.inboxMessageListSelector,
        inboxMessageRowSelector: settings.inboxMessageRowSelector,
      }));
    }

    const col = document.createElement("div");
    col.style.cssText = "flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;";

    const englishWrap = document.createElement("div");
    englishWrap.className = "far-inbox-translate-english-wrap";

    const toFromRow = document.createElement("div");
    toFromRow.className = "far-inbox-translate-to-from-row";

    const toCol = document.createElement("div");
    toCol.className = "far-inbox-translate-to-col";
    toCol.appendChild(toLabel);
    toCol.appendChild(langSelect);
    toCol.appendChild(customWrap);

    const fromCol = document.createElement("div");
    fromCol.className = "far-inbox-translate-from-col";

    const fromLabel = document.createElement("div");
    fromLabel.className = "far-inbox-translate-from-label";
    fromLabel.textContent = "English (translate from)";

    const englishTa = document.createElement("textarea");
    englishTa.className = "far-inbox-translate-english";
    englishTa.setAttribute("aria-label", "Write message in English");
    englishTa.placeholder = "Write in English — the Fiverr field below updates automatically…";
    englishTa.rows = 2;

    fromCol.appendChild(fromLabel);
    fromCol.appendChild(englishTa);

    toFromRow.appendChild(toCol);
    toFromRow.appendChild(fromCol);

    const statusEl = document.createElement("div");
    statusEl.className = "far-inbox-translate-status";

    englishWrap.appendChild(toFromRow);
    englishWrap.appendChild(statusEl);

    col.appendChild(englishWrap);
    parentOfHost.insertBefore(root, hostStack);
    root.appendChild(leftCol);
    root.appendChild(col);
    col.appendChild(hostStack);

    const syncLangFromStorage = () => {
      const ck = getInboxClientKeyFromPath();
      return loadClientTranslateLangMap().then((map) => {
        const saved = ck && map[ck] ? map[ck] : "";
        if (saved) {
          applyLangSelectionToUI(langSelect, customInput, customWrap, saved);
        } else {
          applyLangSelectionToUI(langSelect, customInput, customWrap, settings.inboxTranslateClientLang || "");
        }
        inboxTranslateCachedLang = null;
      });
    };

    let panelOpen = false;
    try {
      panelOpen = sessionStorage.getItem("farInboxTranslatePanelOpen") === "1";
    } catch (_) {}

    const applyPanelOpen = (open) => {
      panelOpen = open;
      englishWrap.style.display = open ? "flex" : "none";
      toggle.setAttribute("aria-pressed", open ? "true" : "false");
      toggle.classList.toggle("far-inbox-translate-toggle--active", open);
      try {
        sessionStorage.setItem("farInboxTranslatePanelOpen", open ? "1" : "0");
      } catch (_) {}
    };
    applyPanelOpen(panelOpen);

    toggle.addEventListener("click", () => applyPanelOpen(!panelOpen));

    let debounceTimer = null;
    let translateToken = 0;
    let customPersistTimer = null;

    const resolveTargetLang = async () => {
      const selVal = langSelect.value;
      if (selVal === "custom") {
        const c = (customInput.value || "").trim();
        if (c) {
          return normalizeLangForMyMemory(c);
        }
      } else if (selVal) {
        return normalizeLangForMyMemory(selVal);
      }
      const raw = String(settings.inboxTranslateClientLang || "")
        .trim()
        .toLowerCase();
      if (raw && raw !== "auto") {
        const code = raw.split(/[^a-z-]/i)[0] || raw;
        return normalizeLangForMyMemory(code);
      }
      if (inboxTranslateCachedLang) {
        return inboxTranslateCachedLang;
      }
      const detected = await detectThreadLanguageLibre();
      inboxTranslateCachedLang = detected || "es";
      return inboxTranslateCachedLang;
    };

    const runTranslate = async () => {
      const token = ++translateToken;
      const raw = englishTa.value;
      if (!raw.trim()) {
        setReactTextareaValue(sendTa, "");
        statusEl.textContent = "";
        return;
      }
      statusEl.textContent = "Translating…";
      try {
        const targetLang = await resolveTargetLang();
        if (token !== translateToken) {
          return;
        }
        if (!targetLang || targetLang === "en") {
          setReactTextareaValue(sendTa, raw);
          statusEl.textContent =
            targetLang === "en"
              ? "Target is English — no translation applied."
              : "Pick a target language above or leave Auto.";
          return;
        }
        const out = await translateWithMyMemory(raw, "en", targetLang);
        if (token !== translateToken) {
          return;
        }
        setReactTextareaValue(sendTa, out);
        statusEl.textContent = "→ " + targetLang + " (MyMemory).";
      } catch (e) {
        if (token !== translateToken) {
          return;
        }
        statusEl.textContent = "Translation failed — try again.";
        console.warn("Fiverr Assistant: inbox translate failed", e);
      }
    };

    langSelect.addEventListener("change", () => {
      customWrap.style.display = langSelect.value === "custom" ? "block" : "none";
      if (langSelect.value !== "custom") {
        customInput.value = "";
      }
      const ck = getInboxClientKeyFromPath();
      if (ck) {
        persistInboxClientLang(ck, langSelect, customInput);
      }
      inboxTranslateCachedLang = null;
      runTranslate();
    });

    const scheduleCustomPersist = () => {
      clearTimeout(customPersistTimer);
      customPersistTimer = setTimeout(() => {
        const ck = getInboxClientKeyFromPath();
        if (ck && langSelect.value === "custom") {
          persistInboxClientLang(ck, langSelect, customInput);
        }
        inboxTranslateCachedLang = null;
        runTranslate();
      }, 350);
    };
    customInput.addEventListener("input", scheduleCustomPersist);
    customInput.addEventListener("blur", () => {
      const ck = getInboxClientKeyFromPath();
      if (ck && langSelect.value === "custom") {
        persistInboxClientLang(ck, langSelect, customInput);
      }
    });

    root.addEventListener("far-inbox-client-changed", () => {
      syncLangFromStorage().then(() => runTranslate());
    });

    syncLangFromStorage().then(() => {
      if (englishTa.value.trim()) {
        runTranslate();
      }
    });

    const debounceMs = Math.max(200, parseInt(String(settings.inboxTranslateDebounceMs || "500"), 10) || 500);
    englishTa.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runTranslate, debounceMs);
    });
  };

  const tryEnhanceInboxTranslate = () => {
    if (!coerceBooleanSetting(settings.inboxTranslateEnabled, true)) {
      return;
    }
    const ta = document.getElementById("send-message-text-area");
    if (!ta || !document.body.contains(ta)) {
      return;
    }
    const existingRoot = ta.closest("[data-far-inbox-translate-root]");
    if (existingRoot) {
      const path = window.location.pathname || "";
      if (existingRoot.dataset.farClientPath !== path) {
        existingRoot.dataset.farClientPath = path;
        existingRoot.dispatchEvent(new CustomEvent("far-inbox-client-changed", { bubbles: false }));
      }
      return;
    }
    enhanceSendMessageTextarea(ta);
  };

  const startInboxTranslateComposer = () => {
    if (!shouldContinueExecution()) {
      return;
    }
    ensureFarInboxLocationListeners();
    if (inboxTranslateComposerObserver) {
      return;
    }
    ensureInboxTranslateStyles();
    tryEnhanceInboxTranslate();
    if (typeof window.FarInboxAi !== "undefined" && window.FarInboxAi.startCustomOfferDescriptionHelper) {
      window.FarInboxAi.startCustomOfferDescriptionHelper(() => ({
        profile: settings.profile,
        profileUsername: settings.profileUsername,
        openaiApiKey: settings.openaiApiKey,
        openaiModel: settings.openaiModel,
        inboxMessageListSelector: settings.inboxMessageListSelector,
        inboxMessageRowSelector: settings.inboxMessageRowSelector,
      }));
    }
    inboxTranslateComposerObserver = new MutationObserver(() => {
      if (inboxTranslateEnhanceScheduled) {
        return;
      }
      inboxTranslateEnhanceScheduled = true;
      requestAnimationFrame(() => {
        inboxTranslateEnhanceScheduled = false;
        tryEnhanceInboxTranslate();
      });
    });
    inboxTranslateComposerObserver.observe(document.documentElement, { childList: true, subtree: true });
  };

  let getVal = (id) => {
    return localStorage.getItem(id) || null;
  };

  // Declare playAudio and sendNotification outside initialize so they're accessible to message observer
  let playAudio = async () => {};
  let sendNotification = () => {};
  
  // Function to check if a client name is in the ignored clients list
  const isClientIgnored = (clientName) => {
    if (!clientName || typeof clientName !== 'string') {
      return false;
    }
    
    // Get ignoreClients from multiple sources (global variable, settings, localStorage)
    let ignoreClientsList = ignoreClients || '';
    
    // Fallback to settings if global variable is empty
    if (!ignoreClientsList && typeof settings !== 'undefined' && settings && settings.ignoreClients) {
      ignoreClientsList = settings.ignoreClients;
    }
    
    // Fallback to localStorage if still empty
    if (!ignoreClientsList) {
      try {
        ignoreClientsList = getVal("ignoreClients") || '';
      } catch (e) {
        // Ignore errors
      }
    }
    
    if (!ignoreClientsList || ignoreClientsList.trim() === '') {
      return false;
    }
    
    const ignoredList = ignoreClientsList.split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
    const clientNameLower = clientName.trim().toLowerCase();
    
    const isIgnored = ignoredList.includes(clientNameLower);
    
    // Debug logging only when client is found in ignored list
    if (isIgnored) {
      console.log("Fiverr Assistant: Client is in ignored list", { 
        clientName, 
        clientNameLower, 
        ignoredList
      });
    }
    
    return isIgnored;
  };
  
  // Function to check if a client name is in the targeted clients list
  // This function follows the exact same pattern as isClientIgnored for consistency
  const isClientTargeted = (clientName) => {
    if (!clientName || typeof clientName !== 'string') {
      return false;
    }
    
    // Get targetedClients from multiple sources (global variable, settings, localStorage)
    // Use the exact same pattern as isClientIgnored
    let targetedClientsList = targetedClients || '';
    
    // Fallback to settings if global variable is empty
    if (!targetedClientsList && typeof settings !== 'undefined' && settings && settings.targetedClients) {
      targetedClientsList = settings.targetedClients;
    }
    
    // Fallback to localStorage if still empty
    if (!targetedClientsList) {
      try {
        targetedClientsList = getVal("targetedClients") || '';
      } catch (e) {
        // Ignore errors
      }
    }
    
    // Always log for debugging
    console.log("Fiverr Assistant: Checking if client is targeted", {
      clientName,
      targetedClientsList: targetedClientsList ? targetedClientsList.substring(0, 200) : "empty",
      targetedClientsGlobal: targetedClients ? targetedClients.substring(0, 200) : "empty",
      settingsTargetedClients: (typeof settings !== 'undefined' && settings && settings.targetedClients) ? settings.targetedClients.substring(0, 200) : "not in settings"
    });
    
    if (!targetedClientsList || targetedClientsList.trim() === '') {
      console.log("Fiverr Assistant: No targeted clients list found");
      return false;
    }
    
    const targetedList = targetedClientsList.split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
    const clientNameLower = clientName.trim().toLowerCase();
    
    const isTargeted = targetedList.includes(clientNameLower);
    
    // Always log the result for debugging
    console.log("Fiverr Assistant: Targeted client check result", { 
      clientName, 
      clientNameLower, 
      targetedList,
      isTargeted
    });
    
    return isTargeted;
  };
  
  // Function to extract client name from Fiverr chat HTML
  const extractClientName = (element) => {
    if (!element) return null;
    
    let clientName = null;
    
    try {
      // Strategy 0: SIMPLEST - Check the element's own textContent first (most direct)
      // This handles cases where textContent IS the name (like "Luciano")
      const elementText = element.textContent?.trim();
      if (elementText) {
        // Simple name pattern: 2-50 chars, letters/numbers/underscores/hyphens
        const simpleNamePattern = /^[a-zA-Z0-9_-]{2,50}$/;
        // Common UI words to exclude
        const excludedWords = /^(new|message|unread|read|sent|received|ago|min|hour|day|view|reply|delete|first|second|third|inbox|conversation|chat|the|a|an|and|or|but|is|are|was|were|has|have|had|will|would|could|should|may|might|can|must)$/i;
        
        // If textContent is a simple name, use it immediately
        if (simpleNamePattern.test(elementText)) {
          if (!excludedWords.test(elementText)) {
            clientName = elementText;
            return clientName; // Return early if we found it
          }
        }
        
        // If not a simple name, try to extract first word that looks like a name
        const firstWordMatch = elementText.match(/^([a-zA-Z0-9_-]{2,50})(?:\s|$|,|\.|:)/);
        if (firstWordMatch && firstWordMatch[1]) {
          const potentialName = firstWordMatch[1];
          if (simpleNamePattern.test(potentialName) && !excludedWords.test(potentialName)) {
            clientName = potentialName;
            return clientName; // Return early if we found it
          }
        }
      }
      
      // Strategy 0.1: Check direct text nodes (not including child element text)
      if (!clientName) {
      let directText = '';
      if (element.childNodes) {
        for (const node of element.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            directText += node.textContent || '';
          }
        }
      }
      directText = directText.trim();
      
        if (directText) {
          const simpleNamePattern = /^[a-zA-Z0-9_-]{2,50}$/;
          const excludedWords = /^(new|message|unread|read|sent|received|ago|min|hour|day|view|reply|delete|first|second|third|inbox|conversation|chat|the|a|an|and|or|but)$/i;
          
          if (simpleNamePattern.test(directText) && !excludedWords.test(directText)) {
          clientName = directText;
            return clientName; // Return early if we found it
          }
        }
      }
      
      // Strategy 0.5: Check parent element's text content for name patterns
      if (!clientName && element.parentElement) {
        const parentText = element.parentElement.textContent?.trim();
        if (parentText) {
          // Look for patterns like "Luciano" at the start, or "from Luciano", etc.
          const patterns = [
            /^([a-zA-Z0-9_-]{2,50})(?:\s|$)/,  // Name at start
            /(?:from|by|message from|sent by)\s+([a-zA-Z0-9_-]{2,50})/i,
            /@([a-zA-Z0-9_-]{2,50})/,
            /^([A-Z][a-zA-Z0-9_-]{1,49})(?:\s|$)/  // Capitalized name at start
          ];
          
          for (const pattern of patterns) {
            const match = parentText.match(pattern);
            if (match && match[1]) {
              const potentialName = match[1];
              // Validate it's not a common UI word
              if (!potentialName.match(/^(new|message|unread|read|sent|received|ago|min|hour|day|view|reply|delete|first|second|third|inbox|conversation|chat)$/i)) {
                clientName = potentialName;
                break;
              }
            }
          }
        }
      }
      
      // Strategy 1: Look for username/name in common Fiverr chat selectors
      const commonSelectors = [
        '[class*="username"]',
        '[class*="user-name"]',
        '[class*="name"]',
        '[class*="sender"]',
        '[class*="author"]',
        '[data-testid*="username"]',
        '[data-testid*="name"]',
        'a[href*="/users/"]',
        '[class*="conversation"] [class*="title"]',
        '[class*="chat"] [class*="title"]',
        '[class*="inbox-item"] [class*="title"]'
      ];
      
      // Try to find the conversation/message container first
      const container = element.closest('[class*="message"], [class*="conversation"], [class*="chat"], [class*="inbox-item"], li, a');
      
      if (container) {
        // Try each selector
        for (const selector of commonSelectors) {
          const nameElement = container.querySelector(selector);
          if (nameElement) {
            const text = nameElement.textContent?.trim();
            if (text && text.length > 0 && text.length < 100) {
              // Filter out common non-name text
              if (!text.match(/^(new|message|unread|read|sent|received)$/i)) {
                clientName = text;
                break;
              }
            }
          }
        }
        
        // Strategy 2: Look for links to user profiles
        if (!clientName) {
          const userLink = container.querySelector('a[href*="/users/"]');
          if (userLink) {
            const href = userLink.getAttribute('href');
            if (href) {
              const urlMatch = href.match(/\/users\/([^\/\?]+)/);
              if (urlMatch && urlMatch[1]) {
                clientName = decodeURIComponent(urlMatch[1]);
              } else {
                const linkText = userLink.textContent?.trim();
                if (linkText && linkText.length > 0 && linkText.length < 100) {
                  clientName = linkText;
                }
              }
            }
          }
        }
        
        // Strategy 3: Extract from title or heading elements
        if (!clientName) {
          const titleElement = container.querySelector('h1, h2, h3, h4, [class*="title"], [class*="heading"]');
          if (titleElement) {
            const titleText = titleElement.textContent?.trim();
            if (titleText && titleText.length > 0 && titleText.length < 100) {
              // Remove common prefixes/suffixes
              const cleaned = titleText.replace(/^(new message|message from|from|by)\s*/i, '').trim();
              if (cleaned && cleaned.length > 0) {
                clientName = cleaned;
              }
            }
          }
        }
        
        // Strategy 4: Look for text patterns in the container
        if (!clientName) {
          const containerText = container.textContent || '';
          // Try to match patterns like "from username", "by username", "@username"
          const patterns = [
            /(?:from|by|message from)\s+([a-zA-Z0-9_-]{2,50})/i,
            /@([a-zA-Z0-9_-]{2,50})/,
            /^([a-zA-Z0-9_-]{2,50})\s+(?:sent|wrote|says)/i
          ];
          
          for (const pattern of patterns) {
            const match = containerText.match(pattern);
            if (match && match[1]) {
              clientName = match[1];
              break;
            }
          }
        }
        
        // Strategy 5: Get first meaningful text from the container (excluding common UI elements)
        if (!clientName) {
          const allTextNodes = [];
          const walker = document.createTreeWalker(
            container,
            NodeFilter.SHOW_TEXT,
            {
              acceptNode: (node) => {
                const text = node.textContent?.trim();
                if (text && text.length > 2 && text.length < 50) {
                  // Exclude common UI text
                  if (!text.match(/^(new|message|unread|read|sent|received|ago|min|hour|day|view|reply|delete)$/i)) {
                    return NodeFilter.FILTER_ACCEPT;
                  }
                }
                return NodeFilter.FILTER_REJECT;
              }
            }
          );
          
          let node;
          while ((node = walker.nextNode())) {
            const text = node.textContent?.trim();
            if (text && text.length > 2 && text.length < 50) {
              allTextNodes.push(text);
            }
          }
          
          if (allTextNodes.length > 0) {
            // Use the first meaningful text that looks like a name
            for (const text of allTextNodes) {
              if (text.match(/^[a-zA-Z0-9_-]{2,50}$/)) {
                clientName = text;
                break;
              }
            }
          }
        }
      }
      
      // Strategy 6: Check sibling elements (name might be in a sibling span/div)
      if (!clientName && element.parentElement) {
        const siblings = Array.from(element.parentElement.children || []);
        for (const sibling of siblings) {
          if (sibling === element) continue;
          const siblingText = sibling.textContent?.trim();
          if (siblingText) {
            const namePattern = /^[a-zA-Z0-9_-]{2,50}$/;
            if (namePattern.test(siblingText) && !siblingText.match(/^(new|message|unread|read|sent|received|ago|min|hour|day|view|reply|delete|first|second|third)$/i)) {
              clientName = siblingText;
              break;
            }
          }
        }
      }
      
      // Strategy 7: Fallback - look in parent elements with better pattern matching
      if (!clientName && element.parentElement) {
        const parentText = element.parentElement.textContent || '';
        const patterns = [
          /(?:from|by|message from|sent by)\s+([a-zA-Z0-9_-]{2,50})/i,
          /@([a-zA-Z0-9_-]{2,50})/,
          /^([A-Z][a-zA-Z0-9_-]{1,49})(?:\s|$)/,  // Capitalized name at start
          /^([a-zA-Z0-9_-]{2,50})(?:\s|$)/  // Any name-like text at start
        ];
        
        for (const pattern of patterns) {
          const match = parentText.match(pattern);
          if (match && match[1]) {
            const potentialName = match[1];
            // Validate it's not a common UI word
            if (!potentialName.match(/^(new|message|unread|read|sent|received|ago|min|hour|day|view|reply|delete|first|second|third|inbox|conversation|chat)$/i)) {
              clientName = potentialName;
              break;
            }
          }
        }
      }
      
      // Strategy 8: Last resort - check if element's textContent is a simple name
      // This handles cases where the flag element's textContent IS the name (like "Luciano")
      if (!clientName) {
        const text = element.textContent?.trim();
        if (text) {
          // Extract first word that looks like a name
          const firstWordMatch = text.match(/^([a-zA-Z0-9_-]{2,50})(?:\s|$|,|\.|:)/);
          if (firstWordMatch && firstWordMatch[1]) {
            const potentialName = firstWordMatch[1];
            // Only exclude obvious non-name words
            if (!potentialName.match(/^(new|message|unread|read|sent|received|ago|min|hour|day|view|reply|delete|first|second|third|inbox|conversation|chat|the|a|an|and|or|but)$/i)) {
              clientName = potentialName;
            }
          }
          // If no match but text is simple and looks like a name, use it
          else if (text.match(/^[a-zA-Z0-9_-]{2,50}$/) && !text.match(/^(new|message|unread|read|sent|received|ago|min|hour|day|view|reply|delete|first|second|third|inbox|conversation|chat|the|a|an|and|or|but)$/i)) {
            clientName = text;
          }
        }
      }
      
    } catch (e) {
      console.warn("Fiverr Assistant: Error extracting client name", e);
    }
    
    // Clean up the client name
    if (clientName) {
      clientName = clientName.trim();
      // Remove extra whitespace and limit length
      clientName = clientName.replace(/\s+/g, ' ').substring(0, 50);
      // Return null if it's too short or looks invalid
      if (clientName.length < 2) {
        clientName = null;
      }
    }
    
    return clientName;
  };
  
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
      ignoreClients = message.payload.ignoreClients !== undefined ? String(message.payload.ignoreClients || "") : (getVal("ignoreClients") || "");
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
    // Check if fabs reloader is active - exit if detected
    if (!shouldContinueExecution()) {
      console.log('Fiverr Assistant: Cannot initialize - fabs fiverr reloader assistant is active');
      return Promise.resolve();
    }
    
    if (initializePromise) {
      return initializePromise;
    }

    initializePromise = (async () => {
      // Check again after async operations
      if (!shouldContinueExecution()) {
        console.log('Fiverr Assistant: Cannot initialize - fabs fiverr reloader assistant detected during initialization');
        return;
      }
      
      await hydrateSettings();

      if (
        (siteDomain === "www.fiverr.com" || siteDomain === "fiverr.com") &&
        shouldContinueExecution()
      ) {
        startInboxTranslateComposer();
      }

      // Check for pending auto-reactivation after page reload
      if (extensionStorage && !autoReload) {
        try {
          const result = await extensionStorage.get(AUTO_REACTIVATE_TIMESTAMP_KEY);
          if (result && result[AUTO_REACTIVATE_TIMESTAMP_KEY]) {
            const reactivateTimestamp = result[AUTO_REACTIVATE_TIMESTAMP_KEY];
            const now = Date.now();
            const remainingTime = reactivateTimestamp - now;
            
            if (remainingTime > 0) {
              // There's a pending reactivation, set up the timeout
              console.log(`Fiverr Assistant: Found pending auto-reactivation, will reactivate in ${Math.ceil(remainingTime / 1000)} seconds`);
              autoReactivateTimeoutId = setTimeout(() => {
                autoReactivateTimeoutId = null;
                if (!isF10Clicked && featuresInitialized) {
                  enableAutoReload();
                  console.log("Fiverr Assistant: Auto-reload auto-reactivated after 1 minute");
                }
                // Remove the timestamp from storage
                if (extensionStorage) {
                  extensionStorage.remove(AUTO_REACTIVATE_TIMESTAMP_KEY).catch(() => {});
                }
              }, remainingTime);
            } else {
              // The timeout has already passed, reactivate immediately
              console.log("Fiverr Assistant: Auto-reactivation timeout has passed, reactivating now");
              if (featuresInitialized) {
                enableAutoReload();
              } else {
                // If features aren't initialized yet, just set autoReload to true
                // It will be properly initialized when features are ready
                autoReload = true;
                if (extensionStorage) {
                  extensionStorage.set({ autoReloadEnabled: true }).then(() => {
                    return extensionStorage.remove(AUTO_REACTIVATE_TIMESTAMP_KEY);
                  }).catch(() => {});
                }
              }
            }
          }
        } catch (error) {
          console.warn("Fiverr Assistant: Failed to check for pending auto-reactivation", error);
        }
      }

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
      const foundFlag = document.querySelector(newClientFlagSelector);
      // Validate to ensure it's actually a new client (clock icon), not Pro Client badge
      var isNewClient = foundFlag && isValidNewClientFlag(foundFlag) ? true : false;

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
        // Don't create or show status display if fabs reloader is active
        if (!shouldContinueExecution()) {
          return null;
        }
        
        if (statusDisplayElement && document.body.contains(statusDisplayElement)) {
          return statusDisplayElement;
        }

        statusDisplayElement = document.createElement("div");
        statusDisplayElement.id = "farReloadStatus";
        applyStyles(statusDisplayElement, statusContainerCss);
        document.body.appendChild(statusDisplayElement);

        if (!statusUpdateIntervalId) {
          statusUpdateIntervalId = setInterval(() => {
            // Don't update if fabs reloader is active
            if (!shouldContinueExecution()) {
              return;
            }
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
        // Don't update status display if fabs reloader is active
        if (!shouldContinueExecution()) {
          removeStatusDisplay();
          return;
        }
        
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
        // If container is null (fabs detected), don't proceed
        if (!container) {
          return;
        }
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
        // Clear any existing auto-reactivation timeout
        if (autoReactivateTimeoutId) {
          clearTimeout(autoReactivateTimeoutId);
          autoReactivateTimeoutId = null;
        }
        // Save the stopped state to chrome.storage.local so it persists after page reload
        if (extensionStorage) {
          const reactivateTimestamp = Date.now() + AUTO_REACTIVATE_DELAY_MS;
          extensionStorage.set({ 
            autoReloadEnabled: false,
            [AUTO_REACTIVATE_TIMESTAMP_KEY]: reactivateTimestamp
          }).catch((error) => {
            console.warn("Fiverr Assistant: Failed to save auto-reload stopped state", error);
          });
          
          // Set timeout to auto-reactivate after 1 minute
          autoReactivateTimeoutId = setTimeout(() => {
            autoReactivateTimeoutId = null;
            if (!isF10Clicked && featuresInitialized) {
              enableAutoReload();
              console.log("Fiverr Assistant: Auto-reload auto-reactivated after 1 minute");
            }
            // Remove the timestamp from storage
            if (extensionStorage) {
              extensionStorage.remove(AUTO_REACTIVATE_TIMESTAMP_KEY).catch(() => {});
            }
          }, AUTO_REACTIVATE_DELAY_MS);
          
          console.log("Fiverr Assistant: Auto-reload paused, will auto-reactivate in 1 minute");
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
        // Check if fabs reloader is active - exit if detected
        if (!shouldContinueExecution()) {
          console.log('Fiverr Assistant: Cannot enable auto-reload - fabs fiverr reloader assistant is active');
          return;
        }
        
        autoReload = true;
        isF10Clicked = false;
        startMonitoringTracking();
        ensureMessageCheckInterval();
        scheduleNextReload();
        updateStatusDisplay();
        startOfflineErrorChecking();
        // Clear auto-reactivation timeout if manually enabled before timeout
        if (autoReactivateTimeoutId) {
          clearTimeout(autoReactivateTimeoutId);
          autoReactivateTimeoutId = null;
        }
        // Save the enabled state to chrome.storage.local so it persists after page reload
        if (extensionStorage) {
          extensionStorage.set({ 
            autoReloadEnabled: true
          }).then(() => {
            // Remove reactivation timestamp if it exists
            return extensionStorage.remove(AUTO_REACTIVATE_TIMESTAMP_KEY);
          }).catch((error) => {
            console.warn("Fiverr Assistant: Failed to save auto-reload enabled state", error);
          });
        }
      };

      // Helper function to check if any tabs in the current window are loading
      const checkForLoadingTabs = () => {
        return new Promise((resolve) => {
          if (!runtime || !runtime.sendMessage) {
            resolve(false);
            return;
          }

          try {
            if (hasBrowserAPI && typeof runtime.sendMessage === "function" && runtime.sendMessage.length <= 2) {
              // Firefox API - Promise-based
              runtime.sendMessage({ type: "checkLoadingTabs" })
                .then((response) => {
                  if (response && typeof response.hasLoadingTabs === "boolean") {
                    resolve(response.hasLoadingTabs);
                  } else {
                    resolve(false);
                  }
                })
                .catch((error) => {
                  console.warn("Fiverr Assistant: Error checking for loading tabs", error);
                  resolve(false);
                });
            } else {
              // Chrome API - Callback-based
              runtime.sendMessage({ type: "checkLoadingTabs" }, (response) => {
                if (chrome.runtime && chrome.runtime.lastError) {
                  console.warn("Fiverr Assistant: Error checking for loading tabs", chrome.runtime.lastError);
                  resolve(false);
                  return;
                }
                if (response && typeof response.hasLoadingTabs === "boolean") {
                  resolve(response.hasLoadingTabs);
                } else {
                  resolve(false);
                }
              });
            }
          } catch (error) {
            console.warn("Fiverr Assistant: Error checking for loading tabs", error);
            resolve(false);
          }
        });
      };

      scheduleNextReload = () => {
        // Check if fabs reloader is active - exit if detected
        if (!shouldContinueExecution()) {
          console.log('Fiverr Assistant: Cannot schedule reload - fabs fiverr reloader assistant is active');
          return;
        }
        
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

          // Check if any other tabs in the current window are loading
          checkForLoadingTabs().then((hasLoadingTabs) => {
            if (hasLoadingTabs) {
              console.log("Fiverr Assistant: Other tabs are loading, rescheduling reload instead of reloading now");
              scheduleNextReload();
              return;
            }

            // No tabs are loading, proceed with reload
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
          }).catch((error) => {
            console.warn("Fiverr Assistant: Error checking for loading tabs, proceeding with reload", error);
            // If check fails, proceed with reload to avoid blocking
            const randomInt = Math.floor(Math.random() * pageLinks.length);
            const fallbackLink = "/users/" + (getVal("profileUsername") || "") + "/seller_dashboard";
            const goToLink = pageLinks[randomInt] || fallbackLink;
            const newLink = new URL("https://www.fiverr.com" + goToLink).toString();

            checkAndResetDailyCount();
            reloadCount += 1;
            nextReloadTimestamp = null;
            persistReloadState();
            updateStatusDisplay();
            markPrimaryNavigation();
            window.location.href = newLink;
          });
        }, delay);
      };

      updateStatusDisplay();


      playAudio = async (type) => {
        const settingKey = SOUND_TYPE_TO_SETTING_KEY[type] || SOUND_TYPE_TO_SETTING_KEY.default;
        const configuredUrl = getVal(settingKey) || settings[settingKey] || defaultSettings[settingKey] || "";
        const normalizedUrl = normalizeUrl(configuredUrl);
        
        console.log("Fiverr Assistant: playAudio called", {
          type,
          settingKey,
          configuredUrl: configuredUrl ? configuredUrl.substring(0, 100) : "empty",
          normalizedUrl: normalizedUrl ? normalizedUrl.substring(0, 100) : "empty",
          fromLocalStorage: getVal(settingKey) || "not found",
          fromSettings: settings[settingKey] || "not found",
          fromDefaults: defaultSettings[settingKey] || "not found"
        });
        
        // If targeted sound is requested but URL is empty, warn but still try to play
        if (type === "targeted" && !normalizedUrl) {
          console.warn("Fiverr Assistant: WARNING - Targeted client sound URL is not configured! Please set it in the Sounds tab.");
        }

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
        // Don't process clicks if fabs reloader is active
        if (!shouldContinueExecution()) {
          return;
        }
        
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
        // Don't process keyboard events if fabs reloader is active
        if (!shouldContinueExecution()) {
          return;
        }
        
        lastAction = Date.now();
        // Stop any playing notification sounds when user presses any key
        stopAllNotificationSounds();

        if (event.code === "F8") {
          pauseAutoReload();
          // Check again before showing alert
          if (shouldContinueExecution()) {
            alert("Fiverr Auto Reloader Disabled For 15 Minutes");
          }
          setTimeout(() => {
            if (!isF10Clicked && shouldContinueExecution()) {
              enableAutoReload();
            }
          }, 900000);
        }

        if (event.code === "F10") {
          // Check again before showing alert
          if (shouldContinueExecution()) {
            alert("Fiverr Auto Reloader Turned Off");
          }
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

      sendNotification = (message, clientName = null) => {
        // Don't send notifications if fabs reloader is active
        if (!shouldContinueExecution()) {
          return;
        }
        
        if ("Notification" in window) {
          Notification.requestPermission().then(function (permission) {
            // Check again after async permission request
            if (!shouldContinueExecution()) {
              return;
            }
            
            if (permission === "granted") {
              // Include client name in notification if available
              let notificationTitle = message;
              let notificationBody = "";
              
              if (clientName) {
                notificationTitle = message;
                notificationBody = `From: ${clientName}`;
              } else {
                notificationBody = message;
              }
              
              var options = {
                body: notificationBody,
                icon: "https://fiverr-res.cloudinary.com/npm-assets/layout-service/favicon-32x32.8f21439.png",
                tag: "fiverr-notification",
              };
              new Notification(notificationTitle, options);
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
          const foundFlag = document.querySelector(newClientFlagSelector);
          // Validate to ensure it's actually a new client (clock icon), not Pro Client badge
          let newClientFlag = foundFlag && isValidNewClientFlag(foundFlag) ? foundFlag : null;
          if (newClientFlag) {
            // Try to extract client name using comprehensive extraction function
            let clientName = extractClientName(newClientFlag);
            
            // Check if client is in ignored list - skip audio and notification if ignored
            const isIgnored = clientName ? isClientIgnored(clientName) : false;
            
            if (!isIgnored) {
            // Show alert for new client message (respect sound & notification settings)
            if (coerceBooleanSetting(settings.enable_new_client_sound, true)) {
              playAudio("new");
              phoneCall();
            }
            if (coerceBooleanSetting(settings.enable_new_client_notification, true)) {
              sendNotification("New client Message", clientName);
            }
            // Pause auto-reload for 5 minutes when notification plays
            pauseAutoReloadForNotification();
            // Activate the tab when new client message is detected
            activateFiverrTab();
            } else {
              console.log("Fiverr Assistant: Client is in ignored list, skipping audio, notification, and tab activation", { clientName });
            }
          } else {
            // Try to extract client name for old client messages
            // First try extracting from the unread icon element
            let clientName = extractClientName(hasMessage);
            
            // If that fails, try to find the conversation list item and extract from there
            if (!clientName && hasMessage) {
              // Find the conversation container - try multiple selectors
              let conversationItem = hasMessage.closest('[class*="contact"]');
              if (!conversationItem) {
                conversationItem = hasMessage.closest('li');
              }
              if (!conversationItem) {
                conversationItem = hasMessage.closest('[class*="conversation"]');
              }
              if (!conversationItem) {
                conversationItem = hasMessage.closest('[class*="inbox-item"]');
              }
              if (!conversationItem) {
                conversationItem = hasMessage.closest('[class*="message-item"]');
              }
              if (!conversationItem) {
                conversationItem = hasMessage.closest('a[href*="/inbox/"]');
              }
              if (!conversationItem) {
                // Try parent elements up to 5 levels
                let parent = hasMessage.parentElement;
                for (let i = 0; i < 5 && parent; i++) {
                  if (parent.classList?.toString().includes('contact') ||
                      parent.tagName === 'LI' || 
                      parent.classList?.toString().includes('conversation') ||
                      parent.classList?.toString().includes('inbox') ||
                      parent.querySelector?.('a[href*="/inbox/"]')) {
                    conversationItem = parent;
                    break;
                  }
                  parent = parent.parentElement;
                }
              }
              
              if (conversationItem) {
                console.log("Fiverr Assistant: Found conversation item for extraction", {
                  tagName: conversationItem.tagName,
                  className: conversationItem.className
                });
                
                // Strategy 1: Use the specific selector provided by user: .first > div:nth-child(2) > div:nth-child(1) > p:nth-child(1)
                // First, find the .first element (contact item)
                const usernameParagraph = document.querySelector('.first > div:nth-child(2) > div:nth-child(1) > p:nth-child(1)')
                if (usernameParagraph) {
                  const text = usernameParagraph.textContent?.trim();
                    if (text && text.match(/^[a-zA-Z0-9_-]{2,50}$/)) {
                      clientName = text;
                      console.log("Fiverr Assistant: Extracted client name using specific selector", { clientName });
                    }
                }
                
                // Strategy 2: Look for user-info div and extract from the <p> tag inside it
                if (!clientName) {
                  const userInfoDiv = conversationItem.querySelector('[class*="user-info"]');
                  if (userInfoDiv) {
                    // Look for <p> tag that contains the username (usually the first <p> in user-info)
                    const usernameP = userInfoDiv.querySelector('p');
                    if (usernameP) {
                      const text = usernameP.textContent?.trim();
                      if (text && text.match(/^[a-zA-Z0-9_-]{2,50}$/)) {
                        clientName = text;
                        console.log("Fiverr Assistant: Extracted client name from user-info <p> tag", { clientName });
                      }
                    }
                  }
                }
                
                // Strategy 3: Look for title attribute on avatar/figure element
                if (!clientName) {
                  const figure = conversationItem.querySelector('figure[title]');
                  if (figure) {
                    const title = figure.getAttribute('title');
                    if (title && title.match(/^[a-zA-Z0-9_-]{2,50}$/)) {
                      clientName = title;
                      console.log("Fiverr Assistant: Extracted client name from figure title attribute", { clientName });
                    }
                  }
                }
                
                // Strategy 4: Try extracting from the conversation item using the general extractClientName function
                if (!clientName) {
                  clientName = extractClientName(conversationItem);
                  if (clientName) {
                    console.log("Fiverr Assistant: Extracted client name using extractClientName function", { clientName });
                  }
                }
                
                // Strategy 5: Try to find a link to the user profile or conversation
                if (!clientName) {
                  const userLink = conversationItem.querySelector('a[href*="/users/"], a[href*="/inbox/"]');
                  if (userLink) {
                    const href = userLink.getAttribute('href');
                    if (href) {
                      // Extract username from URL like /inbox/username or /users/username
                      const urlMatch = href.match(/\/(?:inbox|users)\/([^\/\?]+)/);
                      if (urlMatch && urlMatch[1]) {
                        clientName = decodeURIComponent(urlMatch[1]);
                        console.log("Fiverr Assistant: Extracted client name from URL", { clientName, href });
                      } else {
                        // Try text content of the link
                        const linkText = userLink.textContent?.trim();
                        if (linkText && linkText.length > 2 && linkText.length < 50) {
                          // Check if it looks like a username
                          if (linkText.match(/^[a-zA-Z0-9_-]{2,50}$/)) {
                            clientName = linkText;
                            console.log("Fiverr Assistant: Extracted client name from link text", { clientName });
                          }
                        }
                      }
                    }
                  }
                }
                
                // Strategy 6: Get all text nodes and find one that looks like a username
                if (!clientName) {
                  // Get all text nodes and find one that looks like a username
                  const walker = document.createTreeWalker(
                    conversationItem,
                    NodeFilter.SHOW_TEXT,
                    null
                  );
                  
                  const textNodes = [];
                  let node;
                  while ((node = walker.nextNode())) {
                    const text = node.textContent?.trim();
                    if (text && text.match(/^[a-zA-Z0-9_-]{3,30}$/)) {
                      // Exclude common UI words and numbers
                      if (!text.match(/^(new|message|unread|read|sent|received|ago|min|hour|day|view|reply|delete|inbox|conversation|chat|fiverr|online|offline|me|okay|gute|nacht)$/i) &&
                          !text.match(/^\d+$/)) {
                        textNodes.push(text);
                      }
                    }
                  }
                  
                  if (textNodes.length > 0) {
                    // Use the first one that looks like a username
                    clientName = textNodes[0];
                    console.log("Fiverr Assistant: Extracted client name from text nodes", { clientName, textNodes });
                  }
                }
              } else {
                console.log("Fiverr Assistant: Could not find conversation item for extraction");
              }
            }
            
            console.log("Fiverr Assistant: Extracted client name for old client message (inbox page)", {
              clientName,
              hasMessageElement: !!hasMessage,
              conversationItemFound: hasMessage ? !!hasMessage.closest('li, [class*="conversation"], [class*="inbox-item"]') : false
            });
            
            // Check if client is in ignored list - skip audio and notification if ignored
            const isIgnored = clientName ? isClientIgnored(clientName) : false;
            
            if (!isIgnored) {
            // Check if client is targeted and play appropriate sound
            const isTargeted = clientName ? isClientTargeted(clientName) : false;
            
            console.log("Fiverr Assistant: Sound decision for old client message (inbox page)", {
              clientName,
              isTargeted,
              isIgnored,
              enableOldClientSound: coerceBooleanSetting(settings.enable_old_client_sound, true)
            });
            
            if (coerceBooleanSetting(settings.enable_old_client_sound, true)) {
              if (isTargeted) {
                const targetedSoundUrl = getVal("targeted_client_sound") || settings.targeted_client_sound || defaultSettings.targeted_client_sound || "";
                console.log("Fiverr Assistant: Playing targeted client sound for (inbox page)", {
                  clientName,
                  isTargeted: true,
                  targetedSoundUrl: targetedSoundUrl ? targetedSoundUrl.substring(0, 100) : "NOT CONFIGURED - will use default"
                });
                // Always play targeted sound, even if URL is not configured (will use default)
                playAudio("targeted");
              } else {
                console.log("Fiverr Assistant: Playing old client sound for non-targeted client (inbox page)", {
                  clientName,
                  isTargeted: false
                });
                playAudio("old");
                phoneCall();
              }
            }
            if (coerceBooleanSetting(settings.enable_old_client_notification, true)) {
              sendNotification("Old client Message", clientName);
              }
            } else {
              console.log("Fiverr Assistant: Client is in ignored list, skipping audio and notification", { clientName });
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


