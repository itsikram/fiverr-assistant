(function () {
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

  let siteDomain = window.location.hostname;
  let inboxUrl = "https://www.fiverr.com/inbox";
  let autoReload = true;
  var audioElement = false;
  var lastAction = Date.now();
  var isF10Clicked = false;
  var mailData = JSON.parse(localStorage.getItem("mailData")) || [];

  const RELOAD_COUNT_KEY = "farReloadCount";
  const NEXT_RELOAD_TIMESTAMP_KEY = "farNextReloadTimestamp";
  const MIN_SECONDS_BETWEEN_ACTION_AND_RELOAD = 60;
  let reloadCount = parseInt(localStorage.getItem(RELOAD_COUNT_KEY), 10) || 0;
  let nextReloadTimestamp = null;
  let nextReloadTimeoutId = null;
  let statusUpdateIntervalId = null;
  let statusDisplayElement = null;

  let updateStatusDisplay = () => {};
  let clearScheduledReload = (shouldUpdate = true) => {
    if (nextReloadTimeoutId) {
      clearTimeout(nextReloadTimeoutId);
      nextReloadTimeoutId = null;
    }
    nextReloadTimestamp = null;
    if (shouldUpdate) {
      updateStatusDisplay();
    }
  };
  let scheduleNextReload = () => {};
  let pauseAutoReload = () => {
    autoReload = false;
    clearScheduledReload();
  };
  let enableAutoReload = () => {
    autoReload = true;
    isF10Clicked = false;
    scheduleNextReload();
    updateStatusDisplay();
  };

  const PRIMARY_TAB_KEY = "farPrimaryTab";
  const PRIMARY_TAB_HEARTBEAT_INTERVAL = 5000;
  const PRIMARY_TAB_STALE_THRESHOLD = PRIMARY_TAB_HEARTBEAT_INTERVAL * 3;
  const tabIdentifier = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
    const record = readPrimaryTabRecord();
    if (record && record.id === tabIdentifier) {
      localStorage.removeItem(PRIMARY_TAB_KEY);
    }
  };

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
          window.location.href = "https://www.fiverr.com/";
        } else {
          const redirectWhenOnline = () => {
            window.removeEventListener("online", redirectWhenOnline);
            try {
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

  // Offline detection
  let isOnline = navigator.onLine;
  window.addEventListener("online", () => {
    isOnline = true;
    if (autoReload) {
      scheduleNextReload();
    }
    updateStatusDisplay();
  });
  window.addEventListener("offline", () => {
    isOnline = false;
    clearScheduledReload();
    updateStatusDisplay();
  });

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
  };

  const settings = { ...defaultSettings };
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
  };

  const hydrateSettings = async () => {
    let stored = {};
    if (extensionStorage) {
      try {
        stored = await extensionStorage.get(Object.keys(defaultSettings));
      } catch (error) {
        console.error("Failed to load settings from storage", error);
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

    targetedClients = settings.targetedClients || "";
    pageLinks = processPageLinks(settings.pageLinks);
    minReloadingSecond = parseInt(settings.relStart, 10) || 30;
    maxReloadingSecond = parseInt(settings.relEnd, 10) || 180;
  };

  let getVal = (id) => {
    return localStorage.getItem(id) || null;
  };

  if (runtime && runtime.onMessage) {
    runtime.onMessage.addListener((message) => {
      if (!message || message.type !== "settingsUpdated" || !message.payload) {
        return;
      }

      Object.entries(message.payload).forEach(([key, value]) => {
        if (value === undefined || value === null) {
          value = "";
        }
        updateSetting(key, value);
      });

      targetedClients = getVal("targetedClients") || "";
      pageLinks = processPageLinks(getVal("pageLinks"));
      minReloadingSecond = parseInt(getVal("relStart"), 10) || minReloadingSecond;
      maxReloadingSecond = parseInt(getVal("relEnd"), 10) || maxReloadingSecond;

      if (autoReload) {
        scheduleNextReload();
      } else {
        updateStatusDisplay();
      }
    });
  }

  const initialize = async () => {
    await hydrateSettings();

    try {
      var isNewClient = document.querySelector(".first > div:nth-child(2) > div:nth-child(1) > span:nth-child(2)") ? true : false;

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
        const elements = document.querySelectorAll(".message-flow .content");

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
        right: "20px",
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
            updateStatusDisplay();
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

        if (siteDomain !== "www.fiverr.com") {
          if (statusDisplayElement && statusDisplayElement.parentElement) {
            statusDisplayElement.remove();
          }
          statusDisplayElement = null;
          return;
        }

        const container = ensureStatusDisplayElement();
        const nextReloadLabel = deriveNextReloadLabel();

        container.innerHTML = `<div><strong>Total reloads:</strong> ${reloadCount}</div><div><strong>Next reload:</strong> ${nextReloadLabel}</div>`;
      };

      pauseAutoReload = () => {
        autoReload = false;
        clearScheduledReload();
        updateStatusDisplay();
      };

      enableAutoReload = () => {
        autoReload = true;
        isF10Clicked = false;
        scheduleNextReload();
        updateStatusDisplay();
      };

      scheduleNextReload = () => {
        clearScheduledReload(false);

        if (!autoReload || !isOnline) {
          updateStatusDisplay();
          return;
        }

        if (siteDomain !== "www.fiverr.com") {
          updateStatusDisplay();
          return;
        }

        if (!Array.isArray(pageLinks) || pageLinks.length === 0) {
          updateStatusDisplay();
          return;
        }

        const delay = getRandomMiliSecond(minReloadingSecond, maxReloadingSecond);
        nextReloadTimestamp = Date.now() + delay;
        updateStatusDisplay();

        nextReloadTimeoutId = setTimeout(() => {
          nextReloadTimeoutId = null;

          if (!autoReload || !isOnline) {
            scheduleNextReload();
            return;
          }

          if (siteDomain !== "www.fiverr.com") {
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

          reloadCount += 1;
          localStorage.setItem(RELOAD_COUNT_KEY, String(reloadCount));
          updateStatusDisplay();
          window.location.href = newLink;
        }, delay);
      };

      updateStatusDisplay();


      const playAudio = (type) => {
        let audio;

        switch (type) {
          case "old":
            audio = new Audio(getVal("old_client_sound"));
            break;
          case "targated":
            audio = new Audio(getVal("targeted_client_sound"));
            break;
          case "new":
            audio = new Audio(getVal("new_client_sound"));
            break;
          default:
            audio = new Audio(getVal("new_client_sound"));
            break;
        }

        return audio.play().catch((error) => console.warn("Audio playback blocked:", error));
      };

      document.body.addEventListener("click", () => {
        lastAction = Date.now();
        if (autoReload) {
          scheduleNextReload();
        } else {
          updateStatusDisplay();
        }
      });

      window.addEventListener("keydown", (event) => {
        lastAction = Date.now();

        if (event.code === "F8") {
          pauseAutoReload();
          alert("Fiverr Auto Reloader Disabled For 30 Muntes");
          setTimeout(() => {
            if (!isF10Clicked) {
              enableAutoReload();
            }
          }, 1800000);
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

      const sendNotification = (message) => {
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
        let hasMessage = document.querySelector(".messages-wrapper .unread-icon");

        if (hasMessage) {
          let newClientFlag = document.querySelector(".first > div:nth-child(2) > div:nth-child(1) > span:nth-child(2)");
          if (newClientFlag) {
            playAudio("new");
            sendNotification("New client Message");
            pauseAutoReload();
          } else {
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
        let hasMessage = document.querySelector(".messages-wrapper .unread-icon");
        if (hasMessage && isOnline) {
          if (window.location.href !== inboxUrl) {
            window.location.href = inboxUrl;
          }
        }

        scheduleNextReload();
      }
    } catch (error) {
      console.log(error);
      setTimeout(() => {
        if (isOnline) {
          window.location.reload();
        }
      }, 3000);
    }
  };

  initialize();
})();

