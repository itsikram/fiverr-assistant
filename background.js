(() => {
  // Check if "fabs fiverr reloader assistant" extension is active
  const checkForFabsExtension = async () => {
    try {
      // Check for fabs extension runtime ID (common extension IDs)
      const possibleFabsIds = [
        'fabs-reloader',
        'fabsfiverrreloader',
        'fabs-fiverr-reloader'
      ];
      
      // Try to detect by checking if extension storage has fabs-related keys
      const hasBrowserAPI = typeof browser !== "undefined";
      const api = hasBrowserAPI ? browser : chrome;
      if (api && api.storage && api.storage.local) {
        try {
          const storage = api.storage.local;
          const keys = await new Promise((resolve) => {
            if (hasBrowserAPI && typeof storage.get === "function" && storage.get.length <= 1) {
              storage.get(null).then(resolve).catch(() => resolve({}));
            } else {
              storage.get(null, (result) => {
                resolve(result || {});
              });
            }
          });
          
          // Check if any storage keys indicate fabs extension
          const storageKeys = Object.keys(keys || {});
          if (storageKeys.some(key => key.toLowerCase().includes('fabs') && key.toLowerCase().includes('reloader'))) {
            return true;
          }
        } catch (e) {
          // Ignore storage errors
        }
      }
    } catch (e) {
      // Ignore detection errors
    }
    return false;
  };
  
  const hasBrowserAPI = typeof browser !== "undefined";
  const api = hasBrowserAPI ? browser : chrome;

  if (!api || !api.tabs || !api.runtime) {
    return;
  }
  
  // Check for fabs extension and exit if found
  checkForFabsExtension().then(isActive => {
    if (isActive) {
      console.log('Fiverr Assistant: fabs fiverr reloader assistant detected. Background script exiting to prevent conflicts.');
      return; // Exit the background script
    }
  }).catch(() => {
    // Continue if check fails
  });

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
  const PRIMARY_TAB_ID_STORAGE_KEY = "farPrimaryTabId";
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

  const storageSet = (items) => {
    if (!storage) {
      return Promise.resolve();
    }
    if (hasBrowserAPI && typeof storage.set === "function" && storage.set.length <= 1) {
      return storage.set(items);
    }
    return new Promise((resolve, reject) => {
      try {
        storage.set(items, () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  };

  const storageRemove = (keys) => {
    if (!storage) {
      return Promise.resolve();
    }
    if (hasBrowserAPI && typeof storage.remove === "function" && storage.remove.length <= 1) {
      return storage.remove(keys);
    }
    return new Promise((resolve, reject) => {
      try {
        storage.remove(keys, () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve();
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
      stopErrorPageChecking();
      stopPeriodicReload();
    } else {
      startErrorPageChecking();
      startPeriodicReload();
    }
  };

  const sendAllSettingsToTab = async (tabId, retryCount = 0) => {
    if (!tabId || typeof tabId !== "number") {
      return;
    }
    
    // Prevent duplicate sends to the same tab (unless it's a retry)
    if (retryCount === 0 && pendingSettingsSends.has(tabId)) {
      console.log("Fiverr Assistant: Settings send already pending for tab", tabId);
      return;
    }
    
    // Mark as pending
    if (retryCount === 0) {
      pendingSettingsSends.set(tabId, true);
    }
    
    const MAX_RETRIES = 10;
    const RETRY_DELAY = 500; // Start with 500ms delay
    
    try {
      // Try to get all settings from storage
      // Request specific keys we need, plus try to get all keys
      const settingsKeys = [
        "autoReloadEnabled", "profileUsername", "pageLinks", "relStart", "relEnd",
        "targetedClients", "profile", "new_client_sound", "targeted_client_sound",
        "old_client_sound", "selectorUnreadIcon", "selectorNewClientFlag", "selectorMessageContent"
      ];
      
      let allSettings = {};
      try {
        if (hasBrowserAPI && typeof storage.get === "function" && storage.get.length <= 1) {
          // Firefox API - try to get all keys by passing null or empty object
          try {
            allSettings = await storage.get(null);
            if (!allSettings || Object.keys(allSettings).length === 0) {
              allSettings = await storage.get({});
            }
            if (!allSettings || Object.keys(allSettings).length === 0) {
              // Fallback to specific keys
              allSettings = await storage.get(settingsKeys);
            }
          } catch (e) {
            // If null doesn't work, try empty object or specific keys
            try {
              allSettings = await storage.get({});
            } catch (e2) {
              allSettings = await storage.get(settingsKeys);
            }
          }
        } else {
          // Chrome API - try empty object first (gets all keys)
          allSettings = await new Promise((resolve, reject) => {
            storage.get({}, (result) => {
              if (chrome.runtime && chrome.runtime.lastError) {
                // If empty object doesn't work, try specific keys
                storage.get(settingsKeys, (result2) => {
                  if (chrome.runtime && chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                  }
                  resolve(result2 || {});
                });
                return;
              }
              resolve(result || {});
            });
          });
        }
        console.log("Fiverr Assistant: Loaded settings from storage", {
          profileUsername: allSettings.profileUsername,
          pageLinks: allSettings.pageLinks,
          hasSettings: Object.keys(allSettings).length > 0
        });
      } catch (error) {
        console.warn("Fiverr Assistant: Could not load all settings, using defaults", error);
        allSettings = {};
      }

      // Ensure autoReloadEnabled is set to true and include essential defaults
      // If pageLinks is empty but profileUsername exists, generate default pageLinks
      let pageLinks = allSettings.pageLinks || "";
      const profileUsername = allSettings.profileUsername || "";
      
      if (!pageLinks || pageLinks.trim() === "") {
        if (profileUsername && profileUsername.trim() !== "") {
          // Generate default pageLinks based on profileUsername
          pageLinks = `/users/${profileUsername}/seller_dashboard,/users/${profileUsername}/manage_gigs,/earnings?source=header_nav,/users/${profileUsername}/seller_analytics_dashboard?source=header_nav&tab=overview,/users/${profileUsername}/manage_orders?source=header_nav`;
          console.log("Fiverr Assistant: Generated default pageLinks from profileUsername", pageLinks);
        } else {
          // If no profileUsername, use generic Fiverr pages that work for any user
          pageLinks = "/seller_dashboard,/manage_gigs,/earnings?source=header_nav";
          console.log("Fiverr Assistant: Using generic pageLinks (no profileUsername)", pageLinks);
        }
      }
      
      // Read the current autoReloadEnabled setting from storage
      const currentAutoReloadEnabled = coerceBoolean(allSettings.autoReloadEnabled, true);
      
      const settingsPayload = {
        relStart: allSettings.relStart || "30",
        relEnd: allSettings.relEnd || "180",
        profileUsername: profileUsername,
        targetedClients: allSettings.targetedClients || "",
        ...allSettings, // Spread all other settings
        pageLinks: pageLinks, // Override with generated pageLinks if needed
        autoReloadEnabled: currentAutoReloadEnabled // Use the stored value, don't force to true
      };
      
      console.log("Fiverr Assistant: Settings payload prepared", {
        autoReloadEnabled: settingsPayload.autoReloadEnabled,
        pageLinks: settingsPayload.pageLinks,
        relStart: settingsPayload.relStart,
        relEnd: settingsPayload.relEnd,
        profileUsername: settingsPayload.profileUsername
      });
      
      // Check if tab still exists and is a Fiverr tab
      try {
        const tab = await new Promise((resolve, reject) => {
          api.tabs.get(tabId, (tab) => {
            if (api.runtime.lastError) {
              reject(new Error(api.runtime.lastError.message));
              return;
            }
            resolve(tab);
          });
        });
        
        if (!tab || !tab.url || !tab.url.includes("fiverr.com")) {
          console.log("Fiverr Assistant: Tab is not a Fiverr tab, skipping settings send");
          pendingSettingsSends.delete(tabId);
          return;
        }
        
        // Only send if tab is loaded (status complete)
        if (tab.status !== "complete") {
          if (retryCount < MAX_RETRIES) {
            console.log(`Fiverr Assistant: Tab not ready, retrying in ${RETRY_DELAY}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
            setTimeout(() => {
              sendAllSettingsToTab(tabId, retryCount + 1);
            }, RETRY_DELAY);
            return;
          }
        }
      } catch (error) {
        console.warn("Fiverr Assistant: Could not check tab status", error);
        pendingSettingsSends.delete(tabId);
      }
      
      console.log("Fiverr Assistant: Sending all settings to tab", tabId, retryCount > 0 ? `(retry ${retryCount})` : "", settingsPayload);
      
      // Add a small delay on first attempt to ensure content script is ready
      if (retryCount === 0) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      // Try to send message with retry logic
      try {
        if (hasBrowserAPI && typeof api.tabs.sendMessage === "function" && api.tabs.sendMessage.length <= 2) {
          await api.tabs.sendMessage(tabId, {
            type: "settingsUpdated",
            payload: settingsPayload
          });
          console.log("Fiverr Assistant: Successfully sent settings to tab", tabId);
        } else {
          await new Promise((resolve, reject) => {
            api.tabs.sendMessage(tabId, {
              type: "settingsUpdated",
              payload: settingsPayload
            }, (response) => {
              if (api.runtime.lastError) {
                reject(new Error(api.runtime.lastError.message));
                return;
              }
              resolve(response);
            });
          });
          console.log("Fiverr Assistant: Successfully sent settings to tab", tabId);
          // Clear pending flag on success
          pendingSettingsSends.delete(tabId);
        }
      } catch (error) {
        const errorMessage = error && error.message ? error.message : String(error);
        if (errorMessage.includes("Receiving end does not exist") || errorMessage.includes("Could not establish connection")) {
          // Content script not loaded yet, retry
          if (retryCount < MAX_RETRIES) {
            const delay = RETRY_DELAY * (retryCount + 1); // Exponential backoff
            console.log(`Fiverr Assistant: Content script not ready, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
            setTimeout(() => {
              sendAllSettingsToTab(tabId, retryCount + 1);
            }, delay);
            return;
          } else {
            console.warn("Fiverr Assistant: Max retries reached, content script may not be loaded", tabId);
            pendingSettingsSends.delete(tabId);
          }
        } else {
          console.warn("Fiverr Assistant: Could not send settings to content script", error);
          pendingSettingsSends.delete(tabId);
        }
      }
    } catch (error) {
      console.error("Fiverr Assistant: Failed to load and send settings", error);
      pendingSettingsSends.delete(tabId);
    }
  };


  const FIVERR_URL_PATTERNS = ["https://www.fiverr.com/*", "https://fiverr.com/*"];
  const FIVERR_HOME_URL = "https://www.fiverr.com/";
  let ensureTimeoutId = null;
  const pendingSettingsSends = new Map(); // Track pending settings sends to avoid duplicates
  const errorPageReloadAttempts = new Map(); // Track reload attempts per tab
  const MAX_ERROR_RELOAD_ATTEMPTS = 10;
  let errorPageCheckIntervalId = null;
  let periodicReloadIntervalId = null;
  const PERIODIC_RELOAD_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes in milliseconds

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

  const checkAndActivateFiverrTab = async () => {
    try {
      // Check if auto-reload is enabled before proceeding
      await refreshAutoReloadSetting();
      if (!autoReloadEnabled) {
        console.log("Fiverr Assistant: Auto-reload is disabled, skipping tab activation");
        return;
      }
      
      console.log("Fiverr Assistant: Checking for Fiverr tabs...");
      let tabs = [];
      
      try {
        tabs = await new Promise((resolve, reject) => {
          api.tabs.query({ url: FIVERR_URL_PATTERNS }, (tabs) => {
            if (api.runtime.lastError) {
              console.warn("Fiverr Assistant: Error querying tabs with URL pattern, trying fallback", api.runtime.lastError);
              reject(new Error(api.runtime.lastError.message));
              return;
            }
            resolve(Array.isArray(tabs) ? tabs : []);
          });
        });
      } catch (error) {
        // Fallback: query all tabs and filter manually
        console.log("Fiverr Assistant: Using fallback method to find Fiverr tabs");
        tabs = await new Promise((resolve, reject) => {
          api.tabs.query({}, (allTabs) => {
            if (api.runtime.lastError) {
              console.error("Fiverr Assistant: Error querying all tabs", api.runtime.lastError);
              reject(new Error(api.runtime.lastError.message));
              return;
            }
            const fiverrTabs = (Array.isArray(allTabs) ? allTabs : []).filter((tab) => {
              const url = tab.url || "";
              return url.includes("fiverr.com");
            });
            resolve(fiverrTabs);
          });
        });
      }

      console.log(`Fiverr Assistant: Found ${tabs.length} Fiverr tab(s)`);

      if (tabs.length === 0) {
        // No Fiverr tab exists, create a tab only if auto-reload is enabled
        console.log("Fiverr Assistant: No Fiverr tabs found. Creating new tab and activating reloader...");
        try {
          // Don't force enable auto-reload, respect the current setting
          console.log("Fiverr Assistant: Auto-reload is enabled, creating tab");
          
          const createdTab = await new Promise((resolve, reject) => {
            api.tabs.create({ url: FIVERR_HOME_URL }, (tab) => {
              if (api.runtime.lastError) {
                console.error("Fiverr Assistant: unable to open Fiverr tab", api.runtime.lastError);
                reject(new Error(api.runtime.lastError.message));
                return;
              }
              console.log("Fiverr Assistant: Successfully created Fiverr tab", tab);
              resolve(tab);
            });
          });

          // Wait for the tab to load, then send settings update
          if (createdTab && typeof createdTab.id === "number") {
            // Set the new tab as the primary tab
            await storageSet({ [PRIMARY_TAB_ID_STORAGE_KEY]: createdTab.id });
            console.log("Fiverr Assistant: Set new tab as primary tab", createdTab.id);
            
            // Pin the newly created tab
            api.tabs.update(createdTab.id, { pinned: true }, () => {
              if (api.runtime.lastError) {
                console.warn("Fiverr Assistant: Could not pin new tab", api.runtime.lastError);
              } else {
                console.log("Fiverr Assistant: Successfully pinned new tab", createdTab.id);
              }
            });
            
            const waitForTabLoad = () => {
              return new Promise((resolve) => {
                const checkTab = () => {
                  api.tabs.get(createdTab.id, (tab) => {
                    if (api.runtime.lastError) {
                      console.warn("Fiverr Assistant: Error checking tab status", api.runtime.lastError);
                      resolve();
                      return;
                    }
                    if (tab && tab.status === "complete" && tab.url && tab.url.includes("fiverr.com")) {
                      console.log("Fiverr Assistant: Tab loaded, sending all settings");
                      // Send all settings to content script
                      sendAllSettingsToTab(createdTab.id).then(() => {
                        resolve();
                      }).catch(() => {
                        resolve(); // Resolve anyway even if send fails
                      });
                      return;
                    } else {
                      // Check again after a short delay
                      setTimeout(checkTab, 100);
                    }
                  });
                };
                checkTab();
                // Timeout after 5 seconds
                setTimeout(resolve, 5000);
              });
            };
            await waitForTabLoad();
          }
        } catch (error) {
          console.error("Fiverr Assistant: failed to activate reloader or create tab", error);
        }
      } else {
        // Fiverr tabs exist, check for designated primary tab or use first tab
        console.log("Fiverr Assistant: Fiverr tabs exist. Checking for designated primary tab...");
        try {
          // Don't force enable auto-reload, respect the current setting
          console.log("Fiverr Assistant: Auto-reload is enabled, processing existing tabs");
          
          // Check if there's a designated primary tab ID
          let primaryTabId = null;
          try {
            const primaryTabResult = await storageGet([PRIMARY_TAB_ID_STORAGE_KEY]);
            if (primaryTabResult && primaryTabResult[PRIMARY_TAB_ID_STORAGE_KEY]) {
              const storedId = primaryTabResult[PRIMARY_TAB_ID_STORAGE_KEY];
              if (typeof storedId === "number" && !Number.isNaN(storedId)) {
                primaryTabId = storedId;
              } else if (typeof storedId === "string") {
                const parsed = parseInt(storedId, 10);
                if (!Number.isNaN(parsed)) {
                  primaryTabId = parsed;
                }
              }
            }
          } catch (error) {
            console.warn("Fiverr Assistant: Could not read primary tab ID", error);
          }
          
          // Check if primary tab still exists and is a Fiverr tab
          let targetTabId = null;
          if (primaryTabId) {
            const primaryTab = tabs.find(tab => tab.id === primaryTabId);
            if (primaryTab && primaryTab.url && primaryTab.url.includes("fiverr.com")) {
              targetTabId = primaryTabId;
              console.log("Fiverr Assistant: Using designated primary tab", primaryTabId);
            } else {
              console.log("Fiverr Assistant: Designated primary tab no longer exists, using first Fiverr tab");
              // Primary tab doesn't exist, use first tab and update primary tab ID
              if (tabs[0] && typeof tabs[0].id === "number") {
                targetTabId = tabs[0].id;
                await storageSet({ [PRIMARY_TAB_ID_STORAGE_KEY]: targetTabId });
              }
            }
          } else {
            // No primary tab designated, use first tab and set it as primary
            if (tabs[0] && typeof tabs[0].id === "number") {
              targetTabId = tabs[0].id;
              await storageSet({ [PRIMARY_TAB_ID_STORAGE_KEY]: targetTabId });
              console.log("Fiverr Assistant: Setting first Fiverr tab as primary tab", targetTabId);
            }
          }
          
          // Pin and send settings to target tab (without activating/focusing)
          if (targetTabId) {
            api.tabs.update(targetTabId, { pinned: true }, () => {
              if (api.runtime.lastError) {
                console.error("Fiverr Assistant: unable to pin target tab", api.runtime.lastError);
              } else {
                console.log("Fiverr Assistant: Successfully pinned target tab", targetTabId);
                // Send all settings to content script
                sendAllSettingsToTab(targetTabId);
              }
            });
          }
        } catch (error) {
          console.error("Fiverr Assistant: failed to activate reloader", error);
        }
      }
    } catch (error) {
      console.error("Fiverr Assistant: failed to check for Fiverr tabs", error);
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
      stopErrorPageChecking();
      stopPeriodicReload();
    } else {
      scheduleEnsureFiverrTab(500);
      startErrorPageChecking();
      startPeriodicReload();
    }
  };

  if (storage) {
    if (hasBrowserAPI && browser.storage && browser.storage.onChanged) {
      browser.storage.onChanged.addListener(handleStorageChange);
    } else if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChange);
    }
  }

  // Listen for tab creation (including restored tabs on Firefox startup)
  api.tabs.onCreated.addListener((tab) => {
    if (!tab || !tab.url) {
      return;
    }
    
    const url = tab.url || "";
    const isFiverrUrl = url.includes("fiverr.com");
    
    if (isFiverrUrl && autoReloadEnabled) {
      console.log("Fiverr Assistant: Fiverr tab created/restored, checking activation...");
      // Wait a bit for the tab to fully initialize
      setTimeout(() => {
        checkAndActivateFiverrTab().then(() => {
          // If this is the only Fiverr tab or there's no primary tab set, activate it
          storageGet([PRIMARY_TAB_ID_STORAGE_KEY]).then((result) => {
            const primaryTabId = result && result[PRIMARY_TAB_ID_STORAGE_KEY];
            if (!primaryTabId && typeof tab.id === "number") {
              // No primary tab set, make this one primary
               storageSet({ [PRIMARY_TAB_ID_STORAGE_KEY]: tab.id }).then(() => {
                 api.tabs.update(tab.id, { pinned: true }, () => {
                   if (!api.runtime.lastError) {
                     console.log("Fiverr Assistant: Set newly created/restored tab as primary", tab.id);
                     sendAllSettingsToTab(tab.id);
                   }
                 });
               });
             } else if (primaryTabId === tab.id) {
               // This is the designated primary tab
               api.tabs.update(tab.id, { pinned: true }, () => {
                 if (!api.runtime.lastError) {
                   console.log("Fiverr Assistant: Pinned primary tab", tab.id);
                   sendAllSettingsToTab(tab.id);
                 }
               });
            }
          }).catch(() => {});
        }).catch(() => {});
      }, 500);
    }
  });

  api.tabs.onRemoved.addListener(async (tabId) => {
    // Check if the removed tab was the primary tab
    try {
      const primaryTabResult = await storageGet([PRIMARY_TAB_ID_STORAGE_KEY]);
      if (primaryTabResult && primaryTabResult[PRIMARY_TAB_ID_STORAGE_KEY]) {
        const storedId = primaryTabResult[PRIMARY_TAB_ID_STORAGE_KEY];
        let primaryTabId = null;
        if (typeof storedId === "number" && !Number.isNaN(storedId)) {
          primaryTabId = storedId;
        } else if (typeof storedId === "string") {
          const parsed = parseInt(storedId, 10);
          if (!Number.isNaN(parsed)) {
            primaryTabId = parsed;
          }
        }
        
        if (primaryTabId === tabId) {
          console.log("Fiverr Assistant: Primary tab was closed, finding new primary tab...");
          // Primary tab was closed, find a new one
          try {
            const fiverrTabs = await new Promise((resolve, reject) => {
              api.tabs.query({ url: FIVERR_URL_PATTERNS }, (tabs) => {
                if (api.runtime.lastError) {
                  // Fallback: query all tabs
                  api.tabs.query({}, (allTabs) => {
                    if (api.runtime.lastError) {
                      reject(new Error(api.runtime.lastError.message));
                      return;
                    }
                    const filtered = (Array.isArray(allTabs) ? allTabs : []).filter((tab) => {
                      const url = tab.url || "";
                      return url.includes("fiverr.com");
                    });
                    resolve(filtered);
                  });
                  return;
                }
                resolve(Array.isArray(tabs) ? tabs : []);
              });
            });
            
            if (fiverrTabs.length > 0 && typeof fiverrTabs[0].id === "number") {
              // Set the first available Fiverr tab as the new primary tab
              const newPrimaryTabId = fiverrTabs[0].id;
              await storageSet({ [PRIMARY_TAB_ID_STORAGE_KEY]: newPrimaryTabId });
              console.log("Fiverr Assistant: Set new primary tab", newPrimaryTabId);
              
               // Pin and send settings to the new primary tab (without activating/focusing)
               api.tabs.update(newPrimaryTabId, { pinned: true }, () => {
                 if (api.runtime.lastError) {
                   console.warn("Fiverr Assistant: Could not pin new primary tab", api.runtime.lastError);
                 } else {
                   console.log("Fiverr Assistant: Successfully pinned new primary tab", newPrimaryTabId);
                   sendAllSettingsToTab(newPrimaryTabId);
                 }
               });
            } else {
              // No Fiverr tabs available, check if auto-reload is enabled before creating a new tab
              await refreshAutoReloadSetting();
              if (!autoReloadEnabled) {
                console.log("Fiverr Assistant: Auto-reload is disabled, not creating new tab");
                await storageRemove(PRIMARY_TAB_ID_STORAGE_KEY);
                return;
              }
              
              // No Fiverr tabs available, create a new one and activate it
              console.log("Fiverr Assistant: No Fiverr tabs available, creating new activated tab...");
              try {
                const createdTab = await new Promise((resolve, reject) => {
                  api.tabs.create({ url: FIVERR_HOME_URL }, (tab) => {
                    if (api.runtime.lastError) {
                      console.error("Fiverr Assistant: unable to create new Fiverr tab", api.runtime.lastError);
                      reject(new Error(api.runtime.lastError.message));
                      return;
                    }
                    console.log("Fiverr Assistant: Successfully created new Fiverr tab", tab);
                    resolve(tab);
                  });
                });

                if (createdTab && typeof createdTab.id === "number") {
                  // Set the new tab as the primary tab
                  await storageSet({ [PRIMARY_TAB_ID_STORAGE_KEY]: createdTab.id });
                  console.log("Fiverr Assistant: Set new tab as primary tab", createdTab.id);
                  
                  // Pin the newly created tab
                  api.tabs.update(createdTab.id, { pinned: true }, () => {
                    if (api.runtime.lastError) {
                      console.warn("Fiverr Assistant: Could not pin new tab", api.runtime.lastError);
                    } else {
                      console.log("Fiverr Assistant: Successfully pinned new tab", createdTab.id);
                    }
                  });
                  
                  // Wait for the tab to load, then send settings
                  const waitForTabLoad = () => {
                    return new Promise((resolve) => {
                      const checkTab = () => {
                        api.tabs.get(createdTab.id, (tab) => {
                          if (api.runtime.lastError) {
                            console.warn("Fiverr Assistant: Error checking tab status", api.runtime.lastError);
                            resolve();
                            return;
                          }
                          if (tab && tab.status === "complete" && tab.url && tab.url.includes("fiverr.com")) {
                            console.log("Fiverr Assistant: New tab loaded, sending all settings");
                            sendAllSettingsToTab(createdTab.id).then(() => {
                              resolve();
                            }).catch(() => {
                              resolve();
                            });
                            return;
                          } else {
                            setTimeout(checkTab, 100);
                          }
                        });
                      };
                      checkTab();
                      setTimeout(resolve, 5000);
                    });
                  };
                  await waitForTabLoad();
                }
              } catch (error) {
                console.error("Fiverr Assistant: Failed to create new activated tab", error);
                await storageRemove(PRIMARY_TAB_ID_STORAGE_KEY);
              }
            }
          } catch (error) {
            console.error("Fiverr Assistant: Error finding new primary tab", error);
            // Remove primary tab ID on error
            await storageRemove(PRIMARY_TAB_ID_STORAGE_KEY);
          }
        }
      }
    } catch (error) {
      console.warn("Fiverr Assistant: Error checking primary tab on removal", error);
    }
    
    scheduleEnsureFiverrTab(200);
  });

  // Check if a tab is showing an error page
  const isErrorPage = (url) => {
    if (!url || typeof url !== "string") {
      return false;
    }
    // Firefox error pages
    if (url.startsWith("about:neterror") || url.startsWith("about:certerror") || url.startsWith("about:blocked")) {
      return true;
    }
    // Chrome error pages
    if (url.startsWith("chrome-error://") || url.startsWith("chrome://error")) {
      return true;
    }
    return false;
  };

  // Check if a tab is showing an error page by injecting a script
  const checkTabForErrorPage = async (tabId) => {
    if (!autoReloadEnabled) {
      return false;
    }
    
    try {
      const tab = await new Promise((resolve, reject) => {
        api.tabs.get(tabId, (tab) => {
          if (api.runtime.lastError) {
            reject(new Error(api.runtime.lastError.message));
            return;
          }
          resolve(tab);
        });
      });

      if (!tab || !tab.url) {
        return false;
      }

      // Check if URL is an error page
      if (isErrorPage(tab.url)) {
        return true;
      }

      // If it's a Fiverr URL, try to inject script to check for error content
      const isFiverrUrl = tab.url.startsWith("https://www.fiverr.com/") || tab.url.startsWith("https://fiverr.com/");
      if (!isFiverrUrl) {
        return false;
      }

      // Check if content script can access the page (if not, might be error page)
      // Try to execute a simple script to check for error indicators
      try {
        const results = await new Promise((resolve, reject) => {
          if (hasBrowserAPI && typeof api.tabs.executeScript === "function") {
            try {
              const result = api.tabs.executeScript(tabId, {
                code: `
                  (function() {
                    const title = document.title.toLowerCase();
                    const bodyText = document.body ? document.body.textContent.toLowerCase() : "";
                    const errorIndicators = [
                      "the connection has timed out",
                      "connection has timed out",
                      "taking too long to respond",
                      "unable to connect",
                      "no internet",
                      "offline",
                      "try again"
                    ];
                    return errorIndicators.some(indicator => 
                      title.includes(indicator) || bodyText.includes(indicator)
                    ) && (!document.querySelector('header, nav, [class*="header"], [class*="nav"]') || document.body.textContent.trim().length < 200);
                  })();
                `
              });
              if (result && typeof result.then === "function") {
                result.then(resolve).catch(reject);
              } else {
                resolve(result);
              }
            } catch (e) {
              reject(e);
            }
          } else {
            api.tabs.executeScript(tabId, {
              code: `
                (function() {
                  const title = document.title.toLowerCase();
                  const bodyText = document.body ? document.body.textContent.toLowerCase() : "";
                  const errorIndicators = [
                    "the connection has timed out",
                    "connection has timed out",
                    "taking too long to respond",
                    "unable to connect",
                    "no internet",
                    "offline",
                    "try again"
                  ];
                  return errorIndicators.some(indicator => 
                    title.includes(indicator) || bodyText.includes(indicator)
                  ) && (!document.querySelector('header, nav, [class*="header"], [class*="nav"]') || document.body.textContent.trim().length < 200);
                })();
              `
            }, (results) => {
              if (api.runtime.lastError) {
                // If we can't execute script, might be error page
                reject(new Error(api.runtime.lastError.message));
                return;
              }
              resolve(results && results[0]);
            });
          }
        });

        return results === true;
      } catch (error) {
        // If we can't execute script on the page, it might be an error page
        // But also might be a permission issue, so check URL first
        if (isErrorPage(tab.url)) {
          return true;
        }
        // If it's a Fiverr URL but we can't execute script, might be error page
        // Wait a bit and check URL again
        return false;
      }
    } catch (error) {
      console.warn("Fiverr Assistant: Error checking tab for error page", tabId, error);
      return false;
    }
  };

  // Reload a tab if it's showing an error page
  const reloadErrorPage = async (tabId) => {
    if (!autoReloadEnabled) {
      return;
    }

    try {
      const attempts = errorPageReloadAttempts.get(tabId) || 0;
      if (attempts >= MAX_ERROR_RELOAD_ATTEMPTS) {
        console.warn(`Fiverr Assistant: Max error page reload attempts (${MAX_ERROR_RELOAD_ATTEMPTS}) reached for tab ${tabId}`);
        errorPageReloadAttempts.delete(tabId);
        return;
      }

      console.log(`Fiverr Assistant: Reloading error page for tab ${tabId} (attempt ${attempts + 1}/${MAX_ERROR_RELOAD_ATTEMPTS})`);
      errorPageReloadAttempts.set(tabId, attempts + 1);

      api.tabs.reload(tabId, { bypassCache: false }, () => {
        if (api.runtime.lastError) {
          console.warn("Fiverr Assistant: Error reloading tab", api.runtime.lastError);
          errorPageReloadAttempts.delete(tabId);
        }
      });
    } catch (error) {
      console.warn("Fiverr Assistant: Error in reloadErrorPage", error);
      errorPageReloadAttempts.delete(tabId);
    }
  };

  // Start periodic checking for error pages
  const startErrorPageChecking = () => {
    if (errorPageCheckIntervalId || !autoReloadEnabled) {
      return;
    }

    errorPageCheckIntervalId = setInterval(async () => {
      if (!autoReloadEnabled) {
        stopErrorPageChecking();
        return;
      }

      try {
        // Get primary tab ID first
        const primaryTabResult = await storageGet([PRIMARY_TAB_ID_STORAGE_KEY]);
        const primaryTabId = primaryTabResult && primaryTabResult[PRIMARY_TAB_ID_STORAGE_KEY];
        
        if (!primaryTabId) {
          return; // No primary tab set
        }

        // Check primary tab directly
        try {
          const primaryTab = await new Promise((resolve, reject) => {
            api.tabs.get(primaryTabId, (tab) => {
              if (api.runtime.lastError) {
                reject(new Error(api.runtime.lastError.message));
                return;
              }
              resolve(tab);
            });
          });

          if (primaryTab) {
            // Check if URL is an error page first (fastest check)
            if (isErrorPage(primaryTab.url)) {
              console.log(`Fiverr Assistant: Primary tab ${primaryTabId} has error page URL: ${primaryTab.url}`);
              await reloadErrorPage(primaryTabId);
              return;
            }

            // If it's a Fiverr URL or error page, check for error content
            const isFiverrUrl = primaryTab.url && (primaryTab.url.includes("fiverr.com") || isErrorPage(primaryTab.url));
            if (isFiverrUrl) {
              const isError = await checkTabForErrorPage(primaryTabId);
              if (isError) {
                await reloadErrorPage(primaryTabId);
              } else {
                // Page loaded successfully, reset counter
                errorPageReloadAttempts.delete(primaryTabId);
              }
            }
          }
        } catch (error) {
          // Tab might not exist anymore
          console.warn("Fiverr Assistant: Error checking primary tab for error page", error);
        }
      } catch (error) {
        console.warn("Fiverr Assistant: Error in error page checking", error);
      }
    }, 10000); // Check every 10 seconds
  };

  // Stop periodic checking for error pages
  const stopErrorPageChecking = () => {
    if (errorPageCheckIntervalId) {
      clearInterval(errorPageCheckIntervalId);
      errorPageCheckIntervalId = null;
    }
    errorPageReloadAttempts.clear();
  };

  // Start periodic reload of primary tab every 5 minutes
  const startPeriodicReload = () => {
    if (periodicReloadIntervalId || !autoReloadEnabled) {
      return;
    }

    console.log("Fiverr Assistant: Starting periodic reload (every 5 minutes)");
    periodicReloadIntervalId = setInterval(async () => {
      if (!autoReloadEnabled) {
        stopPeriodicReload();
        return;
      }

      try {
        const primaryTabResult = await storageGet([PRIMARY_TAB_ID_STORAGE_KEY]);
        const primaryTabId = primaryTabResult && primaryTabResult[PRIMARY_TAB_ID_STORAGE_KEY];
        
        if (!primaryTabId) {
          console.log("Fiverr Assistant: No primary tab set for periodic reload");
          return;
        }

        // Check if tab still exists and is a Fiverr tab
        try {
          const primaryTab = await new Promise((resolve, reject) => {
            api.tabs.get(primaryTabId, (tab) => {
              if (api.runtime.lastError) {
                reject(new Error(api.runtime.lastError.message));
                return;
              }
              resolve(tab);
            });
          });

          if (primaryTab && primaryTab.url) {
            const isFiverrUrl = primaryTab.url.includes("fiverr.com");
            if (isFiverrUrl) {
              console.log(`Fiverr Assistant: Periodic reload triggered for primary tab ${primaryTabId}`);
              api.tabs.reload(primaryTabId, { bypassCache: false }, () => {
                if (api.runtime.lastError) {
                  console.warn("Fiverr Assistant: Error in periodic reload", api.runtime.lastError);
                } else {
                  console.log(`Fiverr Assistant: Successfully reloaded primary tab ${primaryTabId}`);
                }
              });
            } else {
              console.log(`Fiverr Assistant: Primary tab ${primaryTabId} is not a Fiverr URL, skipping periodic reload`);
            }
          }
        } catch (error) {
          console.warn("Fiverr Assistant: Primary tab not found for periodic reload", error);
          // Tab might have been closed, stop periodic reload
          stopPeriodicReload();
        }
      } catch (error) {
        console.warn("Fiverr Assistant: Error in periodic reload", error);
      }
    }, PERIODIC_RELOAD_INTERVAL_MS);
  };

  // Stop periodic reload
  const stopPeriodicReload = () => {
    if (periodicReloadIntervalId) {
      clearInterval(periodicReloadIntervalId);
      periodicReloadIntervalId = null;
      console.log("Fiverr Assistant: Stopped periodic reload");
    }
  };

  api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!changeInfo) {
      return;
    }
    
    // If tab finished loading and is a Fiverr tab, send settings update if auto-reload is enabled
    if (changeInfo.status === "complete" && tab && tab.url) {
      const url = tab.url;
      const isFiverrUrl =
        typeof url === "string" &&
        (url.startsWith("https://www.fiverr.com/") || url.startsWith("https://fiverr.com/"));
      
      // Check if this is an error page
      if (isErrorPage(url) && autoReloadEnabled) {
        // Reset counter on URL change (new page load)
        errorPageReloadAttempts.delete(tabId);
        // Wait a bit then check and reload if still error
        setTimeout(async () => {
          const isError = await checkTabForErrorPage(tabId);
          if (isError) {
            await reloadErrorPage(tabId);
          }
        }, 2000);
        return;
      }
      
      if (isFiverrUrl && autoReloadEnabled) {
        // Send all settings to content script to activate reloader
        sendAllSettingsToTab(tabId);
        
         // Check if this is the primary tab and pin it if needed
         storageGet([PRIMARY_TAB_ID_STORAGE_KEY]).then((result) => {
           const primaryTabId = result && result[PRIMARY_TAB_ID_STORAGE_KEY];
           if (primaryTabId === tabId || (!primaryTabId && tabId)) {
             // This is or should be the primary tab
             api.tabs.update(tabId, { pinned: true }, () => {
               if (!api.runtime.lastError && (!primaryTabId || primaryTabId !== tabId)) {
                 // Set as primary tab if not already set
                 storageSet({ [PRIMARY_TAB_ID_STORAGE_KEY]: tabId });
               }
             });
           }
         }).catch(() => {});
      }
    }
    
    // Original logic: if URL changed and it's not a Fiverr URL, schedule ensure
    if (changeInfo.url) {
    const url = changeInfo.url;
    const isFiverrUrl =
      typeof url === "string" &&
      (url.startsWith("https://www.fiverr.com/") || url.startsWith("https://fiverr.com/"));
    
    // Check if URL changed to an error page
    if (isErrorPage(url) && autoReloadEnabled) {
      errorPageReloadAttempts.delete(tabId);
      setTimeout(async () => {
        const isError = await checkTabForErrorPage(tabId);
        if (isError) {
          await reloadErrorPage(tabId);
        }
      }, 2000);
    }
    
    if (!isFiverrUrl && !isErrorPage(url)) {
      scheduleEnsureFiverrTab(200);
      }
    }
  });

  api.runtime.onStartup.addListener(() => {
    console.log("Fiverr Assistant: Browser startup detected");
    // Wait a bit for Firefox to restore tabs
    setTimeout(() => {
      refreshAutoReloadSetting().then(() => {
        checkAndActivateFiverrTab().then(() => {
          if (autoReloadEnabled) {
    scheduleEnsureFiverrTab(1000);
          }
        });
      });
    }, 1500);
  });

  api.runtime.onInstalled.addListener(() => {
    checkAndActivateFiverrTab().then(() => {
      if (autoReloadEnabled) {
    scheduleEnsureFiverrTab(1000);
      }
    });
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

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) {
      return false;
    }

    if (message.type === "getTabId") {
      const tabId =
        sender && sender.tab && typeof sender.tab.id === "number" ? sender.tab.id : null;
      sendResponse({ ok: typeof tabId === "number", tabId });
      return false;
    }

    if (message.type === "activateTab") {
      // Activate the primary Fiverr tab when new client message is detected
      storageGet([PRIMARY_TAB_ID_STORAGE_KEY]).then((result) => {
        const primaryTabId = result && result[PRIMARY_TAB_ID_STORAGE_KEY];
        if (primaryTabId && typeof primaryTabId === "number") {
          // Activate and focus the primary tab
          api.tabs.update(primaryTabId, { active: true }, () => {
            if (api.runtime.lastError) {
              console.warn("Fiverr Assistant: Error activating tab", api.runtime.lastError);
            } else {
              console.log(`Fiverr Assistant: Activated primary tab ${primaryTabId} for new client message`);
            }
          });
        } else {
          // No primary tab set, try to find any Fiverr tab
          api.tabs.query({ url: FIVERR_URL_PATTERNS }, (tabs) => {
            if (api.runtime.lastError) {
              console.warn("Fiverr Assistant: Error querying tabs", api.runtime.lastError);
              return;
            }
            if (Array.isArray(tabs) && tabs.length > 0 && typeof tabs[0].id === "number") {
              api.tabs.update(tabs[0].id, { active: true }, () => {
                if (api.runtime.lastError) {
                  console.warn("Fiverr Assistant: Error activating Fiverr tab", api.runtime.lastError);
                } else {
                  console.log(`Fiverr Assistant: Activated Fiverr tab ${tabs[0].id} for new client message`);
                }
              });
            }
          });
        }
      }).catch((error) => {
        console.warn("Fiverr Assistant: Error getting primary tab ID for activation", error);
      });
      sendResponse({ ok: true });
      return false;
    }

    if (message.type !== "fetchAudio") {
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
  // This runs when the extension loads (including browser startup)
  console.log("Fiverr Assistant: Background script initialized");
  console.log("Fiverr Assistant: Background script is running and ready for inspection");
  console.log("Fiverr Assistant: API available:", !!api, "Storage available:", !!storage);
  
  // For Firefox, wait a bit for tabs to be restored on startup
  const initDelay = hasBrowserAPI ? 1000 : 500;
  
  setTimeout(() => {
  refreshAutoReloadSetting()
      .then(() => {
        console.log("Fiverr Assistant: Auto-reload setting refreshed, checking for tabs...");
        // Check if any Fiverr tab exists, if not create one and activate reloader
        return checkAndActivateFiverrTab();
      })
    .then(() => {
      if (autoReloadEnabled) {
        scheduleEnsureFiverrTab(500);
      }
    })
      .catch((error) => {
        console.error("Fiverr Assistant: Error in initialization", error);
        // Even if refresh fails, check and activate
        checkAndActivateFiverrTab().then(() => {
      scheduleEnsureFiverrTab(500);
    });
      });
  }, initDelay);
  
  // Additional check after a longer delay to catch tabs restored later
  // This is especially important for Firefox which may restore tabs asynchronously
  setTimeout(() => {
    if (autoReloadEnabled) {
      console.log("Fiverr Assistant: Performing delayed startup check for Fiverr tabs...");
      checkAndActivateFiverrTab().then(() => {
        scheduleEnsureFiverrTab(500);
      }).catch((error) => {
        console.warn("Fiverr Assistant: Delayed startup check failed", error);
      });
    }
  }, 3000);

  // Keepalive mechanism to ensure background script stays active for debugging
  // This helps Firefox inspector attach properly
  let keepAliveInterval = setInterval(() => {
    // Just a no-op to keep the script context alive
    if (typeof console !== 'undefined' && console.log) {
      // Silent keepalive - only log if needed for debugging
      // console.log("Fiverr Assistant: Background script keepalive");
    }
  }, 30000); // Every 30 seconds

  // Store interval ID globally so it doesn't get garbage collected
  if (typeof globalThis !== 'undefined') {
    globalThis._farKeepAlive = keepAliveInterval;
  } else if (typeof self !== 'undefined') {
    self._farKeepAlive = keepAliveInterval;
  } else if (typeof window !== 'undefined') {
    window._farKeepAlive = keepAliveInterval;
  }
})();

