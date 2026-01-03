(() => {
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
    autoReloadEnabled: true,
    statsUpdateInterval: "1",
    selectorUnreadIcon: ".messages-wrapper .unread-icon",
    selectorNewClientFlag: ".first > div:nth-child(2) > div:nth-child(1) > span:nth-child(2)",
    selectorMessageContent: ".message-flow .content",
  };
  const PRIMARY_TAB_ID_STORAGE_KEY = "farPrimaryTabId";
  const CONNECTION_TIME_KEY = "farConnectionTime";
  const MONITORING_TIME_KEY = "farMonitoringTime";
  const CONNECTION_DATE_KEY = "farConnectionDate";
  const MONITORING_DATE_KEY = "farMonitoringDate";
  const DAILY_STATS_PREFIX = "farDailyStats_";
  
  const getTodayDateString = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const hasBrowserAPI = typeof browser !== "undefined";
  const storage = hasBrowserAPI && browser.storage && browser.storage.local ? browser.storage.local : null;
  const tabs = hasBrowserAPI && browser.tabs ? browser.tabs : null;

  if (!storage) {
    console.error("browser.storage.local is not available in this context.");
    return;
  }

  const form = document.getElementById("settings-form");
  const status = document.getElementById("status");
  const activatePrimaryButton = document.getElementById("activatePrimaryTab");
  const primaryTabInfo = document.getElementById("primaryTabInfo");
  let currentPrimaryTabId = null;
  let isAutoReloadActive = false;

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

  const populateForm = (values) => {
    Object.entries(values).forEach(([key, value]) => {
      const field = form.elements.namedItem(key);
      if (!field) return;

      if (field.type === "checkbox") {
        field.checked = coerceBoolean(value, Boolean(defaultSettings[key]));
      } else {
        field.value = value || "";
      }
    });
  };

  const getFormValues = () => {
    const formData = new FormData(form);
    const values = {};
    formData.forEach((value, key) => {
      values[key] = typeof value === "string" ? value.trim() : value;
    });

    Array.from(form.elements).forEach((element) => {
      if (!(element instanceof HTMLInputElement)) return;
      if (!element.name) return;
      if (element.type === "checkbox") {
        values[element.name] = element.checked;
      }
    });

    if (values.relStart && parseInt(values.relStart, 10) < 1) {
      values.relStart = "1";
    }
    if (values.relEnd && parseInt(values.relEnd, 10) < 1) {
      values.relEnd = "1";
    }
    return values;
  };

  const sendSettingsToTabs = async (payload) => {
    if (!tabs) return;

    try {
      const fiverrTabs = await tabs.query({
        url: ["https://www.fiverr.com/*", "https://fiverr.com/*"],
      });

      await Promise.all(
        fiverrTabs.map((tab) =>
          tabs
            .sendMessage(tab.id, {
              type: "settingsUpdated",
              payload,
            })
            .catch(() => {
              // Content script might not be loaded yet; silently ignore.
            })
        )
      );
    } catch (error) {
      console.warn("Failed to broadcast settings to active Fiverr tabs:", error);
    }
  };

  const updatePrimaryTabInfo = () => {
    if (!primaryTabInfo) return;

    if (isAutoReloadActive && typeof currentPrimaryTabId === "number") {
      primaryTabInfo.textContent = `Auto reload active on tab ID ${currentPrimaryTabId}.`;
    } else {
      primaryTabInfo.textContent = "Auto reload inactive.";
    }
  };

  const setActivationState = (active, tabId) => {
    isAutoReloadActive = Boolean(active);
    if (typeof tabId === "number" && !Number.isNaN(tabId)) {
      currentPrimaryTabId = tabId;
    } else {
      currentPrimaryTabId = null;
    }
    if (activatePrimaryButton) {
      activatePrimaryButton.textContent = isAutoReloadActive
        ? "Deactivate Auto Reload"
        : "Activate Current Tab";
      activatePrimaryButton.classList.toggle("danger", isAutoReloadActive);
    }
    updatePrimaryTabInfo();
  };

  const queryActiveTab = async () => {
    if (!tabs) return [];

    try {
      const activeTabs = await tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      return Array.isArray(activeTabs) ? activeTabs : [];
    } catch (error) {
      console.warn("Unable to query active tab:", error);
      return [];
    }
  };

  const broadcastPrimaryTabStatus = async (primaryTabId) => {
    if (!tabs) return;

    try {
      const fiverrTabs = await tabs.query({
        url: ["https://www.fiverr.com/*", "https://fiverr.com/*"],
      });

      await Promise.all(
        fiverrTabs.map((tab) =>
          tabs
            .sendMessage(tab.id, {
              type: "primaryTabStatus",
              primaryTabId,
              isPrimary: typeof primaryTabId === "number" && tab.id === primaryTabId,
            })
            .catch(() => {})
        )
      );
    } catch (error) {
      console.warn("Failed to broadcast primary tab designation:", error);
    }
  };

  const showStatus = (message, timeout = 2000) => {
    status.textContent = message;
    if (timeout > 0) {
      setTimeout(() => {
        status.textContent = "";
      }, timeout);
    }
  };

  const init = async () => {
    try {
      const stored = await storage.get({
        ...defaultSettings,
        [PRIMARY_TAB_ID_STORAGE_KEY]: null,
      });
      const merged = { ...defaultSettings, ...stored };
      populateForm(merged);

      let storedPrimaryId = stored[PRIMARY_TAB_ID_STORAGE_KEY];
      if (typeof storedPrimaryId === "string" && storedPrimaryId.trim() !== "") {
        const parsed = parseInt(storedPrimaryId, 10);
        storedPrimaryId = Number.isNaN(parsed) ? null : parsed;
      }
      if (typeof storedPrimaryId !== "number" || Number.isNaN(storedPrimaryId)) {
        storedPrimaryId = null;
      }

      const storedAutoReload = coerceBoolean(stored.autoReloadEnabled, defaultSettings.autoReloadEnabled);
      const shouldActivate = storedAutoReload && storedPrimaryId !== null;
      setActivationState(shouldActivate, shouldActivate ? storedPrimaryId : null);
    } catch (error) {
      console.error("Failed to load stored settings:", error);
      showStatus("Unable to load settings.", 0);
      setActivationState(false, null);
    }
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = getFormValues();

    try {
      await storage.set(values);
      await sendSettingsToTabs(values);
      showStatus("Settings saved!");
    } catch (error) {
      console.error("Failed to save settings:", error);
      showStatus("Error saving settings. Check the console for details.", 0);
    }
  });

  const soundConfigs = [
    {
      field: "new_client_sound",
      defaultValue: defaultSettings.new_client_sound,
      fileInputId: "new_client_sound_file",
    },
    {
      field: "targeted_client_sound",
      defaultValue: defaultSettings.targeted_client_sound,
      fileInputId: "targeted_client_sound_file",
    },
    {
      field: "old_client_sound",
      defaultValue: defaultSettings.old_client_sound,
      fileInputId: "old_client_sound_file",
    },
  ];

  let currentAudio = null;

  const stopCurrentAudio = () => {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
  };

  const attachSoundControls = () => {
    soundConfigs.forEach(({ field, defaultValue, fileInputId }) => {
      const urlInput = document.getElementById(field);
      const playButton = document.querySelector(
        `.sound-play[data-sound-field="${field}"]`
      );
      const fileInput = document.getElementById(fileInputId);

      if (!urlInput) {
        console.warn(`URL input not found for field: ${field}`);
        return;
      }
      if (!playButton) {
        console.warn(`Play button not found for field: ${field}`);
        return;
      }
      if (!fileInput) {
        console.warn(`File input not found for field: ${field}, id: ${fileInputId}`);
        return;
      }

      playButton.addEventListener("click", async () => {
        const source = urlInput.value.trim() || defaultValue;
        if (!source) {
          showStatus("No audio source available.");
          return;
        }

        stopCurrentAudio();
        const audio = new Audio(source);
        currentAudio = audio;
        audio.addEventListener("ended", () => {
          if (currentAudio === audio) {
            currentAudio = null;
          }
        });

        try {
          await audio.play();
        } catch (error) {
          console.warn(`Unable to play sound for ${field}:`, error);
          showStatus("Unable to play sound. Check the URL or uploaded file.", 3000);
        }
      });

      fileInput.addEventListener("change", (event) => {
        const [file] = fileInput.files;
        if (!file) {
          console.log(`No file selected for ${field}`);
          return;
        }

        console.log(`File selected for ${field}:`, {
          name: file.name,
          type: file.type,
          size: file.size
        });

        if (!file.type.startsWith("audio/")) {
          showStatus(`Please select a valid audio file. Selected file type: ${file.type || "unknown"}`, 3000);
          fileInput.value = "";
          return;
        }

        // Check file size (limit to 10MB)
        const maxSize = 10 * 1024 * 1024; // 10MB
        if (file.size > maxSize) {
          showStatus(`File is too large. Maximum size is 10MB. Selected file: ${(file.size / 1024 / 1024).toFixed(2)}MB`, 3000);
          fileInput.value = "";
          return;
        }

        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result;
          if (typeof result === "string") {
            // Update the URL input field with the data URL
            urlInput.value = result;
            // Trigger input event to ensure any listeners are notified
            urlInput.dispatchEvent(new Event("input", { bubbles: true }));
            urlInput.dispatchEvent(new Event("change", { bubbles: true }));
            
            showStatus(`Audio file "${file.name}" loaded successfully! The URL field has been updated. Remember to save your settings.`, 3000);
            console.log(`Audio file loaded for ${field}, size: ${result.length} characters`);
            console.log(`URL input field updated with data URL for ${field}`);
            
            // Reset file input to allow selecting the same file again if needed
            fileInput.value = "";
          } else {
            console.error(`Unexpected result type for ${field}:`, typeof result);
            showStatus("Failed to load audio file: unexpected result type.", 3000);
          }
        };
        reader.onerror = (error) => {
          console.error(`Failed to read audio file for ${field}:`, error);
          showStatus(`Failed to load audio file: ${error.message || "Unknown error"}`, 3000);
          fileInput.value = "";
        };
        reader.onabort = () => {
          console.warn(`File read aborted for ${field}`);
          showStatus("File upload cancelled.", 2000);
          fileInput.value = "";
        };
        
        try {
          reader.readAsDataURL(file);
        } catch (error) {
          console.error(`Error reading file for ${field}:`, error);
          showStatus(`Error reading file: ${error.message || "Unknown error"}`, 3000);
          fileInput.value = "";
        }
      });

      // Ensure the label properly triggers the file input
      const fileLabel = fileInput.closest("label.file-upload-label");
      if (fileLabel) {
        // Remove any existing click handlers to avoid conflicts
        fileLabel.addEventListener("click", (e) => {
          // Don't prevent default - let the label's natural behavior work
          // The label's 'for' attribute should handle the click
          if (e.target === fileInput) {
            return; // Let the input handle its own click
          }
        }, { passive: true });
      }
    });
  };

  const initTabs = () => {
    const tabButtons = document.querySelectorAll(".tab-button");
    const tabContents = document.querySelectorAll(".tab-content");

    tabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const targetTab = button.getAttribute("data-tab");

        // Remove active class from all buttons and contents
        tabButtons.forEach((btn) => btn.classList.remove("active"));
        tabContents.forEach((content) => content.classList.remove("active"));

        // Add active class to clicked button and corresponding content
        button.classList.add("active");
        const targetContent = document.getElementById(`tab-${targetTab}`);
        if (targetContent) {
          targetContent.classList.add("active");
          
          // If statistics tab is shown, update charts
          if (targetTab === "statistics") {
            setTimeout(updateCharts, 200);
          }
        }
      });
    });
  };

  const formatTime = (milliseconds) => {
    if (!milliseconds || milliseconds < 0) {
      return "0s";
    }
    
    const totalSeconds = Math.floor(milliseconds / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    
    return parts.join(" ");
  };

  const saveDailyStats = async (date, connectionTime, monitoringTime, offlineTime) => {
    try {
      const statsKey = `${DAILY_STATS_PREFIX}${date}`;
      const stats = {
        date,
        connectionTime: Math.round(connectionTime), // Ensure integer values
        monitoringTime: Math.round(monitoringTime), // Ensure integer values
        offlineTime: Math.round(offlineTime || 0), // Ensure integer values
      };
      await storage.set({ [statsKey]: stats });
      console.log(`Saved daily stats for ${date}:`, stats);
    } catch (error) {
      console.error("Failed to save daily stats:", error);
    }
  };

  const getAllDailyStatsKeys = async () => {
    try {
      const allData = await storage.get(null);
      return Object.keys(allData).filter(key => key.startsWith(DAILY_STATS_PREFIX));
    } catch (error) {
      console.error("Failed to get daily stats keys:", error);
      return [];
    }
  };

  const updateStatistics = async () => {
    // Statistics are now only in the Statistics tab, not Settings tab
    // This function updates statistics data and charts
    try {
      const today = getTodayDateString();
      const stored = await storage.get({
        [CONNECTION_TIME_KEY]: 0,
        [MONITORING_TIME_KEY]: 0,
        [CONNECTION_DATE_KEY]: "",
        [MONITORING_DATE_KEY]: "",
      });
      
      // Also check localStorage as fallback
      let connectionTime = 0;
      let monitoringTime = 0;
      
      try {
        // Get dates from storage (content.js saves to browser.storage.local)
        const connectionDate = stored[CONNECTION_DATE_KEY] || "";
        const monitoringDate = stored[MONITORING_DATE_KEY] || "";
        
        console.log("Statistics debug:", {
          today,
          connectionDate,
          monitoringDate,
          storedConnectionTime: stored[CONNECTION_TIME_KEY],
          storedMonitoringTime: stored[MONITORING_TIME_KEY]
        });
        
        // Only use stored time if it's from today
        if (connectionDate === today) {
          connectionTime = parseInt(stored[CONNECTION_TIME_KEY] || 0, 10);
          if (Number.isNaN(connectionTime)) {
            connectionTime = 0;
          }
        }
        
        if (monitoringDate === today) {
          monitoringTime = parseInt(stored[MONITORING_TIME_KEY] || 0, 10);
          if (Number.isNaN(monitoringTime)) {
            monitoringTime = 0;
          }
        }
        
        // Note: We can't access content script's localStorage from options page
        // The current session time is already included in the stored values from content.js
        // content.js updates the stored time every 30 seconds via updateTimeTracking()
      } catch (error) {
        console.error("Error retrieving statistics:", error);
      }
      
      // Calculate offline time (total elapsed time today - connection time)
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const totalElapsedToday = Date.now() - startOfDay.getTime();
      const offlineTime = Math.max(0, totalElapsedToday - connectionTime);
      
      // Save daily stats for today
      await saveDailyStats(today, connectionTime, monitoringTime, offlineTime);
      
      // Update charts if statistics tab is active
      const statisticsTab = document.getElementById("tab-statistics");
      if (statisticsTab && statisticsTab.classList.contains("active")) {
        updateCharts();
      }
    } catch (error) {
      console.error("Failed to update statistics:", error);
    }
  };

  const resetStatistics = async () => {
    if (!confirm("Are you sure you want to reset ALL statistics? This will delete all saved statistics data and cannot be undone.")) {
      return;
    }
    
    try {
      // Get all daily stats keys and remove them
      const allKeys = await getAllDailyStatsKeys();
      if (allKeys.length > 0) {
        await storage.remove(allKeys);
      }
      
      // Reset current day statistics
      const today = getTodayDateString();
      await storage.set({
        [CONNECTION_TIME_KEY]: 0,
        [MONITORING_TIME_KEY]: 0,
        [CONNECTION_DATE_KEY]: today,
        [MONITORING_DATE_KEY]: today,
      });
      try {
        localStorage.setItem(CONNECTION_TIME_KEY, "0");
        localStorage.setItem(MONITORING_TIME_KEY, "0");
        localStorage.setItem(CONNECTION_DATE_KEY, today);
        localStorage.setItem(MONITORING_DATE_KEY, today);
        localStorage.removeItem("farConnectionStart");
        localStorage.removeItem("farMonitoringStart");
      } catch (_) {}
      
      // Update charts if statistics tab is active
      const statisticsTab = document.getElementById("tab-statistics");
      if (statisticsTab && statisticsTab.classList.contains("active")) {
        updateCharts();
      }
      
      showStatus("All statistics reset successfully!");
    } catch (error) {
      console.error("Failed to reset statistics:", error);
      showStatus("Error resetting statistics. Check the console for details.", 0);
    }
  };

  // Chart functionality
  let currentView = "daily";
  
  // Simple Canvas Chart Implementation
  const SimpleChart = {
    drawLineChart: function(canvas, data, labels, color, bgColor) {
      const ctx = canvas.getContext("2d");
      
      // Ensure canvas has proper dimensions
      const containerWidth = canvas.parentElement.offsetWidth || 600;
      const width = canvas.width = containerWidth;
      const height = canvas.height = 300;
      
      // Clear canvas
      ctx.clearRect(0, 0, width, height);
      
      if (!data || data.length === 0) {
        ctx.fillStyle = "#64748b";
        ctx.font = "14px Arial";
        ctx.textAlign = "center";
        ctx.fillText("No data available", width / 2, height / 2);
        return;
      }
      
      const padding = { top: 30, right: 20, bottom: 40, left: 60 };
      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;
      
      const maxValue = Math.max(...data, 1);
      const minValue = Math.min(0, ...data);
      const valueRange = maxValue - minValue || 1;
      
      // Draw background
      ctx.fillStyle = bgColor;
      ctx.beginPath();
      ctx.moveTo(padding.left, padding.top);
      
      data.forEach((value, index) => {
        const x = padding.left + (index / (data.length - 1 || 1)) * chartWidth;
        const y = padding.top + chartHeight - ((value - minValue) / valueRange) * chartHeight;
        ctx.lineTo(x, y);
      });
      
      ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
      ctx.lineTo(padding.left, padding.top + chartHeight);
      ctx.closePath();
      ctx.fill();
      
      // Draw line
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      
      data.forEach((value, index) => {
        const x = padding.left + (index / (data.length - 1 || 1)) * chartWidth;
        const y = padding.top + chartHeight - ((value - minValue) / valueRange) * chartHeight;
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
      
      // Draw points
      ctx.fillStyle = color;
      data.forEach((value, index) => {
        const x = padding.left + (index / (data.length - 1 || 1)) * chartWidth;
        const y = padding.top + chartHeight - ((value - minValue) / valueRange) * chartHeight;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      });
      
      // Draw Y-axis labels
      ctx.fillStyle = "#64748b";
      ctx.font = "11px Arial";
      ctx.textAlign = "right";
      const ySteps = 5;
      for (let i = 0; i <= ySteps; i++) {
        const value = minValue + (valueRange / ySteps) * i;
        const y = padding.top + chartHeight - (i / ySteps) * chartHeight;
        const label = formatTimeLabel(Math.round(value));
        ctx.fillText(label, padding.left - 10, y + 4);
      }
      
      // Draw X-axis labels
      ctx.textAlign = "center";
      ctx.font = "10px Arial";
      const labelStep = Math.max(1, Math.floor(labels.length / 8));
      labels.forEach((label, index) => {
        if (index % labelStep === 0 || index === labels.length - 1) {
          const x = padding.left + (index / (data.length - 1 || 1)) * chartWidth;
          ctx.save();
          ctx.translate(x, padding.top + chartHeight + 20);
          ctx.rotate(-Math.PI / 4);
          ctx.fillText(label, 0, 0);
          ctx.restore();
        }
      });
      
      // Draw grid lines
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      for (let i = 0; i <= ySteps; i++) {
        const y = padding.top + (i / ySteps) * chartHeight;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + chartWidth, y);
        ctx.stroke();
      }
    }
  };

  const formatTimeForChart = (milliseconds) => {
    if (!milliseconds || milliseconds < 0) return 0;
    return Math.round(milliseconds / 1000 / 60); // Convert to minutes
  };

  const formatTimeLabel = (minutes) => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const getDailyData = async (days = 30) => {
    try {
      const allKeys = await getAllDailyStatsKeys();
      if (allKeys.length === 0) {
        // No data yet, return empty array for requested days
        const today = new Date();
        const result = [];
        for (let i = days - 1; i >= 0; i--) {
          const date = new Date(today);
          date.setDate(date.getDate() - i);
          result.push({
            date: getDateString(date),
            connectionTime: 0,
            monitoringTime: 0,
            offlineTime: 0,
          });
        }
        return result;
      }

      // Get all stats in one call
      const keysObj = {};
      allKeys.forEach(key => { keysObj[key] = null; });
      const allData = await storage.get(keysObj);
      
      const stats = [];
      allKeys.forEach(key => {
        if (allData[key]) {
          stats.push(allData[key]);
        }
      });
      
      console.log(`Retrieved ${stats.length} daily stats entries from storage`);
      
      // Sort by date
      stats.sort((a, b) => a.date.localeCompare(b.date));
      
      // Fill in missing days with zeros
      const today = new Date();
      const result = [];
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = getDateString(date);
        const stat = stats.find(s => s.date === dateStr);
        result.push({
          date: dateStr,
          connectionTime: stat ? (stat.connectionTime || 0) : 0,
          monitoringTime: stat ? (stat.monitoringTime || 0) : 0,
          offlineTime: stat ? (stat.offlineTime || 0) : 0,
        });
      }
      return result;
      
      return result;
    } catch (error) {
      console.error("Failed to get daily data:", error);
      return [];
    }
  };

  const getDateString = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const getMonthlyData = async (months = 12) => {
    try {
      const allKeys = await getAllDailyStatsKeys();
      if (allKeys.length === 0) {
        return [];
      }
      
      // Get all stats in one call
      const keysObj = {};
      allKeys.forEach(key => { keysObj[key] = null; });
      const allData = await storage.get(keysObj);
      
      const stats = [];
      allKeys.forEach(key => {
        if (allData[key]) {
          stats.push(allData[key]);
        }
      });
      
      // Group by month
      const monthlyMap = new Map();
      
      stats.forEach(stat => {
        const date = new Date(stat.date + "T00:00:00");
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        
        if (!monthlyMap.has(monthKey)) {
          monthlyMap.set(monthKey, { connectionTime: 0, monitoringTime: 0, offlineTime: 0 });
        }
        const monthData = monthlyMap.get(monthKey);
        monthData.connectionTime += stat.connectionTime || 0;
        monthData.monitoringTime += stat.monitoringTime || 0;        
        monthData.offlineTime += stat.offlineTime || 0;

      });
      
      // Convert to array and sort
      const monthlyArray = Array.from(monthlyMap.entries()).map(([month, data]) => ({
        month,
        connectionTime: data.connectionTime,
        monitoringTime: data.monitoringTime,
        offlineTime: data.offlineTime,
      }));
      
      monthlyArray.sort((a, b) => a.month.localeCompare(b.month));
      
      // Get last N months
      return monthlyArray.slice(-months);
    } catch (error) {
      console.error("Failed to get monthly data:", error);
      return [];
    }
  };

  const updateCharts = async () => {
    const connectionCanvas = document.getElementById("connectionTimeChart");
    const monitoringCanvas = document.getElementById("monitoringTimeChart");
    const offlineCanvas = document.getElementById("offlineTimeChart");
    
    if (!connectionCanvas || !monitoringCanvas || !offlineCanvas) {
      console.warn("Chart canvases not found");
      return;
    }
    
    try {
      let labels, connectionData, monitoringData, offlineData;
      
      if (currentView === "daily") {
        const dailyData = await getDailyData(30);
        console.log("Daily data for charts:", dailyData.slice(0, 5)); // Log first 5 entries
        labels = dailyData.map(d => {
          const date = new Date(d.date + "T00:00:00");
          return `${date.getMonth() + 1}/${date.getDate()}`;
        });
        connectionData = dailyData.map(d => formatTimeForChart(d.connectionTime));
        monitoringData = dailyData.map(d => formatTimeForChart(d.monitoringTime));
        offlineData = dailyData.map(d => formatTimeForChart(d.offlineTime || 0));
      } else {
        const monthlyData = await getMonthlyData(12);
        console.log("Monthly data for charts:", monthlyData);
        labels = monthlyData.map(d => {
          const [year, month] = d.month.split("-");
          const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          return `${monthNames[parseInt(month) - 1]} ${year}`;
        });
        connectionData = monthlyData.map(d => formatTimeForChart(d.connectionTime));
        monitoringData = monthlyData.map(d => formatTimeForChart(d.monitoringTime));
        offlineData = monthlyData.map(d => formatTimeForChart(d.offlineTime || 0));
      }
      
      console.log(`Updating charts with ${labels.length} data points (${currentView} view)`);
      
      // Draw charts using custom Canvas implementation
      SimpleChart.drawLineChart(
        connectionCanvas,
        connectionData,
        labels,
        "#1dbf73",
        "rgba(29, 191, 115, 0.1)"
      );
      
      SimpleChart.drawLineChart(
        monitoringCanvas,
        monitoringData,
        labels,
        "#3b82f6",
        "rgba(59, 130, 246, 0.1)"
      );
      
      SimpleChart.drawLineChart(
        offlineCanvas,
        offlineData,
        labels,
        "#ef4444",
        "rgba(239, 68, 68, 0.1)"
      );
    } catch (error) {
      console.error("Failed to update charts:", error);
    }
  };

  const initChartViewToggles = () => {
    const toggles = document.querySelectorAll(".view-toggle");
    toggles.forEach(toggle => {
      toggle.addEventListener("click", () => {
        toggles.forEach(t => t.classList.remove("active"));
        toggle.classList.add("active");
        currentView = toggle.getAttribute("data-view");
        updateCharts();
      });
    });
  };

  document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    attachSoundControls();
    init();
    updateStatistics();
    initChartViewToggles();
    
    // Update statistics every 5 seconds
    setInterval(updateStatistics, 1000);
    
    // Reset button handler
    const resetButton = document.getElementById("resetStats");
    if (resetButton) {
      resetButton.addEventListener("click", resetStatistics);
    }
  });

  if (activatePrimaryButton) {
    updatePrimaryTabInfo();
    activatePrimaryButton.addEventListener("click", async () => {
      if (!storage) {
        showStatus("Storage unavailable.", 0);
        return;
      }
      if (!tabs) {
        showStatus("Tabs API unavailable in this browser.", 0);
        return;
      }

      activatePrimaryButton.disabled = true;
      try {
        if (isAutoReloadActive) {
          await storage.set({ autoReloadEnabled: false });
          await storage.remove(PRIMARY_TAB_ID_STORAGE_KEY);
          await sendSettingsToTabs({ autoReloadEnabled: false });
          await broadcastPrimaryTabStatus(null);
          setActivationState(false, null);
          showStatus("Auto reload deactivated.");
          return;
        }

        const [activeTab] = await queryActiveTab();
        if (!activeTab || typeof activeTab.id !== "number") {
          showStatus("No active tab detected.", 3000);
          return;
        }
        const isFiverrTab =
          typeof activeTab.url === "string" && /https?:\/\/(www\.)?fiverr\.com/i.test(activeTab.url);
        if (!isFiverrTab) {
          showStatus("Open a Fiverr tab before activating.", 3000);
          return;
        }

        await storage.set({ [PRIMARY_TAB_ID_STORAGE_KEY]: activeTab.id, autoReloadEnabled: true });
        await sendSettingsToTabs({ autoReloadEnabled: true });
        await broadcastPrimaryTabStatus(activeTab.id);
        setActivationState(true, activeTab.id);
        showStatus("Auto reload activated.");
      } catch (error) {
        console.error("Failed to toggle primary tab:", error);
        showStatus("Unable to toggle auto reload. Check the console for details.", 0);
      } finally {
        activatePrimaryButton.disabled = false;
      }
    });
  }
})();

