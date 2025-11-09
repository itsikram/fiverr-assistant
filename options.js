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

  const populateForm = (values) => {
    Object.entries(values).forEach(([key, value]) => {
      const field = form.elements.namedItem(key);
      if (!field) return;

      if (field.type === "checkbox") {
        field.checked = Boolean(value);
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
          browser.tabs.sendMessage(tab.id, {
            type: "settingsUpdated",
            payload,
          }).catch(() => {
            // Content script might not be loaded yet; silently ignore.
          })
        )
      );
    } catch (error) {
      console.warn("Failed to broadcast settings to active Fiverr tabs:", error);
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
      const stored = await storage.get(defaultSettings);
      const merged = { ...defaultSettings, ...stored };
      populateForm(merged);
    } catch (error) {
      console.error("Failed to load stored settings:", error);
      showStatus("Unable to load settings.", 0);
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

      if (!urlInput || !playButton || !fileInput) return;

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

      fileInput.addEventListener("change", () => {
        const [file] = fileInput.files;
        if (!file) return;

        if (!file.type.startsWith("audio/")) {
          showStatus("Please select a valid audio file.", 3000);
          fileInput.value = "";
          return;
        }

        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result;
          if (typeof result === "string") {
            urlInput.value = result;
            showStatus("Audio file loaded. Remember to save your settings.");
            fileInput.value = "";
          }
        };
        reader.onerror = () => {
          console.error(`Failed to read audio file for ${field}:`, reader.error);
          showStatus("Failed to load audio file.", 3000);
        };
        reader.readAsDataURL(file);
      });
    });
  };

  document.addEventListener("DOMContentLoaded", () => {
    attachSoundControls();
    init();
  });
})();

