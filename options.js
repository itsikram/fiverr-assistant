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
    selectorUnreadIcon: ".messages-wrapper .unread-icon",
    selectorNewClientFlag: ".first > div:nth-child(2) > div:nth-child(1) > span:nth-child(2)",
    selectorMessageContent: ".message-flow .content",
  };
  const PRIMARY_TAB_ID_STORAGE_KEY = "farPrimaryTabId";

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
        }
      });
    });
  };

  document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    attachSoundControls();
    init();
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

