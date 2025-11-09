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

  document.addEventListener("DOMContentLoaded", init);
})();

