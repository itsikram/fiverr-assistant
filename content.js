(function () {
  const extensionStorage =
    typeof browser !== "undefined" && browser.storage && browser.storage.local ? browser.storage.local : null;
  const runtime = typeof browser !== "undefined" && browser.runtime ? browser.runtime : null;

  let siteDomain = window.location.hostname;
  let inboxUrl = "https://www.fiverr.com/inbox";
  let autoReload = true;
  var audioElement = false;
  var lastAction = Date.now();
  var isF10Clicked = false;
  var mailData = JSON.parse(localStorage.getItem("mailData")) || [];

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
        window.location.href = "https://www.fiverr.com/";
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
  });
  window.addEventListener("offline", () => {
    isOnline = false;
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
      });

      window.addEventListener("keydown", (event) => {
        lastAction = Date.now();

        if (event.code === "F8") {
          autoReload = false;
          alert("Fiverr Auto Reloader Disabled For 30 Muntes");
          setTimeout(() => {
            if (!isF10Clicked) {
              autoReload = true;
            }
          }, 1800000);
        }

        if (event.code === "F10") {
          alert("Fiverr Auto Reloader Turned Off");
          autoReload = false;
        }

        if (event.code === "F6") {
          // F6 key functionality removed - sendMail requires a target parameter
        }

        if (event.code === "F4") {
          let farContainer = document.getElementById("farContainer");
          if (farContainer) {
            farContainer.style.display = "block";
          } else {
            document.body.appendChild(modalContainer);
            modalContainer.style.display = "block";
          }
        }
      });

      const containerCss = {
        width: "680px",
        height: "550px",
        position: "absolute",
        top: "80px",
        left: "50%",
        transform: "translatex(-50%)",
        zIndex: "1000",
        backgroundColor: "#1DBF73",
        color: "darkblue",
        textAlign: "center",
        borderRadius: "10px",
        border: "2px solid darkblue",
        boxShadow: "2px 2px 10px rgba(0,0,0,0.3)",
        padding: "25px",
        overflowY: "scroll",
      };

      const titleCss = {
        color: "#fff",
        textAlign: "center",
        fontSize: "34px",
        marginBottom: "30px",
      };

      const definedUserInputCss = {
        width: "90%",
        margin: "auto",
        fontSize: "18px",
        marginBottom: "20px",
        padding: "10px",
      };

      const randomtimeEndInputCss = {
        width: "50px",
        display: "inline",
      };

      const randomTimeStartInputCss = {
        width: "50px",
        display: "inline",
      };

      const closeBtnCss = {
        width: "200px",
        margin: "auto",
        marginTop: "20px",
        backgroundColor: "red",
        color: "#fff",
        cursor: "pointer",
        border: "none",
        borderRadius: "5px",
        padding: "10px",
        textAlign: "center",
        fontSize: "18px",
        fontWeight: "bold",
        display: "block",
      };
      const gotoLinkInputCss = {
        width: "90%",
        margin: "auto",
        height: "250px",
        fontSize: "18px",
        marginBottom: "15px",
        padding: "5px",
      };

      let modalContainer = document.createElement("div");
      modalContainer.id = "farContainer";
      applyStyles(modalContainer, containerCss);

      const insertTitle = (title) => {
        let modalTitle = document.createElement("h4");
        applyStyles(modalTitle, titleCss);
        modalTitle.textContent = title;
        modalContainer.appendChild(modalTitle);
      };

      const insertInput = (id, label, defaultValue) => {
        if (defaultValue && localStorage.getItem(id) === null) {
          updateSetting(id, defaultValue);
        }

        let definedUserLabel = document.createElement("label");
        definedUserLabel.textContent = label;
        definedUserLabel.style.color = "#ffffff";
        definedUserLabel.style.display = "block";
        modalContainer.appendChild(definedUserLabel);

        let definedUserInput = document.createElement("input");
        let inputValue = getVal(id) || defaultValue || "";
        definedUserInput.value = inputValue;
        applyStyles(definedUserInput, definedUserInputCss);

        definedUserInput.addEventListener("keyup", function (e) {
          updateSetting(id, e.currentTarget.value);
          if (id === "targetedClients") {
            targetedClients = e.currentTarget.value;
          }
        });

        definedUserInput.addEventListener("change", function (e) {
          updateSetting(id, e.currentTarget.value);
          if (id === "targetedClients") {
            targetedClients = e.currentTarget.value;
          }
        });

        modalContainer.appendChild(definedUserInput);
      };

      const insertTextarea = (id, label = "Fiverr Pages links to redirected") => {
        let gotoLinkLabel = document.createElement("label");
        gotoLinkLabel.textContent = label;
        gotoLinkLabel.style.color = "white";
        gotoLinkLabel.style.display = "block";
        modalContainer.appendChild(gotoLinkLabel);

        let gotoLinkInput = document.createElement("textarea");
        gotoLinkInput.value = pageLinks.join(",");
        applyStyles(gotoLinkInput, gotoLinkInputCss);
        gotoLinkInput.addEventListener("change", function (e) {
          const value = e.currentTarget.value;
          updateSetting(id, value);
          pageLinks = processPageLinks(value);
        });

        modalContainer.appendChild(gotoLinkInput);
      };

      let randomTimeLabel = document.createElement("label");
      randomTimeLabel.textContent = "Random Time Start and End in Seconds: ";
      randomTimeLabel.style.color = "white";
      randomTimeLabel.style.display = "block";

      let randomTimeStartInput = document.createElement("input");
      randomTimeStartInput.value = minReloadingSecond;
      applyStyles(randomTimeStartInput, randomTimeStartInputCss);

      randomTimeStartInput.addEventListener("change", (e) => {
        const value = parseInt(e.currentTarget.value, 10) || minReloadingSecond;
        minReloadingSecond = value;
        updateSetting("relStart", String(value));
      });

      let randomtimeEndInput = document.createElement("input");
      randomtimeEndInput.value = maxReloadingSecond;
      applyStyles(randomtimeEndInput, randomtimeEndInputCss);
      randomtimeEndInput.addEventListener("change", (e) => {
        const value = parseInt(e.currentTarget.value, 10) || maxReloadingSecond;
        maxReloadingSecond = value;
        updateSetting("relEnd", String(value));
      });

      let closeBtn = document.createElement("button");
      closeBtn.textContent = "Close Console";
      applyStyles(closeBtn, closeBtnCss);
      closeBtn.addEventListener("click", () => {
        let farContainer = document.getElementById("farContainer");
        if (farContainer) {
          farContainer.style.display = "none";
        }
      });

      insertTitle("Fiverr Auto Reloader Console");
      insertInput("profile", "Fiverr Profile Name", "");
      insertInput("profileUsername", "Fiverr Profile Username", "");
      insertInput("targetedClients", "Put Usersame of your clients saperating by comma", "");

      insertTextarea("pageLinks", "Fiverr Pages links to redirected");

      insertInput("new_client_sound", "New Client Notification Sound", defaultSettings.new_client_sound);
      insertInput("targeted_client_sound", "Targeted Client Notification Sound", defaultSettings.targeted_client_sound);
      insertInput("old_client_sound", "Old Client Notification Sound", defaultSettings.old_client_sound);

      modalContainer.appendChild(randomTimeLabel);
      modalContainer.appendChild(randomTimeStartInput);
      modalContainer.appendChild(randomtimeEndInput);
      modalContainer.appendChild(closeBtn);

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
            autoReload = false;
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

        setInterval(() => {
          if (autoReload === true && isOnline) {
            const listLength = pageLinks.length;
            if (listLength === 0) {
              return;
            }
            let randomInt = Math.floor(Math.random() * listLength);
            let diffInSecond = (Date.now() - lastAction) / 1000;
            let goToLink = pageLinks[randomInt] || "/users/" + (getVal("profileUsername") || "") + "/seller_dashboard";

            let newLink = new URL("https://www.fiverr.com" + goToLink).toString();
            if (diffInSecond > 60) {
              return;
            }
            window.location.href = newLink;
          }
        }, getRandomMiliSecond(minReloadingSecond, maxReloadingSecond));
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

