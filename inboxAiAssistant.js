/**
 * Fiverr Assistant — Gemini inbox reply helper (content script module).
 *
 * SELECTORS — paste paths from DevTools if Fiverr changes the inbox DOM:
 * - INBOX_MESSAGE_LIST_SELECTOR / inboxMessageListSelector option: scroll/list root (default `.message-flow`).
 * - INBOX_MESSAGE_ROW_SELECTOR / inboxMessageRowSelector option: each chat row (default `.message-flow .message`).
 * Rows are classified as seller if the header shows “Me” or avatar `data-track-value` matches profile username.
 *
 * MODEL: `geminiModel` in options (default `gemini-2.5-flash`). Use a vision-capable model so buyer attachments (`.attachments-list`, secured Cloudinary URLs) are sent as images; text-only models get URLs in text only.
 */
(function () {
  "use strict";

  const GEMINI_CHAT_URL =
    "https://generativelanguage.googleapis.com/v1beta/models/";
  const MAX_TRANSCRIPT_CHARS = 12000;
  const CHAT_HISTORY_MAX_TURNS = 12;
  /** Max images sent per API call (buyer attachments + thread); avoids huge payloads */
  const MAX_THREAD_IMAGES = 10;
  /** Prevent reload for 5 minutes when modal is open */
  const MODAL_PROTECTION_DURATION = 5 * 60 * 1000; // 5 minutes
  const MODAL_PROTECTION_STORAGE_KEY = "farModalProtectionUntilTime";
  const OPENAI_KEY_INDEX_STORAGE_KEY = "farOpenAIKeyIndex";
  const OPENAI_FAILED_KEYS_STORAGE_KEY = "farOpenAIFailedKeys";
  const GEMINI_KEY_INDEX_STORAGE_KEY = "farGeminiKeyIndex";
  const GEMINI_FAILED_KEYS_STORAGE_KEY = "farGeminiFailedKeys";
  const SELECTED_MESSAGES_STORAGE_KEY = "farSelectedMessages";
  const MESSAGE_SELECTION_MODE_KEY = "farMessageSelectionMode";

  /**
   * Check if modal protection is currently active by reading from storage
   * @returns {Promise<boolean>}
   */
  async function isModalProtectionActive() {
    try {
      const result = await browser.storage.local.get(
        MODAL_PROTECTION_STORAGE_KEY,
      );
      const protectionTime = result && result[MODAL_PROTECTION_STORAGE_KEY];
      return protectionTime && Date.now() < parseInt(protectionTime, 10);
    } catch {
      return false;
    }
  }

  /**
   * Activate modal protection (prevents reload for 5 minutes)
   * @returns {Promise<void>}
   */
  async function activateModalProtection() {
    try {
      const protectionUntil = Date.now() + MODAL_PROTECTION_DURATION;
      await browser.storage.local.set({
        [MODAL_PROTECTION_STORAGE_KEY]: protectionUntil.toString(),
      });
      console.log(
        `Modal protection active for 5 minutes (until ${new Date(protectionUntil).toLocaleTimeString()})`,
      );
    } catch (error) {
      console.warn("Failed to activate modal protection:", error);
    }
  }

  /**
   * Deactivate modal protection
   * @returns {Promise<void>}
   */
  async function deactivateModalProtection() {
    try {
      await browser.storage.local.remove(MODAL_PROTECTION_STORAGE_KEY);
      console.log("Modal protection deactivated");
    } catch (error) {
      console.warn("Failed to deactivate modal protection:", error);
    }
  }

  // ============================================================================
  // OPENAI API KEY MANAGEMENT (Multiple Keys with Failover)
  // ============================================================================

  /**
   * Get the list of API keys as an array
   * @param {object} settings - Settings object from getSettings()
   * @returns {string[]} Array of API keys
   */
  function getApiKeyList(settings) {
    if (!settings || !settings.openaiApiKey) return [];
    const key = settings.openaiApiKey;
    // Handle both array and string formats
    if (Array.isArray(key)) {
      return key.filter((k) => k && String(k).trim().length > 0);
    }
    const keyStr = String(key || "").trim();
    if (keyStr.length === 0) return [];
    // Parse comma or newline separated
    return keyStr
      .split(/[\n,]/)
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
  }

  function getGeminiKeyList(settings) {
    if (!settings || !settings.geminiApiKey) return [];
    const key = settings.geminiApiKey;
    if (Array.isArray(key)) {
      return key.filter((k) => k && String(k).trim().length > 0);
    }
    const keyStr = String(key || "").trim();
    if (keyStr.length === 0) return [];
    return keyStr
      .split(/[\n,]/)
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
  }

  async function getCurrentGeminiKeyIndex() {
    try {
      const result = await browser.storage.local.get(
        GEMINI_KEY_INDEX_STORAGE_KEY,
      );
      return result && result[GEMINI_KEY_INDEX_STORAGE_KEY]
        ? parseInt(result[GEMINI_KEY_INDEX_STORAGE_KEY], 10)
        : 0;
    } catch (error) {
      console.warn("Failed to get Gemini key index:", error);
      return 0;
    }
  }

  async function setCurrentGeminiKeyIndex(index) {
    try {
      await browser.storage.local.set({
        [GEMINI_KEY_INDEX_STORAGE_KEY]: index,
      });
    } catch (error) {
      console.warn("Failed to set Gemini key index:", error);
    }
  }

  async function getFailedGeminiKeys() {
    try {
      const result = await browser.storage.local.get(
        GEMINI_FAILED_KEYS_STORAGE_KEY,
      );
      const failed = result && result[GEMINI_FAILED_KEYS_STORAGE_KEY];
      return new Set(Array.isArray(failed) ? failed : []);
    } catch (error) {
      console.warn("Failed to get Gemini failed keys:", error);
      return new Set();
    }
  }

  async function markGeminiKeyAsFailed(key) {
    try {
      const failed = await getFailedGeminiKeys();
      failed.add(key);
      await browser.storage.local.set({
        [GEMINI_FAILED_KEYS_STORAGE_KEY]: Array.from(failed),
      });
      console.log("Marked Gemini API key as failed, will try next key");
    } catch (error) {
      console.warn("Failed to mark Gemini key as failed:", error);
    }
  }

  async function clearFailedGeminiKeys() {
    try {
      await browser.storage.local.remove(GEMINI_FAILED_KEYS_STORAGE_KEY);
      console.log("Cleared Gemini failed keys list");
    } catch (error) {
      console.warn("Failed to clear Gemini failed keys:", error);
    }
  }

  /**
   * Get current API key index from storage
   * @returns {Promise<number>}
   */
  async function getCurrentKeyIndex() {
    try {
      const result = await browser.storage.local.get(
        OPENAI_KEY_INDEX_STORAGE_KEY,
      );
      return result && result[OPENAI_KEY_INDEX_STORAGE_KEY]
        ? parseInt(result[OPENAI_KEY_INDEX_STORAGE_KEY], 10)
        : 0;
    } catch (error) {
      console.warn("Failed to get key index:", error);
      return 0;
    }
  }

  /**
   * Set current API key index in storage
   * @param {number} index
   * @returns {Promise<void>}
   */
  async function setCurrentKeyIndex(index) {
    try {
      await browser.storage.local.set({
        [OPENAI_KEY_INDEX_STORAGE_KEY]: index,
      });
    } catch (error) {
      console.warn("Failed to set key index:", error);
    }
  }

  /**
   * Get list of failed API keys
   * @returns {Promise<Set<string>>}
   */
  async function getFailedKeys() {
    try {
      const result = await browser.storage.local.get(
        OPENAI_FAILED_KEYS_STORAGE_KEY,
      );
      const failed = result && result[OPENAI_FAILED_KEYS_STORAGE_KEY];
      return new Set(Array.isArray(failed) ? failed : []);
    } catch (error) {
      console.warn("Failed to get failed keys:", error);
      return new Set();
    }
  }

  /**
   * Mark an API key as failed
   * @param {string} key
   * @returns {Promise<void>}
   */
  async function markKeyAsFailed(key) {
    try {
      const failed = await getFailedKeys();
      failed.add(key);
      await browser.storage.local.set({
        [OPENAI_FAILED_KEYS_STORAGE_KEY]: Array.from(failed),
      });
      console.log("Marked API key as failed, will try next key");
    } catch (error) {
      console.warn("Failed to mark key as failed:", error);
    }
  }

  /**
   * Clear failed keys list (e.g., daily reset)
   * @returns {Promise<void>}
   */
  async function clearFailedKeys() {
    try {
      await browser.storage.local.remove(OPENAI_FAILED_KEYS_STORAGE_KEY);
      console.log("Cleared failed keys list");
    } catch (error) {
      console.warn("Failed to clear failed keys:", error);
    }
  }

  /**
   * Track OpenAI API call count for a specific key
   * @param {number} keyIndex - Index of the API key
   * @returns {Promise<void>}
   */
  async function trackOpenAICall(keyIndex) {
    try {
      const result = await browser.storage.local.get("farOpenAICallCounts");
      const counts =
        result && result.farOpenAICallCounts ? result.farOpenAICallCounts : {};
      const key = `key_${keyIndex}`;
      counts[key] = (counts[key] || 0) + 1;
      await browser.storage.local.set({ farOpenAICallCounts: counts });
      console.log(
        `[FAR API Usage] OpenAI Key ${keyIndex + 1} call count: ${counts[key]}`,
      );
    } catch (error) {
      console.warn("Failed to track OpenAI call:", error);
    }
  }

  /**
   * Track Gemini API call count
   * @returns {Promise<void>}
   */
  async function trackGeminiCall() {
    try {
      const result = await browser.storage.local.get("farGeminiCallCount");
      const count = ((result && result.farGeminiCallCount) || 0) + 1;
      await browser.storage.local.set({ farGeminiCallCount: count });
      console.log(`[FAR API Usage] Gemini call count: ${count}`);
    } catch (error) {
      console.warn("Failed to track Gemini call:", error);
    }
  }

  // ============================================================================
  // MESSAGE SELECTION FUNCTIONALITY (for AI context learning)
  // ============================================================================

  /**
   * Get list of selected messages
   * @returns {Promise<string[]>} Array of selected message texts
   */
  async function getSelectedMessages() {
    try {
      const result = await browser.storage.local.get(
        SELECTED_MESSAGES_STORAGE_KEY,
      );
      const selected = result && result[SELECTED_MESSAGES_STORAGE_KEY];
      return Array.isArray(selected) ? selected : [];
    } catch (error) {
      console.warn("Failed to get selected messages:", error);
      return [];
    }
  }

  /**
   * Add a message to the selected messages list
   * @param {string} messageText
   * @returns {Promise<void>}
   */
  async function selectMessage(messageText) {
    try {
      const selected = await getSelectedMessages();
      if (!selected.includes(messageText)) {
        selected.push(messageText);
        await browser.storage.local.set({
          [SELECTED_MESSAGES_STORAGE_KEY]: selected,
        });
      }
    } catch (error) {
      console.warn("Failed to select message:", error);
    }
  }

  /**
   * Remove a message from the selected messages list
   * @param {string} messageText
   * @returns {Promise<void>}
   */
  async function deselectMessage(messageText) {
    try {
      const selected = await getSelectedMessages();
      const filtered = selected.filter((msg) => msg !== messageText);
      await browser.storage.local.set({
        [SELECTED_MESSAGES_STORAGE_KEY]: filtered,
      });
    } catch (error) {
      console.warn("Failed to deselect message:", error);
    }
  }

  /**
   * Clear all selected messages
   * @returns {Promise<void>}
   */
  async function clearSelectedMessages() {
    try {
      await browser.storage.local.remove(SELECTED_MESSAGES_STORAGE_KEY);
      console.log("Cleared selected messages");
    } catch (error) {
      console.warn("Failed to clear selected messages:", error);
    }
  }

  /**
   * Format selected messages as learning examples for the AI prompt
   * @param {string[]} selectedMessages
   * @returns {string}
   */
  function formatSelectedMessagesAsExamples(selectedMessages) {
    if (!selectedMessages || selectedMessages.length === 0) {
      return "";
    }
    return (
      "\n\nREFERENCE MESSAGES YOU SELECTED TO LEARN FROM:\n" +
      selectedMessages.map((msg, i) => `${i + 1}. "${msg}"`).join("\n") +
      "\n\nUse these as examples to understand the tone, style, and what kinds of responses work for this buyer."
    );
  }

  /**
   * Toggle message selection mode on/off
   * @returns {Promise<boolean>} New mode state
   */
  async function toggleMessageSelectionMode() {
    try {
      const result = await browser.storage.local.get(
        MESSAGE_SELECTION_MODE_KEY,
      );
      const currentMode = result && result[MESSAGE_SELECTION_MODE_KEY];
      const newMode = !currentMode;
      await browser.storage.local.set({
        [MESSAGE_SELECTION_MODE_KEY]: newMode,
      });
      return newMode;
    } catch (error) {
      console.warn("Failed to toggle message selection mode:", error);
      return false;
    }
  }

  /**
   * Check if message selection mode is active
   * @returns {Promise<boolean>}
   */
  async function isMessageSelectionModeActive() {
    try {
      const result = await browser.storage.local.get(
        MESSAGE_SELECTION_MODE_KEY,
      );
      return result && result[MESSAGE_SELECTION_MODE_KEY] === true;
    } catch (error) {
      console.warn("Failed to check message selection mode:", error);
      return false;
    }
  }

  // ============================================================================
  // PINNED MESSAGES FUNCTIONALITY
  // ============================================================================
  const PINNED_MESSAGES_STORAGE_KEY = "farPinnedMessages";

  /**
   * Get all pinned messages for the current conversation
   * @returns {Promise<object[]>} Array of pinned message objects {text, role, timestamp}
   */
  async function getPinnedMessages() {
    try {
      const result = await browser.storage.local.get(
        PINNED_MESSAGES_STORAGE_KEY,
      );
      const pinned = result && result[PINNED_MESSAGES_STORAGE_KEY];
      return pinned ? JSON.parse(pinned) : [];
    } catch (error) {
      console.warn("Error getting pinned messages:", error);
      return [];
    }
  }

  /**
   * Add a message to the pinned messages list
   * @param {string} text - Message text
   * @param {string} role - "seller" or "buyer"
   * @returns {Promise<void>}
   */
  async function pinMessage(text, role) {
    try {
      const pinned = await getPinnedMessages();
      const exists = pinned.some((m) => m.text === text && m.role === role);
      if (!exists) {
        pinned.push({ text, role, timestamp: Date.now() });
        await browser.storage.local.set({
          [PINNED_MESSAGES_STORAGE_KEY]: JSON.stringify(pinned.slice(-10)), // Keep max 10 pinned
        });
        console.log(`Pinned message (${role}): ${text.substring(0, 50)}...`);
      }
    } catch (error) {
      console.warn("Error pinning message:", error);
    }
  }

  /**
   * Remove a message from the pinned messages list
   * @param {string} text - Message text
   * @param {string} role - "seller" or "buyer"
   * @returns {Promise<void>}
   */
  async function unpinMessage(text, role) {
    try {
      const pinned = await getPinnedMessages();
      const filtered = pinned.filter(
        (m) => !(m.text === text && m.role === role),
      );
      await browser.storage.local.set({
        [PINNED_MESSAGES_STORAGE_KEY]: JSON.stringify(filtered),
      });
      console.log(`Unpinned message (${role}): ${text.substring(0, 50)}...`);
    } catch (error) {
      console.warn("Error unpinning message:", error);
    }
  }

  /**
   * Check if a message is pinned
   * @param {string} text - Message text
   * @param {string} role - "seller" or "buyer"
   * @returns {Promise<boolean>}
   */
  async function isMessagePinned(text, role) {
    try {
      const pinned = await getPinnedMessages();
      return pinned.some((m) => m.text === text && m.role === role);
    } catch {
      return false;
    }
  }

  /**
   * Format pinned messages as examples for the AI prompt
   * @param {object[]} pinnedMessages - Array of pinned message objects
   * @returns {string} Formatted examples section for the prompt
   */
  function formatPinnedMessagesAsExamples(pinnedMessages) {
    if (!pinnedMessages || pinnedMessages.length === 0) {
      return "";
    }

    let examples = "\nREFERENCE EXAMPLES FROM YOUR PINNED MESSAGES:\n";
    examples += "(Study these to match your communication style)\n\n";

    pinnedMessages.forEach((msg, idx) => {
      examples += `Example ${idx + 1} (${msg.role}):\n`;
      examples += `"${msg.text}"\n\n`;
    });

    return examples;
  }

  /** @type {string} — list container; override in options or here if DevTools path changes */
  const INBOX_MESSAGE_LIST_SELECTOR = ".message-flow";
  /** @type {string} — message bubbles/rows; override in options or here */
  const INBOX_MESSAGE_ROW_SELECTOR = ".message-flow .message";

  /** Fiverr custom offer modal — paste from DevTools if `name` changes */
  const CUSTOM_OFFER_DESCRIPTION_TEXTAREA_SELECTOR =
    'textarea[name="custom_offer.description"]';

  const BASE_SYSTEM_PROMPT = [
    "You are an expert Fiverr seller crafting professional inbox replies that achieve 100% positive success scores.",
    "Write exactly like a TOP-PERFORMING HUMAN SELLER - warm, professional, and authentic. NEVER sound like AI or use templates.",
    "Write as if a real person typed this directly into Fiverr chat. Do not mention AI, automation, prompts, chatbots, or generated text.",
    "OUTPUT ONLY the final message text ready to paste into Fiverr. NO preamble. NO explanations. NO markdown. NO '[Your message]' placeholders.",
    "KEY RULES FOR THIS REPLY:",
    "1. BE CONCISE - Remove all unnecessary text. Every sentence must add value.",
    "2. MATCH THE BUYER'S TONE - Mirror their energy and formality level.",
    "3. BE SPECIFIC - Reference details from their message to show you read carefully.",
    "4. NO FILLER PHRASES - Avoid: 'I understand', 'I'd be happy to', 'Just to clarify', 'Thanks for reaching out'",
    "5. NO SALES LANGUAGE - Don't sound pitchy, don't use urgency tactics, don't oversell.",
    "6. NATURAL LANGUAGE - Use contractions naturally. Short, punchy sentences. Human rhythm.",
    "7. ONE CLEAR NEXT STEP - Tell them what happens next or what you need from them.",
    "Fiverr Success Optimization:",
    "- Response time: Prompt & attentive without seeming desperate",
    "- Professionalism: Perfect grammar, natural tone, confident",
    "- Clarity: Direct answers, one clear next step, no ambiguity",
    "- Trust: Expertise shown through substance not bragging",
    "What to AVOID:",
    "- AI patterns: 'I understand', 'I'd be happy to', 'let me know', 'I appreciate'",
    "- AI references: 'as an AI', 'AI assistant', 'generated', 'automated', 'chatbot', 'machine-generated'",
    "- Fluff: 'great project', 'amazing', 'awesome', 'perfect', generic praise",
    "- Formality: 'furthermore', 'henceforth', 'regarding', overly corporate",
    "- Invented details: fake prices, deadlines, package names not in thread",
    "- Multiple paragraphs: Keep it tight. One or two short paragraphs max.",
    "- Exclamation marks: Use 0-1 max, only if genuinely enthusiastic",
  ].join("\n");

  /** Task explanation (BN/EN) stays neutral—no sales voice */
  const TASK_SUMMARY_SYSTEM_PROMPT =
    "You are analyzing a Fiverr conversation to understand the buyer's requirements. " +
    "Summarize the buyer's request accurately and neutrally, focusing on their actual needs and expectations. " +
    "No selling, pitching, or persuasion - just clear understanding. " +
    "Output ONLY two labeled sections in this exact format (no text before BN):\n\nBN:\n<text in Bangla>\n\nEN:\n<text in English>\n\n";

  /** Communication analysis for Fiverr success score optimization */
  const COMMUNICATION_ANALYSIS_SYSTEM_PROMPT =
    "You are an expert Fiverr communication analyst specializing in success score optimization. " +
    "Analyze the conversation between seller and buyer to identify communication strengths, weaknesses, and specific improvement opportunities. " +
    "Focus on factors that directly impact Fiverr's success score: response time, professionalism, client satisfaction, communication clarity, and trust building. " +
    "Provide actionable, specific feedback that will help the seller achieve 100% positive success scores. " +
    "Output your analysis in these exact sections:\n\n" +
    "CURRENT COMMUNICATION STRENGTHS:\n<list what the seller is doing well>\n\n" +
    "COMMUNICATION MISTAKES TO FIX:\n<specific errors that could hurt success score>\n\n" +
    "IMPROVEMENT OPPORTUNITIES:\n<specific actionable suggestions to increase success score>\n\n" +
    "SUCCESS SCORE IMPACT PREDICTION:\n<how these changes would affect their success score>";

  function getSellerDisplayName(getSettings) {
    const s = getSettings();
    const n = (s && s.profile && String(s.profile).trim()) || "";
    return n || "Seller";
  }

  function getSellerUsername(getSettings) {
    const s = getSettings();
    return ((s && s.profileUsername) || "").trim().toLowerCase();
  }

  function resolveSelectors(getSettings) {
    const s = getSettings();
    const listSel =
      (s &&
        s.inboxMessageListSelector &&
        String(s.inboxMessageListSelector).trim()) ||
      INBOX_MESSAGE_LIST_SELECTOR;
    const rowSel =
      (s &&
        s.inboxMessageRowSelector &&
        String(s.inboxMessageRowSelector).trim()) ||
      INBOX_MESSAGE_ROW_SELECTOR;
    return { listSel, rowSel };
  }

  function isLikelyInboxAttachmentUrl(url) {
    if (!url || typeof url !== "string") return false;
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) return false;
    if (/favicon|emoji|gravatar|pixel|1x1|spacer|data:image/i.test(u))
      return false;
    return (
      /secured-attachments|messaging_message\/attachment|\/attachment\//i.test(
        u,
      ) ||
      /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(u) ||
      (/fiverr-res\.cloudinary\.com|cloudinary\.com/i.test(u) &&
        /\/image\//i.test(u))
    );
  }

  /**
   * Collect image URLs from a single inbox message row (buyer/seller attachments — not gig cards/avatars).
   * @param {Element} rowEl
   * @returns {string[]}
   */
  function extractImageUrlsFromMessageRow(rowEl) {
    const urls = [];
    const seen = new Set();
    const add = (raw) => {
      if (!raw) return;
      const u = String(raw).trim();
      if (!isLikelyInboxAttachmentUrl(u) || seen.has(u)) return;
      seen.add(u);
      urls.push(u);
    };

    rowEl.querySelectorAll(".attachments-list a[href]").forEach((a) => {
      add(a.getAttribute("href"));
    });
    rowEl.querySelectorAll(".attachments-list img[src]").forEach((img) => {
      add(img.getAttribute("src"));
    });

    rowEl
      .querySelectorAll(
        '.message-content img[src], [data-track-tag="box"] img[src]',
      )
      .forEach((img) => {
        const av = rowEl.querySelector('[data-track-tag="avatar"]');
        if (av && av.contains(img)) return;
        const lc = img.closest(
          '[data-track-tag="link_card"], .link_card, [data-testid="custom-offer"]',
        );
        if (lc) return;
        if (img.closest(".attachments-list")) return;
        const src = img.getAttribute("src");
        if (
          src &&
          /secured-attachments|messaging_message\/attachment/i.test(src)
        )
          add(src);
      });

    return urls;
  }

  /**
   * Gemini models that support vision capabilities
   */
  function modelSupportsVision(modelName) {
    const m = String(modelName || "")
      .toLowerCase()
      .trim();
    if (!m) return true;
    // Gemini 2.5 Flash and Pro models support vision
    if (/gemini-2\.5-(flash|pro)/.test(m)) return true;
    // Gemini 2.0 Flash models support vision
    if (/gemini-2\.0-flash/.test(m)) return true;
    // Gemini 1.5 Pro and Flash models support vision
    if (/gemini-1\.5-(pro|flash)/.test(m)) return true;
    return false;
  }

  /**
   * Gemini API supports the same image formats as OpenAI: PNG, JPEG, GIF, or WebP.
   */
  function isGeminiVisionSupportedImageUrl(url) {
    if (!url || typeof url !== "string") return false;
    const u = url.trim();
    if (!u) return false;
    const lower = u.toLowerCase();
    if (lower.startsWith("data:")) {
      return /^data:image\/(png|jpe?g|gif|webp)(;|,|\s)/i.test(u);
    }
    if (!/^https?:\/\//i.test(u)) return false;

    if (
      /\.(pdf|svgz?|bmp|tif|tiff|heic|heif|ico|avif|eps|psd|ai)(\?|#|$)/i.test(
        lower,
      )
    )
      return false;
    if (
      /\.(mp4|webm|mov|mkv|ogg|m4v|zip|rar|7z|doc|docx|xls|xlsx)(\?|#|$)/i.test(
        lower,
      )
    )
      return false;
    if (/cloudinary\.com\/[^/]*\/(raw|video)\//i.test(lower)) return false;
    if (/[/_]f_(pdf|svg|bmp|tiff|heif|heic|avif)([/_]|\.|$)/i.test(lower))
      return false;

    if (/\.(png|jpe?g|gif|webp)(\?|#|$)/i.test(lower)) return true;

    if (/cloudinary\.com/i.test(lower) && /\/image\//i.test(lower)) {
      if (/f_(jpe?g|png|gif|webp|auto)(?:[,/_]|$)/i.test(lower)) return true;
      if (/\/image\/upload\/[^?]*\.(png|jpe?g|gif|webp)(?:\?|$)/i.test(lower))
        return true;
      return false;
    }

    if (
      /secured-attachments|messaging_message\/attachment|\/attachment\//i.test(
        lower,
      )
    ) {
      return /\.(png|jpe?g|gif|webp)(\?|#|$)/i.test(lower);
    }

    return false;
  }

  /**
   * @param {string[]} urls
   * @returns {{ visionUrls: string[], skippedUrls: string[] }}
   */
  function partitionImageUrlsForVision(urls) {
    const visionUrls = [];
    const skippedUrls = [];
    const seen = new Set();
    for (let i = 0; i < urls.length; i++) {
      const raw = urls[i];
      if (!raw || seen.has(raw)) continue;
      seen.add(raw);
      if (isGeminiVisionSupportedImageUrl(raw)) visionUrls.push(raw);
      else skippedUrls.push(raw);
    }
    return { visionUrls, skippedUrls };
  }

  /**
   * Convert image URL to base64 data URI
   * @param {string} url
   * @returns {Promise<string|null>}
   */
  async function imageUrlToBase64(url) {
    try {
      const response = await fetch(url, { mode: "cors" });
      if (!response.ok) return null;

      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.warn("Failed to convert image URL to base64:", url, error);
      return null;
    }
  }

  /**
   * @param {string} text
   * @param {string[]} imageUrls
   * @param {() => object} getSettings
   * @returns {Promise<string|object[]>}
   */
  async function buildUserContentWithImages(text, imageUrls, getSettings) {
    const settings = getSettings();
    const model =
      (settings.geminiModel && String(settings.geminiModel).trim()) ||
      "gemini-2.5-flash";
    const urls = Array.from(new Set((imageUrls || []).filter(Boolean))).slice(
      0,
      MAX_THREAD_IMAGES,
    );

    // Check if image processing is disabled
    if (settings.disableImageProcessing) {
      if (urls.length > 0) {
        return {
          text:
            text +
            "\n\n[Image processing is currently disabled. Image URLs from the thread:]\n" +
            urls.map((u, i) => i + 1 + ". " + u).join("\n"),
        };
      }
      return { text };
    }

    if (urls.length === 0) {
      return { text };
    }

    const vision = modelSupportsVision(model);
    const note =
      "\n\nThe following image(s) are attachments from this Fiverr conversation (chronological). Use them when the buyer shared screenshots, errors, designs, or files.";

    if (!vision) {
      return {
        text:
          text +
          note +
          "\n\n[Your model may not support vision. Image URLs from the thread:]\n" +
          urls.map((u, i) => i + 1 + ". " + u).join("\n"),
      };
    }

    const { visionUrls, skippedUrls } = partitionImageUrlsForVision(urls);
    let baseText = text;
    if (skippedUrls.length > 0) {
      baseText +=
        "\n\n[These attachment URLs were not sent as vision images — the API only accepts PNG, JPEG, GIF, or WebP (e.g. PDF/SVG/other files are listed here for context only):]\n" +
        skippedUrls.map((u, i) => i + 1 + ". " + u).join("\n");
    }

    if (visionUrls.length === 0) {
      return { text: baseText };
    }

    const parts = [{ text: baseText + note }];

    // Convert image URLs to base64 for Gemini
    for (const url of visionUrls) {
      try {
        const base64Data = await imageUrlToBase64(url);
        if (base64Data) {
          // Extract mime type and base64 data
          const [mimeType, base64] = base64Data.split(",");
          const mimeMatch = mimeType.match(/data:([^;]+)/);
          const mimeTypeStr = mimeMatch ? mimeMatch[1] : "image/jpeg";

          parts.push({
            inline_data: {
              mime_type: mimeTypeStr,
              data: base64,
            },
          });
        } else {
          // Fallback to text if conversion fails
          parts.push({ text: `[Image: ${url}]` });
        }
      } catch (error) {
        console.warn("Failed to process image:", url, error);
        parts.push({ text: `[Image: ${url}]` });
      }
    }

    return { parts };
  }

  /**
   * Build chronological transcript: buyer / seller / unknown, text, optional time; collect attachment image URLs.
   * @param {() => object} getSettings
   * @returns {{ lines: string[], text: string, imageUrls: string[] }}
   */
  function buildInboxTranscript(getSettings) {
    const { listSel, rowSel } = resolveSelectors(getSettings);
    const sellerUser = getSellerUsername(getSettings);
    const scopeEl = document.querySelector(listSel);
    const rowSelParts = rowSel.trim().split(/\s+/);
    const rowRelative =
      rowSelParts.length > 1 ? rowSelParts.slice(1).join(" ") : rowSel;
    const rows = Array.from(
      scopeEl
        ? scopeEl.querySelectorAll(rowRelative)
        : document.querySelectorAll(rowSel),
    );
    const seen = new Set();
    let items = [];

    rows.forEach((el) => {
      const id = el.id || el.getAttribute("data-id") || "";
      const key = id || el.outerHTML.slice(0, 200);
      if (seen.has(key)) return;
      seen.add(key);

      let role = "unknown";
      const av = el.querySelector('[data-track-tag="avatar"]');
      const track = av && av.getAttribute("data-track-value");
      if (track && sellerUser && String(track).toLowerCase() === sellerUser) {
        role = "seller";
      } else {
        const header = el.querySelector(".header") || el;
        const ps = header.querySelectorAll('p[data-track-tag="typography"], p');
        for (let i = 0; i < ps.length; i++) {
          const t = (ps[i].textContent || "").trim();
          if (t === "Me") {
            role = "seller";
            break;
          }
          if (t && t.length > 0 && t !== "Me") {
            role = "buyer";
            break;
          }
        }
      }

      let timeStr = "";
      const tm = el.querySelector("time");
      if (tm) timeStr = (tm.textContent || "").trim();

      const body = el.querySelector(".message-content") || el;
      const textParts = [];
      body.querySelectorAll('p[data-track-tag="typography"]').forEach((p) => {
        const tx = (p.textContent || "").replace(/\s+/g, " ").trim();
        if (
          !tx ||
          /^(WE HAVE YOUR BACK|Learn more|This message relates to:|Translate to English)$/i.test(
            tx,
          ) ||
          tx.length < 2
        ) {
          return;
        }
        textParts.push(tx);
      });
      if (textParts.length === 0) {
        body.querySelectorAll("p").forEach((p) => {
          const tx = (p.textContent || "").replace(/\s+/g, " ").trim();
          if (tx && tx.length > 2 && tx.length < 8000) textParts.push(tx);
        });
      }
      const text = textParts.join("\n").trim();
      const images = extractImageUrlsFromMessageRow(el);
      if (!text && images.length === 0) return;

      const displayText =
        text || "(image attachment(s) only — no text in this message)";
      items.push({ role, timeStr, text: displayText, images });
    });

    let lines = items.map((it) => {
      const label =
        it.role === "seller"
          ? "seller"
          : it.role === "buyer"
            ? "buyer"
            : "unknown";
      const ts = it.timeStr ? ` [${it.timeStr}]` : "";
      let line = `[${label}]${ts}\n${it.text}`;
      if (it.images && it.images.length) {
        line += `\n[${it.images.length} image attachment(s) — also supplied to the model as images]`;
      }
      return line;
    });

    let joined = lines.join("\n\n");
    while (joined.length > MAX_TRANSCRIPT_CHARS && items.length > 1) {
      const drop = Math.max(1, Math.floor(items.length / 5));
      items = items.slice(drop);
      lines = items.map((it) => {
        const label =
          it.role === "seller"
            ? "seller"
            : it.role === "buyer"
              ? "buyer"
              : "unknown";
        const ts = it.timeStr ? ` [${it.timeStr}]` : "";
        let line = `[${label}]${ts}\n${it.text}`;
        if (it.images && it.images.length) {
          line += `\n[${it.images.length} image attachment(s) — also supplied to the model as images]`;
        }
        return line;
      });
      joined = lines.join("\n\n");
    }

    const imageUrls = [];
    const globalImgSeen = new Set();
    items.forEach((it) => {
      (it.images || []).forEach((u) => {
        if (!globalImgSeen.has(u)) {
          globalImgSeen.add(u);
          imageUrls.push(u);
        }
      });
    });
    const cappedUrls = imageUrls.slice(0, MAX_THREAD_IMAGES);

    return { lines, text: joined, imageUrls: cappedUrls };
  }

  /**
   * Role of the last visible inbox message row (chronological), or null if none.
   * @param {() => object} getSettings
   * @returns {"seller"|"buyer"|"unknown"|null}
   */
  function getLastInboxMessageRole(getSettings) {
    const { listSel, rowSel } = resolveSelectors(getSettings);
    const sellerUser = getSellerUsername(getSettings);
    const scopeEl = document.querySelector(listSel);
    const rowSelParts = rowSel.trim().split(/\s+/);
    const rowRelative =
      rowSelParts.length > 1 ? rowSelParts.slice(1).join(" ") : rowSel;
    const rows = Array.from(
      scopeEl
        ? scopeEl.querySelectorAll(rowRelative)
        : document.querySelectorAll(rowSel),
    );
    const seen = new Set();
    let lastRole = null;

    rows.forEach((el) => {
      const id = el.id || el.getAttribute("data-id") || "";
      const key = id || el.outerHTML.slice(0, 200);
      if (seen.has(key)) return;
      seen.add(key);

      let role = "unknown";
      const av = el.querySelector('[data-track-tag="avatar"]');
      const track = av && av.getAttribute("data-track-value");
      if (track && sellerUser && String(track).toLowerCase() === sellerUser) {
        role = "seller";
      } else {
        const header = el.querySelector(".header") || el;
        const ps = header.querySelectorAll('p[data-track-tag="typography"], p');
        for (let i = 0; i < ps.length; i++) {
          const t = (ps[i].textContent || "").trim();
          if (t === "Me") {
            role = "seller";
            break;
          }
          if (t && t.length > 0 && t !== "Me") {
            role = "buyer";
            break;
          }
        }
      }

      const body = el.querySelector(".message-content") || el;
      const textParts = [];
      body.querySelectorAll('p[data-track-tag="typography"]').forEach((p) => {
        const tx = (p.textContent || "").replace(/\s+/g, " ").trim();
        if (
          !tx ||
          /^(WE HAVE YOUR BACK|Learn more|This message relates to:|Translate to English)$/i.test(
            tx,
          ) ||
          tx.length < 2
        ) {
          return;
        }
        textParts.push(tx);
      });
      if (textParts.length === 0) {
        body.querySelectorAll("p").forEach((p) => {
          const tx = (p.textContent || "").replace(/\s+/g, " ").trim();
          if (tx && tx.length > 2 && tx.length < 8000) textParts.push(tx);
        });
      }
      const text = textParts.join("\n").trim();
      const images = extractImageUrlsFromMessageRow(el);
      if (!text && images.length === 0) return;

      lastRole = role;
    });

    return lastRole;
  }

  function isLastInboxMessageFromBuyer(getSettings) {
    return getLastInboxMessageRole(getSettings) === "buyer";
  }

  /**
   * Extract the seller's writing style from their previous messages
   * Analyzes: message length, tone, formality, punctuation, greeting/closing patterns
   * @param {() => object} getSettings
   * @returns {string} Writing style guide for AI
   */
  function extractSellerWritingStyle(getSettings) {
    const { listSel, rowSel } = resolveSelectors(getSettings);
    const sellerUser = getSellerUsername(getSettings);
    const scopeEl = document.querySelector(listSel);
    const rowSelParts = rowSel.trim().split(/\s+/);
    const rowRelative =
      rowSelParts.length > 1 ? rowSelParts.slice(1).join(" ") : rowSel;
    const rows = Array.from(
      scopeEl
        ? scopeEl.querySelectorAll(rowRelative)
        : document.querySelectorAll(rowSel),
    );

    const sellerMessages = [];
    const seen = new Set();

    // Extract all seller messages
    rows.forEach((el) => {
      const id = el.id || el.getAttribute("data-id") || "";
      const key = id || el.outerHTML.slice(0, 200);
      if (seen.has(key)) return;
      seen.add(key);

      let role = "unknown";
      const av = el.querySelector('[data-track-tag="avatar"]');
      const track = av && av.getAttribute("data-track-value");
      if (track && sellerUser && String(track).toLowerCase() === sellerUser) {
        role = "seller";
      } else {
        const header = el.querySelector(".header") || el;
        const ps = header.querySelectorAll('p[data-track-tag="typography"], p');
        for (let i = 0; i < ps.length; i++) {
          const t = (ps[i].textContent || "").trim();
          if (t === "Me") {
            role = "seller";
            break;
          }
        }
      }

      if (role !== "seller") return;

      const body = el.querySelector(".message-content") || el;
      const textParts = [];
      body.querySelectorAll('p[data-track-tag="typography"]').forEach((p) => {
        const tx = (p.textContent || "").replace(/\s+/g, " ").trim();
        if (
          !tx ||
          /^(WE HAVE YOUR BACK|Learn more|This message relates to:|Translate to English)$/i.test(
            tx,
          ) ||
          tx.length < 2
        )
          return;
        textParts.push(tx);
      });
      if (textParts.length === 0) {
        body.querySelectorAll("p").forEach((p) => {
          const tx = (p.textContent || "").replace(/\s+/g, " ").trim();
          if (tx && tx.length > 2 && tx.length < 8000) textParts.push(tx);
        });
      }
      const text = textParts.join("\n").trim();
      if (text) sellerMessages.push(text);
    });

    if (sellerMessages.length === 0) {
      return ""; // No seller messages to analyze
    }

    // Analyze writing patterns
    const avgLength = Math.round(
      sellerMessages.reduce((sum, msg) => sum + msg.length, 0) /
        sellerMessages.length,
    );
    const exclamationCount = sellerMessages.reduce(
      (sum, msg) => sum + (msg.match(/!/g) || []).length,
      0,
    );
    const questionCount = sellerMessages.reduce(
      (sum, msg) => sum + (msg.match(/\?/g) || []).length,
      0,
    );
    const ellipsisCount = sellerMessages.reduce(
      (sum, msg) => sum + (msg.match(/\.\.\./g) || []).length,
      0,
    );
    const hasShortMessages = sellerMessages.some((msg) => msg.length < 100);
    const hasLongMessages = sellerMessages.some((msg) => msg.length > 400);

    // Detect formality level
    const formalWords =
      sellerMessages
        .join(" ")
        .match(
          /\b(regarding|therefore|henceforth|furthermore|nonetheless|furthermore)\b/gi,
        ) || [];
    const casualWords =
      sellerMessages
        .join(" ")
        .match(/\b(gonna|wanna|kinda|sorta|yeah|cool|awesome|amazing)\b/gi) ||
      [];
    const contractionsCount =
      sellerMessages
        .join(" ")
        .match(
          /\b(I'm|you're|it's|don't|won't|can't|isn't|that's|we're|they're)\b/gi,
        ) || [];

    const isFormal = formalWords.length > casualWords.length;
    const isConversational = contractionsCount.length > 2;

    // Extract greetings and closings
    const greetings = sellerMessages
      .map((msg) => {
        const match = msg.match(
          /^(Hi|Hello|Hey|Thanks|Thank you|Thanks for|Hi there|Good morning|Good afternoon|Good evening)/i,
        );
        return match ? match[1] : null;
      })
      .filter(Boolean);

    const closings = sellerMessages
      .map((msg) => {
        const match = msg.match(
          /(Best|Cheers|Thanks|Thank you|Regards|Respectfully|Talk soon|Look forward|Let me know|Feel free to|Reach out|Get back to|Hope that helps)[,.]?$/i,
        );
        return match ? match[1] : null;
      })
      .filter(Boolean);

    // Build style guide
    let styleGuide =
      "SELLER'S WRITING STYLE (learn from their past messages):\n";
    styleGuide += `- Message length: ${avgLength > 300 ? "Detailed & thorough" : avgLength > 100 ? "Moderate" : "Brief & concise"}\n`;
    styleGuide += `- Punctuation: ${exclamationCount > sellerMessages.length * 0.5 ? "Uses exclamation marks frequently" : exclamationCount > 0 ? "Uses exclamation marks occasionally" : "Rarely uses exclamation marks"}\n`;
    styleGuide += `- Questions: ${questionCount > sellerMessages.length * 0.3 ? "Asks many questions" : questionCount > 0 ? "Asks some questions" : "Rarely asks questions"}\n`;
    styleGuide += `- Formality: ${isFormal ? "Formal & professional" : "Conversational & friendly"}\n`;
    styleGuide += `- Contractions: ${isConversational ? "Uses natural contractions (I'm, don't, etc.)" : "Avoids contractions"}\n`;
    styleGuide += `- Variety: ${hasShortMessages && hasLongMessages ? "Mixes short and long messages" : hasLongMessages ? "Writes longer messages" : "Writes concise messages"}\n`;

    if (greetings.length > 0) {
      const mostCommonGreeting = greetings
        .sort(
          (a, b) =>
            greetings.filter((x) => x === a).length -
            greetings.filter((x) => x === b).length,
        )
        .pop();
      styleGuide += `- Greeting preference: "${mostCommonGreeting}"\n`;
    }

    if (closings.length > 0) {
      const mostCommonClosing = closings
        .sort(
          (a, b) =>
            closings.filter((x) => x === a).length -
            closings.filter((x) => x === b).length,
        )
        .pop();
      styleGuide += `- Closing preference: "${mostCommonClosing}"\n`;
    }

    styleGuide += "\nREPLY GUIDELINES:\n";
    styleGuide +=
      "- Match this exact writing style, tone, and patterns above\n";
    styleGuide += "- Don't add extra explanations or unnecessary text\n";
    styleGuide +=
      "- Write as if you (the seller) are replying - authentic and direct\n";
    styleGuide +=
      "- NO preamble, NO placeholder text, NO '[Your message here]'\n";
    styleGuide += "- Output ONLY the reply message ready to paste as-is\n";

    return styleGuide;
  }

  /**
   * Analyze task description and estimate appropriate cost range based on complexity
   * @param {string} transcript - The conversation text
   * @returns {string} - Estimated cost message to include in prompt
   */
  function analyzeTaskAndEstimateCost(transcript) {
    const lowerText = transcript.toLowerCase();

    // Define complexity indicators and their weight
    const complexityIndicators = {
      // High complexity (advanced/technical)
      high: [
        "api",
        "integration",
        "database",
        "backend",
        "architecture",
        "custom code",
        "ecommerce",
        "mobile app",
        "machine learning",
        "ai model",
        "deep learning",
        "scalability",
        "performance optimization",
        "security audit",
        "complex design",
        "wordpress plugin",
        "custom theme",
        "seo optimization",
        "marketing strategy",
      ],
      // Medium complexity
      medium: [
        "web design",
        "logo",
        "branding",
        "copywriting",
        "content",
        "social media",
        "video editing",
        "photography",
        "graphic design",
        "ui design",
        "ux design",
        "translation",
        "proofreading",
        "email marketing",
        "seo",
      ],
      // Low complexity (simple tasks)
      low: [
        "small task",
        "quick fix",
        "simple",
        "basic",
        "quick turnaround",
        "one page",
        "simple edit",
        "minor",
        "short article",
      ],
    };

    // Count complexity indicators
    let highCount = 0,
      mediumCount = 0,
      lowCount = 0;

    complexityIndicators.high.forEach((indicator) => {
      if (lowerText.includes(indicator)) highCount++;
    });

    complexityIndicators.medium.forEach((indicator) => {
      if (lowerText.includes(indicator)) mediumCount++;
    });

    complexityIndicators.low.forEach((indicator) => {
      if (lowerText.includes(indicator)) lowCount++;
    });

    // Check for urgency/timeline
    const hasUrgency =
      /urgent|asap|today|tomorrow|within (hours|day)|rush/.test(lowerText);
    const hasRevisions =
      /unlimited revisions|multiple revisions|revision|changes|adjustments/.test(
        lowerText,
      );
    const hasTimeline = /weeks|months|days|deadline|timeline|schedule/.test(
      lowerText,
    );

    // Estimate complexity level
    let complexityLevel = "medium";
    let estimateRange = "$100-300";

    if (highCount >= 2) {
      complexityLevel = "high";
      estimateRange = hasUrgency ? "$300-1000+" : "$200-800";
    } else if (mediumCount >= 2) {
      complexityLevel = "medium";
      estimateRange = hasUrgency ? "$150-500" : "$100-400";
    } else if (lowCount >= 2) {
      complexityLevel = "low";
      estimateRange = hasUrgency ? "$50-150" : "$25-100";
    }

    // Adjust for revisions and urgency
    if (hasRevisions) {
      estimateRange += " (+revisions)";
    }
    if (hasUrgency) {
      estimateRange += " (rush)";
    }

    // Create estimation context for the AI
    return `\n\nTask Complexity Analysis (for your reference, don't mention in message):\n- Complexity: ${complexityLevel}\n- Estimated range: ${estimateRange}\n- Has timeline: ${hasTimeline ? "yes" : "no"}\n- Mentions revisions: ${hasRevisions ? "yes" : "no"}\n- Seems urgent: ${hasUrgency ? "yes" : "no"}\n\nProvide a pricing message that fits this scope. Be specific with numbers if possible, and explain what's included.`;
  }

  function buildPresetUserText(kind, transcript, getSettings, opts) {
    const costPrice =
      (opts && opts.costPrice && String(opts.costPrice).trim()) || "";
    const sellerName = getSellerDisplayName(getSettings);

    switch (kind) {
      case "first":
        const selectedMessages = (opts && opts.selectedMessages) || [];
        const selectedContext =
          selectedMessages.length > 0
            ? "\n\nREFERENCE EXAMPLES FROM YOUR SELECTED MESSAGES:\n" +
              selectedMessages
                .map((msg, i) => `${i + 1}. "${msg}"`)
                .join("\n") +
              "\n\nStudy these messages to understand the tone, communication style, and what resonates with this specific buyer. Match this energy and style."
            : "";

        return (
          "Buyer's first message in this thread:\n" +
          transcript +
          selectedContext +
          "\n\n" +
          "Write an authentic, professional first response that:" +
          "\n1. Shows genuine interest in their specific project (reference details they mentioned)\n" +
          "2. Demonstrates expertise without sounding arrogant\n" +
          "3. Addresses a key concern or question they have\n" +
          "4. Uses natural language with contractions (I'm, you'll, etc.) - sounds like a real person\n" +
          "5. Ends with a clear next step: ask 1-2 focused questions about their requirements\n" +
          "6. Keeps it concise (2-3 short paragraphs, not a wall of text)\n" +
          "7. Shows personality but stays professional - warm without being overly casual\n" +
          "\n" +
          "AVOID: Generic welcomes, fluff phrases like 'I understand' or 'I'd be happy to', promises without context, or asking vague questions.\n" +
          "Do not mention AI, automation, or that this reply is generated. Write as if you are a real seller responding directly.\n" +
          "\n" +
          "Start directly with substance - make them feel like you actually read their message and care about their success."
        );
      case "reply":
        return (
          "Recent conversation with this buyer:\n" +
          transcript +
          "\n\nWrite a natural, conversational reply to their last message. Reference specific details they mentioned to show you're paying attention. Be helpful and professional but not formal - like talking to a colleague. Use contractions naturally (I'm, you'll, etc.). If they have questions, answer them directly. If they're sharing progress or feedback, respond appropriately. Keep it flowing like a real conversation.\n\nDo not mention AI, automation, or that the message was generated. Write as if you are the seller replying personally."
        );
      case "clarify":
        return (
          "Conversation so far:\n" +
          transcript +
          "\n\nWrite a message asking for clarification in a natural way. Frame it positively - 'To make sure I deliver exactly what you need...' or 'Just want to understand a couple of things better...'. Ask 2-3 specific questions that show you're thinking through their project. Don't make it sound like an interrogation - more like you're genuinely trying to get it right for them.\n\nDo not mention AI, automation, or that this message was generated. Make it sound like a direct, human follow-up from the seller."
        );
      case "cost":
        // Use manual price if provided, otherwise analyze task for estimate
        const costContext = costPrice
          ? "\n\nSeller's specific price to mention: " + costPrice
          : analyzeTaskAndEstimateCost(transcript);

        return (
          "Conversation:\n" +
          transcript +
          costContext +
          "\n\nWrite a natural message about pricing based on the task complexity and scope. Don't sound like a salesperson - more like a professional discussing costs. State your price confidently and explain what it includes (deliverables, timeline, revisions, etc.). Frame pricing around value and results, not just numbers. Be transparent about what's included. Make it feel like a business discussion, not a sales pitch. If the estimate range is provided, pick a reasonable number within or adjusted for the scope.\n\nDo not mention AI, automation, or that this message was generated. Write as if you are the seller directly responding to the client."
        );
      case "cursorPrompt":
        return (
          "The following is a conversation from a client asking for software work. Act as a professional software engineer writing a Cursor AI prompt for an engineering assistant. Focus on technical clarity, implementation approach, and requirements, not buyer-facing sales language.\n\n" +
          "Conversation:\n" +
          transcript +
          "\n\nCreate a concise engineering prompt for Cursor AI that includes:\n" +
          "- a summary of the project goals and constraints\n" +
          "- key technical tasks and implementation steps\n" +
          "- relevant technologies, architecture, and integration points\n" +
          "- any important edge cases, performance considerations, or delivery notes\n" +
          "Write it as a prompt for an engineer-focused AI assistant, using professional software engineering language. Do not write the final buyer message; write the prompt that guides the engineering agent. Avoid prompt-style phrasing that sounds like a machine instruction; keep it clear, concise, and written like an engineer describing the task."
        );
      default:
        return transcript;
    }
  }

  /**
   * Enable or disable message selection mode in the conversation
   * @param {boolean} enable
   */
  function setMessageSelectionMode(enable) {
    const { listSel, rowSel } = resolveSelectors();
    const scopeEl = document.querySelector(listSel);
    const rowSelParts = rowSel.trim().split(/\s+/);
    const rowRelative =
      rowSelParts.length > 1 ? rowSelParts.slice(1).join(" ") : rowSel;
    const messageRows = Array.from(
      scopeEl
        ? scopeEl.querySelectorAll(rowRelative)
        : document.querySelectorAll(rowSel),
    );

    if (enable) {
      console.log("Message selection mode ENABLED");
      // Add hover handlers and select buttons to each message
      messageRows.forEach((row) => {
        if (row.dataset.farSelectionEnabled) return; // Already enabled

        row.style.position = "relative";

        // Extract message text
        const textParts = [];
        const header = row.querySelector(".header") || row;
        header
          .querySelectorAll('p[data-track-tag="typography"]')
          .forEach((p) => {
            const tx = (p.textContent || "").replace(/\s+/g, " ").trim();
            if (
              tx &&
              !/^(WE HAVE YOUR BACK|Learn more|This message relates to:|Translate to English|Me)$/i.test(
                tx,
              ) &&
              tx.length > 2
            ) {
              textParts.push(tx);
            }
          });
        const messageText = textParts.join("\n").trim();

        if (!messageText) return; // Skip empty messages

        row.dataset.farSelectionEnabled = "true";
        row.dataset.messageText = messageText;

        // Create select button that appears on hover
        const selectBtn = document.createElement("button");
        selectBtn.type = "button";
        selectBtn.className = "far-ia-select-msg-btn";
        selectBtn.textContent = "📌 Select";
        selectBtn.style.cssText = `
          position: absolute;
          top: 8px;
          right: 8px;
          padding: 6px 10px;
          background: white;
          border: 1px solid #ddd;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          display: none;
          z-index: 10;
          white-space: nowrap;
        `;
        row.appendChild(selectBtn);

        // Show/hide button on hover
        row.addEventListener("mouseenter", () => {
          selectBtn.style.display = "block";
        });
        row.addEventListener("mouseleave", () => {
          selectBtn.style.display = "none";
        });

        // Handle select button click
        selectBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const isSelected = row.dataset.farSelected === "true";

          if (isSelected) {
            // Deselect
            row.dataset.farSelected = "false";
            row.style.background = "transparent";
            selectBtn.textContent = "📌 Select";
            selectBtn.style.background = "white";
            selectBtn.style.color = "#333";
            await deselectMessage(messageText);
          } else {
            // Select
            row.dataset.farSelected = "true";
            row.style.background = "#e6f9f0";
            selectBtn.textContent = "✓ Selected";
            selectBtn.style.background = "#1dbf73";
            selectBtn.style.color = "white";
            selectBtn.style.borderColor = "#1dbf73";
            await selectMessage(messageText);
          }
        });
      });
    } else {
      console.log("Message selection mode DISABLED");
      // Keep selection UI but just don't highlight, since we want persistent selection
      messageRows.forEach((row) => {
        const selectBtn = row.querySelector(".far-ia-select-msg-btn");
        if (selectBtn) selectBtn.remove();
        row.style.background = "transparent";
        delete row.dataset.farSelectionEnabled;
      });
    }
  }

  /**
   * Initialize message selection UI for all messages (always available on hover)
   * This is called on page load to set up selection for all existing messages
   */
  async function initializeMessageSelection() {
    // Use default selectors directly to avoid needing getSettings
    const listSel = INBOX_MESSAGE_LIST_SELECTOR; // ".message-flow"
    const rowSel = INBOX_MESSAGE_ROW_SELECTOR; // ".message-flow .message"

    const scopeEl = document.querySelector(listSel);
    if (!scopeEl) {
      console.log(
        "[FAR] Message flow container not found - trying alternate selectors",
      );
      // Try alternate selector
      const alternates = [
        ".message-list",
        ".messages",
        "[data-track-tag='message_list']",
      ];
      for (const alt of alternates) {
        const alt_el = document.querySelector(alt);
        if (alt_el) {
          console.log("[FAR] Found messages using alternate selector:", alt);
          break;
        }
      }
      return;
    }

    const rowSelParts = rowSel.trim().split(/\s+/);
    const rowRelative =
      rowSelParts.length > 1 ? rowSelParts.slice(1).join(" ") : rowSel;
    const messageRows = Array.from(
      scopeEl
        ? scopeEl.querySelectorAll(rowRelative)
        : document.querySelectorAll(rowSel),
    );

    console.log(`[FAR] Found ${messageRows.length} messages to initialize`);

    // Get already selected messages
    const selectedMessages = await getSelectedMessages();
    const selectedSet = new Set(selectedMessages);

    let initializedCount = 0;
    messageRows.forEach((row, idx) => {
      if (row.dataset.farInitialized) return; // Already initialized

      // Extract message text
      const textParts = [];
      const header = row.querySelector(".header") || row;
      header.querySelectorAll('p[data-track-tag="typography"]').forEach((p) => {
        const tx = (p.textContent || "").replace(/\s+/g, " ").trim();
        if (
          tx &&
          !/^(WE HAVE YOUR BACK|Learn more|This message relates to:|Translate to English|Me)$/i.test(
            tx,
          ) &&
          tx.length > 2
        ) {
          textParts.push(tx);
        }
      });
      const messageText = textParts.join("\n").trim();

      if (!messageText) {
        console.log(`[FAR] Message ${idx} has no text content, skipping`);
        return; // Skip empty messages
      }

      row.dataset.farInitialized = "true";
      row.dataset.messageText = messageText;

      // Check if this message was previously selected
      if (selectedSet.has(messageText)) {
        row.dataset.farSelected = "true";
        row.style.background = "#e6f9f0";
      }

      // Find the actions button container (the one with the three dots menu)
      const actionsBtnContainer = row.querySelector(
        '[data-track-tag="popover_anchor"]',
      );
      if (!actionsBtnContainer) {
        console.log(`[FAR] Message ${idx} has no actions button, skipping`);
        return;
      }

      // Create select button that appears on hover
      const selectBtn = document.createElement("button");
      selectBtn.type = "button";
      selectBtn.className = "far-ia-select-msg-btn";
      selectBtn.setAttribute("data-track-tag", "icon_button");
      selectBtn.textContent =
        row.dataset.farSelected === "true" ? "✓ Selected" : "📌 Select";
      selectBtn.style.cssText = `
        padding: 6px 10px;
        background: ${row.dataset.farSelected === "true" ? "#1dbf73" : "white"};
        color: ${row.dataset.farSelected === "true" ? "white" : "#333"};
        border: 1px solid ${row.dataset.farSelected === "true" ? "#1dbf73" : "#ddd"};
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        display: none;
        white-space: nowrap;
        margin-right: 8px;
      `;

      // Insert button before the actions button container
      actionsBtnContainer.parentNode.insertBefore(
        selectBtn,
        actionsBtnContainer,
      );
      console.log(
        `[FAR] Created select button for message ${idx}: "${messageText.substring(0, 30)}..."`,
      );
      initializedCount++;

      // Show/hide button on hover (hover on message row)
      row.addEventListener("mouseenter", () => {
        selectBtn.style.display = "block";
      });
      row.addEventListener("mouseleave", () => {
        selectBtn.style.display = "none";
      });

      // Handle select button click
      selectBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const isSelected = row.dataset.farSelected === "true";

        if (isSelected) {
          // Deselect
          row.dataset.farSelected = "false";
          row.style.background = "transparent";
          selectBtn.textContent = "📌 Select";
          selectBtn.style.background = "white";
          selectBtn.style.color = "#333";
          selectBtn.style.borderColor = "#ddd";
          await deselectMessage(messageText);
        } else {
          // Select
          row.dataset.farSelected = "true";
          row.style.background = "#e6f9f0";
          selectBtn.textContent = "✓ Selected";
          selectBtn.style.background = "#1dbf73";
          selectBtn.style.color = "white";
          selectBtn.style.borderColor = "#1dbf73";
          await selectMessage(messageText);
        }
      });
    });

    console.log(
      `[FAR] Successfully initialized ${initializedCount} messages with select buttons`,
    );

    // Set up MutationObserver to reinitialize when new messages are added
    const messageFlow = document.querySelector(INBOX_MESSAGE_LIST_SELECTOR);
    if (messageFlow && !messageFlow.dataset.farMutationObserverActive) {
      messageFlow.dataset.farMutationObserverActive = "true";
      const observer = new MutationObserver(() => {
        // Debounce: wait 500ms after last mutation before reinitializing
        clearTimeout(window.farInitTimeout);
        window.farInitTimeout = setTimeout(() => {
          console.log(
            "[FAR] New messages detected, reinitializing selection UI",
          );
          initializeMessageSelection().catch((err) =>
            console.warn("Failed to reinitialize message selection:", err),
          );
        }, 500);
      });

      observer.observe(messageFlow, {
        childList: true,
        subtree: true,
        attributes: false,
      });
      console.log("[FAR] MutationObserver set up to watch for new messages");
    }
  }

  async function generateCommunicationAnalysis(getSettings) {
    const sellerName = getSellerDisplayName(getSettings);
    const { text: transcript, imageUrls } = buildInboxTranscript(getSettings);

    if (!transcript || transcript.trim().length === 0) {
      return "No conversation found to analyze. Please start a conversation with a buyer first.";
    }

    const userContent = await buildUserContentWithImages(
      "Fiverr conversation to analyze for communication optimization and success score improvement:\n\n" +
        transcript,
      imageUrls,
      getSettings,
    );

    return generateWithAI(
      getSettings,
      [
        { role: "system", content: COMMUNICATION_ANALYSIS_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      { temperature: 0.3 },
    );
  }

  /**
   * @param {string} kind preset id (e.g. "first")
   * @param {() => object} getSettings
   * @returns {Promise<string>}
   */
  async function generatePresetReply(kind, getSettings) {
    const sellerName = getSellerDisplayName(getSettings);
    const sellerStyle = extractSellerWritingStyle(getSettings);
    const pinnedMessages = await getPinnedMessages();

    let sys = BASE_SYSTEM_PROMPT;

    // Add pinned messages as examples for reference
    if (pinnedMessages && pinnedMessages.length > 0) {
      sys += formatPinnedMessagesAsExamples(pinnedMessages);
    }

    if (sellerStyle) {
      sys += "\n\n" + sellerStyle;
    }
    sys += "\nSeller display name (use when natural): " + sellerName;

    // Enhance first message with special instructions
    if (kind === "first") {
      sys += "\n\nFIRST MESSAGE SPECIAL INSTRUCTIONS:\n";
      sys +=
        "- This is your FIRST response to this buyer - make a strong professional impression\n";
      sys +=
        "- Show enthusiasm about their project WITHOUT sounding fake or desperate\n";
      sys +=
        "- Demonstrate you understand their requirements by referencing specific details they mentioned\n";
      sys +=
        "- Keep it concise (2-3 short paragraphs max) - respect their time\n";
      sys +=
        "- End with 1-2 specific, relevant questions that show you've thought about their project\n";
      sys +=
        "- DO NOT include pricing, packages, or generic service info in first message\n";
      sys +=
        "- Sound like a skilled professional who is selective about projects, not desperate for work\n";
      sys +=
        "- If they mentioned timeline/budget, acknowledge it to show you're listening\n";
    }

    const { text: transcript, imageUrls } = buildInboxTranscript(getSettings);
    const userText = buildPresetUserText(kind, transcript, getSettings, {
      costPrice: "",
    });
    const userContent = await buildUserContentWithImages(
      userText,
      imageUrls,
      getSettings,
    );
    return generateWithAI(
      getSettings,
      [
        { role: "system", content: sys },
        { role: "user", content: userContent },
      ],
      { temperature: kind === "first" ? 0.5 : 0.45 },
    );
  }

  function stripFencesAndPreamble(text) {
    if (!text || typeof text !== "string") return "";
    let t = text.trim();
    t = t.replace(/^```[a-z]*\s*/i, "").replace(/\s*```\s*$/i, "");
    return t.trim();
  }

  function mapGeminiError(status, bodySnippet) {
    if (status === 400) {
      if (
        bodySnippet &&
        /location.*not.*supported|not.*available.*location|geographic|region.*not.*support/i.test(
          bodySnippet,
        )
      ) {
        return (
          "Geographic restriction (400). Your location/country is not supported for Gemini API access.\n\n" +
          "SOLUTIONS:\n" +
          "1. Use a VPN to connect from a supported country (US, UK, Canada, etc.)\n" +
          "2. If using VPN, make sure it's working properly and not exposing your real IP\n" +
          "3. Try a different Gemini model or use a different API (Claude, ChatGPT, etc.)\n" +
          "4. Check if your ISP blocks the API - try with mobile hotspot\n\n" +
          "Visit: https://cloud.google.com/generative-ai/docs/availability for supported regions."
        );
      }
      if (bodySnippet && /api.key.invalid/i.test(bodySnippet)) {
        return "Invalid API key (400). The API key doesn't exist or was revoked. Get a new key from https://aistudio.google.com/app/apikey";
      }
      if (bodySnippet && /permission.denied/i.test(bodySnippet)) {
        return "Permission denied (400). This API key doesn't have access to the Gemini API. Enable it at https://aistudio.google.com/app/apikey";
      }
      if (bodySnippet && /model.not.found/i.test(bodySnippet)) {
        return "Model not found (400). Try a different model like 'gemini-1.5-flash' or 'gemini-2.5-flash'.";
      }
      if (bodySnippet && /unsupported.image/i.test(bodySnippet)) {
        return "Request failed (400). An attachment URL was not a supported image type (use PNG, JPEG, GIF, or WebP).";
      }
      return "Bad request (400). Check API key and model settings.";
    }
    if (status === 401) {
      return "Unauthorized (401). Invalid API key. Get a new key from https://aistudio.google.com/app/apikey";
    }
    if (status === 403) {
      if (
        bodySnippet &&
        /location.*not.*supported|not.*available.*location|geographic|region.*not.*support/i.test(
          bodySnippet,
        )
      ) {
        return (
          "Geographic restriction (403). Your location/country is not supported for Gemini API access.\n\n" +
          "SOLUTIONS:\n" +
          "1. Use a VPN to connect from a supported country (US, UK, Canada, etc.)\n" +
          "2. If using VPN, make sure it's working properly and not exposing your real IP\n" +
          "3. Try a different API (Claude, ChatGPT)\n\n" +
          "Visit: https://cloud.google.com/generative-ai/docs/availability for supported regions."
        );
      }
      if (bodySnippet && /billing|quota/i.test(bodySnippet)) {
        return "Billing required (403). This API key requires billing setup. Check your Google Cloud billing.";
      }
      return "Access forbidden (403). API key may not have permission for this model or region.";
    }
    if (status === 429) {
      if (bodySnippet && /quota|exceeded|billing/i.test(bodySnippet)) {
        return "API quota exceeded (429). You've exceeded your current quota. Check your plan at https://aistudio.google.com/app/apikey";
      }
      return "Rate limited (429). Gemini API is experiencing high demand. Try enabling 'Disable image processing' in settings to reduce API load, or wait a few moments and try again.";
    }
    if (status === 503)
      return "Service unavailable (503). Gemini API is currently experiencing high demand. Please try again later.";
    if (status === 0 || status >= 500) {
      if (
        bodySnippet &&
        /high demand|currently experiencing/i.test(bodySnippet)
      ) {
        return "Gemini API is experiencing high demand. This is temporary - please try again in a few moments. Consider enabling 'Disable image processing' in settings to reduce API load.";
      }
      return "Gemini API or network error. Check your internet connection and try again.";
    }
    return "Request failed (" + status + ").";
  }

  /**
   * Convert OpenAI-style messages to Gemini format
   * @param {Array} messages - OpenAI format [{role, content}]
   * @returns {Array} Gemini format [{role, parts}]
   */
  function convertMessagesToGeminiFormat(messages) {
    return messages.map((msg) => {
      if (typeof msg.content === "string") {
        return {
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        };
      } else if (Array.isArray(msg.content)) {
        // Handle multimodal content
        const parts = msg.content.map((part) => {
          if (part.type === "text") {
            return { text: part.text };
          } else if (part.type === "image_url") {
            // For now, we'll handle images as URLs in text
            // In a full implementation, we'd need to fetch and convert to base64
            return { text: `[Image: ${part.image_url.url}]` };
          }
          return { text: "" };
        });
        return {
          role: msg.role === "assistant" ? "model" : "user",
          parts: parts.filter((p) => p.text),
        };
      } else if (msg.content && msg.content.parts) {
        // Already in Gemini format
        return {
          role: msg.role === "assistant" ? "model" : "user",
          parts: msg.content.parts,
        };
      } else if (msg.content && msg.content.text) {
        // Gemini format with single text part
        return {
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content.text }],
        };
      }
      // Fallback
      return {
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: String(msg.content || "") }],
      };
    });
  }

  /**
   * Global status display function for retry messages
   */
  function showRetryStatus(message) {
    // Try to find active modal and update loading text
    const modals = document.querySelectorAll(
      ".far-ia-task-modal, .far-ia-backdrop",
    );
    modals.forEach((modal) => {
      const loadingText = modal.querySelector(".far-ia-loading-text");
      if (loadingText) {
        loadingText.textContent = message;
        loadingText.style.display = "block";
      }
    });

    // Also try to find custom offer button
    const customOfferBtn = document.querySelector(".far-custom-offer-ai-btn");
    if (customOfferBtn) {
      const originalText = customOfferBtn.textContent;
      customOfferBtn.textContent = message;
      customOfferBtn.disabled = true;

      // Restore original text after delay
      setTimeout(() => {
        customOfferBtn.textContent = originalText;
        customOfferBtn.disabled = false;
      }, 3000);
    }
  }

  /**
   * Sleep function for retry delays
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Never log secrets. Safe error for UI only.
   */
  async function geminiGenerateContent(getSettings, messages, options) {
    const s = getSettings();
    const apiKeys = getGeminiKeyList(s);
    const apiKeyCount = apiKeys.length;
    const apiKeyPrefix = apiKeys[0]
      ? apiKeys[0].substring(0, 10) + "..."
      : "none";

    // Debug logging
    console.log("=== Gemini API Request Debug ===");
    console.log("1. Settings check:", {
      apiKeyCount,
      apiKeyPrefix,
      model: s && s.geminiModel && String(s.geminiModel).trim(),
    });

    if (!apiKeyCount) {
      console.error("ERROR: No Gemini API key found");
      throw new Error("Add your Gemini API key in Fiverr Assistant settings.");
    }

    let currentIndex = await getCurrentGeminiKeyIndex();
    const failedKeys = await getFailedGeminiKeys();

    // Find first usable key starting from stored index
    let apiKey = null;
    let startIndex = currentIndex;
    for (let i = 0; i < apiKeys.length; i++) {
      const idx = (startIndex + i) % apiKeys.length;
      if (!failedKeys.has(apiKeys[idx])) {
        apiKey = apiKeys[idx];
        currentIndex = idx;
        break;
      }
    }

    if (!apiKey) {
      console.log(
        "All Gemini API keys marked as failed, resetting and retrying...",
      );
      await clearFailedGeminiKeys();
      apiKey = apiKeys[0];
      currentIndex = 0;
    }

    const validateKey = (key) => {
      const trimmed = String(key || "").trim();
      return (
        trimmed.length >= 30 &&
        (trimmed.startsWith("AIza") || trimmed.startsWith("AQ."))
      );
    };

    if (!validateKey(apiKey)) {
      console.error("ERROR: Invalid Gemini API key format");
      throw new Error(
        "Invalid Gemini API key format. Gemini API keys should start with 'AIza' or 'AQ.' and be an active Google API key. Get a new key from https://aistudio.google.com/app/apikey",
      );
    }

    const model =
      (s && s.geminiModel && String(s.geminiModel).trim()) ||
      "gemini-2.5-flash";
    console.log("3. Using model:", model);

    const geminiMessages = convertMessagesToGeminiFormat(messages);
    console.log("4. Converted messages:", geminiMessages);

    const body = {
      contents: geminiMessages,
      generationConfig: {
        temperature:
          options && typeof options.temperature === "number"
            ? options.temperature
            : 0.7,
        maxOutputTokens: 8192,
      },
    };

    console.log("5. Request body:", JSON.stringify(body, null, 2));

    const url = `${GEMINI_CHAT_URL}${model}:generateContent`;
    console.log(
      "6. Request URL:",
      url.replace(/key=[^&]*/, "key=***REDACTED***"),
    );

    // Retry mechanism for rate limiting and high demand errors
    const maxRetries = 3;
    const baseDelay = 2000; // 2 seconds for better user experience

    let lastError = null;
    for (let keyAttempt = 0; keyAttempt < apiKeys.length; keyAttempt++) {
      if (keyAttempt > 0) {
        currentIndex = (currentIndex + 1) % apiKeys.length;
        apiKey = apiKeys[currentIndex];
        console.log(
          `Switching to Gemini API key ${currentIndex + 1}/${apiKeys.length}`,
        );
        await setCurrentGeminiKeyIndex(currentIndex);
      }

      if (!validateKey(apiKey)) {
        console.warn("Skipping invalid Gemini API key format", { apiKey });
        await markGeminiKeyAsFailed(apiKey);
        continue;
      }

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        console.log(`Gemini key attempt ${attempt + 1}/${maxRetries}`);

        try {
          const fetchOptions = {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          };

          const res = await fetch(`${url}?key=${apiKey}`, fetchOptions);
          console.log("9. Response received:", {
            status: res.status,
            statusText: res.statusText,
            ok: res.ok,
          });

          const rawText = await res.text();
          console.log("10. Raw response text:", rawText);
          let data;
          try {
            data = JSON.parse(rawText);
          } catch (error) {
            console.error("11. JSON parse error:", error);
            data = null;
          }

          if (!res.ok) {
            const apiErr =
              data && data.error && typeof data.error.message === "string"
                ? data.error.message
                : rawText || "Unknown Gemini error";
            console.log("12. API Error details:", {
              status: res.status,
              apiError: apiErr,
              errorData: data && data.error,
            });

            const isInvalidKey =
              res.status === 401 ||
              /invalid.*key|missing.*key|unauthorized/i.test(apiErr);
            const isRateLimited = res.status === 429;
            const isBlocked = res.status === 403;
            const isRetryable =
              res.status === 503 ||
              (res.status >= 500 &&
                /high demand|temporarily unavailable/i.test(apiErr));

            if (isInvalidKey) {
              await markGeminiKeyAsFailed(apiKey);
              console.log("Invalid Gemini key, trying next key...");
              lastError = new Error(apiErr);
              break;
            }

            if (isRateLimited && keyAttempt < apiKeys.length - 1) {
              console.log("Gemini key rate limited, trying next key...");
              lastError = new Error(apiErr);
              break;
            }

            if (isBlocked) {
              lastError = new Error(apiErr);
              if (attempt < maxRetries - 1) {
                const delay =
                  baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
                await sleep(delay);
                continue;
              }
              throw new Error(apiErr);
            }

            if (isRetryable && attempt < maxRetries - 1) {
              const delay =
                baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
              await sleep(delay);
              continue;
            }

            const errorToThrow = new Error(
              `Gemini request failed (${res.status}). ${apiErr}`,
            );
            lastError = errorToThrow;
            throw errorToThrow;
          }

          const responseText =
            data &&
            data.candidates &&
            data.candidates[0] &&
            data.candidates[0].content &&
            Array.isArray(data.candidates[0].content.parts)
              ? data.candidates[0].content.parts
                  .map((part) => part.text || "")
                  .join("")
              : "";

          await trackGeminiCall();
          await setCurrentGeminiKeyIndex(currentIndex);

          if (responseText) {
            return stripFencesAndPreamble(responseText);
          }

          throw new Error("Gemini returned no usable text response.");
        } catch (error) {
          console.log("Exception:", error.message);
          lastError = error;
          if (attempt === maxRetries - 1) {
            break;
          }
          const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
          await sleep(delay);
        }
      }
    }

    throw new Error(
      `Gemini API request failed with all available keys. ${
        lastError && lastError.message
          ? `Last error: ${lastError.message}`
          : "Check your Gemini keys and account status."
      }`,
    );
  }

  function injectModalStyles() {
    if (document.getElementById("far-inbox-ai-styles")) return;
    const st = document.createElement("style");
    st.id = "far-inbox-ai-styles";
    st.textContent =
      ".far-ia-backdrop{position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:100002;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;}" +
      ".far-ia-task-modal{z-index:100003;}" +
      ".far-ia-dialog{background:#fff;color:#0e0e10;border-radius:12px;max-width:600px;width:100%;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,0.25);font-family:system-ui,-apple-system,sans-serif;font-size:14px;}" +
      ".far-ia-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #e2e8f0;background:#fafafa;}" +
      ".far-ia-title{font-weight:700;font-size:15px;color:#1dbf73;}" +
      ".far-ia-tabs{display:flex;gap:4px;align-items:center;flex:1;margin-left:16px;}" +
      ".far-ia-tab-btn{padding:6px 14px;border-radius:6px;border:none;background:transparent;cursor:pointer;font-size:13px;font-weight:500;color:#64748b;transition:all 0.2s;}" +
      ".far-ia-tab-btn:hover{background:#f1f5f9;color:#334155;}" +
      ".far-ia-tab-btn.active{background:#1dbf73;color:#fff;}" +
      ".far-ia-body{padding:12px 16px;overflow-y:auto;flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;}" +
      ".far-ia-tab-content{display:none;flex:1;overflow-y:auto;}" +
      ".far-ia-tab-content.active{display:flex;flex-direction:column;gap:10px;}" +
      ".far-ia-presets{display:flex;flex-direction:column;gap:8px;}" +
      ".far-ia-preset-group{display:flex;flex-direction:column;gap:6px;}" +
      ".far-ia-preset-group-title{font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-top:6px;margin-bottom:2px;}" +
      ".far-ia-cost-row{display:flex;flex-direction:row;align-items:stretch;gap:8px;width:100%;}" +
      ".far-ia-cost-input{flex:0 0 118px;min-width:96px;max-width:168px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;box-sizing:border-box;font:inherit;}" +
      ".far-ia-cost-input:focus{outline:2px solid rgba(29,191,115,0.35);outline-offset:1px;}" +
      ".far-ia-btn.far-ia-cost-btn{flex:1;min-width:0;text-align:left;}" +
      ".far-ia-btn{text-align:left;padding:10px 12px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;cursor:pointer;font-size:13px;line-height:1.35;transition:all 0.2s;}" +
      ".far-ia-btn:hover{border-color:#1dbf73;background:#f0fdf4;color:#1dbf73;}" +
      ".far-ia-btn:disabled{opacity:0.55;cursor:not-allowed;}" +
      ".far-ia-out{width:100%;min-height:100px;max-height:200px;resize:vertical;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;box-sizing:border-box;}" +
      ".far-ia-err{color:#b91c1c;font-size:13px;padding:8px;background:#fee2e2;border-radius:6px;}" +
      ".far-ia-chat-log{min-height:200px;max-height:65vh;overflow-y:auto;font-size:13px;color:#475569;border:1px solid #cbd5e1;border-radius:8px;padding:12px;background:#f8fafc;display:flex;flex-direction:column;gap:8px;}" +
      ".far-ia-chat-row{padding:10px;border-radius:6px;line-height:1.5;word-wrap:break-word;display:grid;grid-template-columns:1fr auto;gap:8px;align-items:start;}" +
      ".far-ia-chat-row.seller{background:#e8f5e9;border-left:4px solid #1dbf73;padding-left:10px;color:#1b5e20;}" +
      ".far-ia-chat-row.buyer{background:#e3f2fd;border-left:4px solid #2196f3;padding-left:10px;color:#0d47a1;}" +
      ".far-ia-chat-row.error{background:#ffebee;border-left:4px solid #f44336;padding-left:10px;color:#b71c1c;}" +
      ".far-ia-chat-actions{display:flex;gap:4px;flex-direction:column;}" +
      ".far-ia-chat-btn{padding:4px 8px;font-size:11px;border:1px solid #cbd5e1;border-radius:4px;background:#fff;cursor:pointer;transition:0.2s;white-space:nowrap;}" +
      ".far-ia-chat-btn:hover{background:#1dbf73;color:#fff;border-color:#1dbf73;}" +
      ".far-ia-chat-btn:active{transform:scale(0.95);}" +
      ".far-ia-chat-input-row{display:flex;gap:8px;align-items:flex-end;}" +
      ".far-ia-chat-input{flex:1;min-height:40px;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;resize:vertical;}" +
      ".far-ia-chat-input:focus{outline:2px solid rgba(29,191,115,0.35);outline-offset:1px;}" +
      ".far-ia-seller-note{width:100%;min-height:64px;max-height:140px;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;line-height:1.4;resize:vertical;font:inherit;}" +
      ".far-ia-seller-note:focus{outline:2px solid rgba(29,191,115,0.35);outline-offset:1px;}" +
      ".far-ia-small{font-size:11px;color:#64748b;}" +
      ".far-ia-ai-toggle{display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:8px;border:1px solid #c4c4c4;background:#fff;color:#222;cursor:pointer;padding:0;}" +
      ".far-ia-ai-toggle:hover{background:#f5f5f5;}" +
      ".far-ia-ai-toggle--on{border-color:#1dbf73;background:#1dbf73;color:#fff;}" +
      ".far-ia-task-modal .far-ia-out{min-height:160px;max-height:40vh;white-space:pre-wrap;}" +
      ".far-ia-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px;}";
    document.documentElement.appendChild(st);
  }

  function ensureCustomOfferAiStyles() {
    if (document.getElementById("far-custom-offer-ai-styles")) return;
    const st = document.createElement("style");
    st.id = "far-custom-offer-ai-styles";
    st.textContent =
      ".far-custom-offer-ai-wrap{margin-top:10px;width:100%;}" +
      ".far-custom-offer-ai-btn{width:100%;padding:9px 12px;font:inherit;font-size:13px;font-weight:600;border-radius:8px;border:1px solid #1dbf73;background:#1dbf73;color:#fff;cursor:pointer;box-sizing:border-box;}" +
      ".far-custom-offer-ai-btn:hover{filter:brightness(0.97);}" +
      ".far-custom-offer-ai-btn:disabled{opacity:0.6;cursor:not-allowed;}" +
      ".far-custom-offer-ai-err{margin-top:6px;font-size:12px;color:#b91c1c;line-height:1.35;}";
    document.documentElement.appendChild(st);
  }

  let customOfferDescriptionHelperStarted = false;

  /**
   * Injects a button under the custom-offer description field when the modal opens; fills from thread + API.
   * @param {() => object} getSettings
   */
  function startCustomOfferDescriptionHelper(getSettings) {
    if (customOfferDescriptionHelperStarted) return;
    customOfferDescriptionHelperStarted = true;
    ensureCustomOfferAiStyles();

    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        injectCustomOfferDescriptionButton(getSettings);
      });
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    schedule();
  }

  function injectCustomOfferDescriptionButton(getSettings) {
    const ta = document.querySelector(
      CUSTOM_OFFER_DESCRIPTION_TEXTAREA_SELECTOR,
    );
    if (!ta || ta.tagName !== "TEXTAREA" || !document.body.contains(ta)) return;

    const inner = ta.parentElement;
    const col = inner && inner.parentElement;
    if (!col || !col.contains(ta)) return;
    if (col.querySelector(".far-custom-offer-ai-wrap")) return;

    const wrap = document.createElement("div");
    wrap.className = "far-custom-offer-ai-wrap";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "far-custom-offer-ai-btn";
    btn.textContent = "Generate offer description from conversation (AI)";
    const err = document.createElement("div");
    err.className = "far-custom-offer-ai-err";
    err.style.display = "none";
    err.setAttribute("role", "alert");

    btn.addEventListener("click", async () => {
      err.style.display = "none";
      err.textContent = "";
      btn.disabled = true;
      const originalBtnText = btn.textContent;

      try {
        const { text: transcript, imageUrls } =
          buildInboxTranscript(getSettings);
        const form = ta.closest("form");
        const gigHeading =
          form && form.querySelector('h6[data-track-tag="heading"]');
        const titleText = gigHeading
          ? String(gigHeading.textContent || "")
              .replace(/\s+/g, " ")
              .trim()
          : "";

        const sellerName = getSellerDisplayName(getSettings);
        const sys =
          BASE_SYSTEM_PROMPT +
          " Task: Write ONLY the text for the Fiverr custom offer description field (what the buyer reads). Clear scope, deliverables, and what is included; mention timeline or revisions only if grounded in the thread. Professional Fiverr-style offer copy, not a chat greeting. Strict maximum 1500 characters (field limit). No markdown fences, no preamble or labels—just the description body. Do not invent prices, deadlines, or package details not supported by the conversation.";

        const userText =
          "Gig / offer title shown in this form: " +
          (titleText || "(not found)") +
          "\n\nSeller display name: " +
          sellerName +
          "\n\nInbox conversation with this buyer:\n" +
          transcript +
          "\n\nProduce the offer description text only. If the thread is empty or uninformative, write a short professional scope summary and invite the buyer to confirm details—do not invent a specific project.";

        const userContent = await buildUserContentWithImages(
          userText,
          imageUrls,
          getSettings,
        );

        const text = await generateWithAI(
          getSettings,
          [
            { role: "system", content: sys },
            { role: "user", content: userContent },
          ],
          { temperature: 0.45 },
        );

        let out = (text || "").trim();
        const maxLen =
          parseInt(ta.getAttribute("maxlength") || "1500", 10) || 1500;
        if (out.length > maxLen) out = out.slice(0, maxLen);
        ta.value = out;
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        ta.dispatchEvent(new Event("change", { bubbles: true }));
        ta.focus();
      } catch (e) {
        // Enhance error message with suggestions for rate limiting
        let errorMsg = e.message || "Could not generate description.";
        if (
          errorMsg.includes("Rate limited") ||
          errorMsg.includes("high demand") ||
          errorMsg.includes("quota")
        ) {
          errorMsg +=
            " Tip: Enable 'Disable image processing' in extension settings to reduce API load during busy periods.";
        }
        err.textContent = errorMsg;
        err.style.display = "block";
      } finally {
        btn.disabled = false;
        btn.textContent = originalBtnText;
      }
    });

    wrap.appendChild(btn);
    wrap.appendChild(err);
    col.appendChild(wrap);
  }

  function trapFocus(dialog) {
    const sel =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const nodes = () =>
      Array.from(dialog.querySelectorAll(sel)).filter(
        (el) => !el.disabled && el.offsetParent !== null,
      );
    const first = () => nodes()[0];
    const last = () => nodes()[nodes().length - 1];
    dialog.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const list = nodes();
      if (list.length === 0) return;
      if (e.shiftKey) {
        if (document.activeElement === first()) {
          e.preventDefault();
          last().focus();
        }
      } else {
        if (document.activeElement === last()) {
          e.preventDefault();
          first().focus();
        }
      }
    });
  }

  /**
   * OpenAI ChatGPT API handler
   * @param {() => object} getSettings
   * @param {Array} messages - Messages in OpenAI format [{role, content}]
   * @param {object} options - { temperature: number }
   * @returns {Promise<string>}
   */
  async function openaiGenerateContent(getSettings, messages, options) {
    const s = getSettings();
    const apiKeys = getApiKeyList(s);

    if (!apiKeys || apiKeys.length === 0) {
      throw new Error(
        "Add your OpenAI API key(s) in Fiverr Assistant settings. Get one at https://platform.openai.com/api-keys. You can add multiple keys separated by newlines or commas for automatic failover.",
      );
    }

    // Validate all keys have correct format
    for (const key of apiKeys) {
      if (!key.startsWith("sk-")) {
        throw new Error(
          "Invalid OpenAI API key format. Should start with 'sk-'. Get a key at https://platform.openai.com/api-keys",
        );
      }
    }

    let model =
      (s && s.openaiModel && String(s.openaiModel).trim()) || "gpt-4o-mini";
    let hasSwitchedOpenAIModel = false;
    let lastError = null;
    console.log(
      `Using OpenAI model: ${model} with ${apiKeys.length} API key(s)`,
    );

    // Get current key index and failed keys
    let currentIndex = await getCurrentKeyIndex();
    const failedKeys = await getFailedKeys();

    // Find first non-failed key starting from current index
    let keyToUse = null;
    let startIndex = currentIndex;
    for (let i = 0; i < apiKeys.length; i++) {
      const idx = (startIndex + i) % apiKeys.length;
      if (!failedKeys.has(apiKeys[idx])) {
        keyToUse = apiKeys[idx];
        currentIndex = idx;
        break;
      }
    }

    // If all keys are marked as failed, try them anyway but reset failed list
    if (!keyToUse) {
      console.log(
        "All API keys marked as failed, resetting and trying again...",
      );
      await clearFailedKeys();
      keyToUse = apiKeys[0];
      currentIndex = 0;
    }

    const openaiMessages = messages.map((msg) => {
      if (typeof msg.content === "string") {
        return { role: msg.role, content: msg.content };
      } else if (msg.content && msg.content.text) {
        return { role: msg.role, content: msg.content.text };
      } else if (msg.content && msg.content.parts) {
        // Convert from Gemini format
        const textParts = msg.content.parts
          .filter((p) => p && p.text)
          .map((p) => p.text);
        return { role: msg.role, content: textParts.join("\n") };
      }
      return { role: msg.role, content: String(msg.content || "") };
    });

    const body = {
      model: model,
      messages: openaiMessages,
      temperature:
        options && typeof options.temperature === "number"
          ? options.temperature
          : 0.7,
      max_tokens:
        options && typeof options.max_tokens === "number"
          ? options.max_tokens
          : 1024,
    };

    const url = "https://api.openai.com/v1/chat/completions";
    const maxRetries = 5;
    const baseDelay = 2000; // 2 seconds base delay for exponential backoff

    // Try current key, then rotate through other keys if this one fails
    for (let keyAttempt = 0; keyAttempt < apiKeys.length; keyAttempt++) {
      if (keyAttempt > 0) {
        // Move to next key
        currentIndex = (currentIndex + 1) % apiKeys.length;
        keyToUse = apiKeys[currentIndex];
        console.log(
          `Switching to API key ${currentIndex + 1}/${apiKeys.length}`,
        );
        await setCurrentKeyIndex(currentIndex);
      }

      console.log(`Using OpenAI API key ${currentIndex + 1}/${apiKeys.length}`);

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        console.log(`Attempt ${attempt + 1}/${maxRetries}`);

        try {
          const fetchOptions = {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${keyToUse}`,
            },
            body: JSON.stringify(body),
          };

          const res = await fetch(url, fetchOptions);
          console.log("Response status:", res.status);

          const rawText = await res.text();
          let data;
          try {
            data = JSON.parse(rawText);
          } catch (error) {
            console.error("JSON parse error:", error);
            data = null;
          }

          if (!res.ok) {
            const errMsg =
              (data && data.error && data.error.message) ||
              rawText ||
              `HTTP ${res.status}`;
            const errorCode =
              data && data.error
                ? String(data.error.code || data.error.type || "").toLowerCase()
                : "";
            console.log(
              "API Error:",
              errMsg,
              errorCode ? `(${errorCode})` : "",
            );

            const unsupportedModelError =
              isOpenAIModelUnsupported(errMsg, errorCode) &&
              model !== "gpt-3.5-turbo";

            if (unsupportedModelError && !hasSwitchedOpenAIModel) {
              console.log(
                `OpenAI model '${model}' not available for this key, falling back to gpt-3.5-turbo`,
              );
              showRetryStatus(
                "OpenAI model not available for this key. Falling back to gpt-3.5-turbo.",
              );
              model = "gpt-3.5-turbo";
              hasSwitchedOpenAIModel = true;
              body.model = model;
              continue;
            }

            const quotaExhausted = isOpenAIQuotaExhausted(errMsg, errorCode);
            const isRateLimited = res.status === 429 && !quotaExhausted;

            // Invalid key or out of credits — rotate to next key
            if (
              res.status === 401 ||
              quotaExhausted ||
              (isRateLimited && keyAttempt < apiKeys.length - 1)
            ) {
              if (res.status === 401 || quotaExhausted) {
                await markKeyAsFailed(keyToUse);
              }
              if (res.status === 401) {
                console.log("Invalid API key, trying next key...");
                break;
              }
              if (quotaExhausted) {
                console.log("Quota exhausted on this key, trying next key...");
                break;
              }
              if (isRateLimited) {
                console.log("Rate limited, trying next key...");
                break;
              }
            }

            const isRetryable =
              isRateLimited || res.status === 503 || res.status >= 500;

            if (isRetryable && attempt < maxRetries - 1) {
              const delay = getOpenAIRetryDelayMs(res, attempt, res.status);
              console.log(`Retrying after ${delay}ms`);
              showRetryStatus(
                `OpenAI rate limit hit. Retrying ${attempt + 1}/${maxRetries} in ${Math.round(delay / 1000)}s...`,
              );
              await sleep(delay);
              continue;
            }

            let msg = mapOpenAIError(res.status, errMsg, errorCode);
            if (
              keyAttempt < apiKeys.length - 1 &&
              (res.status === 401 || quotaExhausted || isRateLimited)
            ) {
              msg += " (trying next API key...)";
            }

            if (res.status === 401) {
              const errorToThrow = new Error(msg);
              lastError = errorToThrow;
              throw errorToThrow;
            }

            if (
              attempt === maxRetries - 1 &&
              keyAttempt === apiKeys.length - 1
            ) {
              const errorToThrow = new Error(msg);
              lastError = errorToThrow;
              throw errorToThrow;
            }

            continue;
          }

          // Success
          const choice = data && data.choices && data.choices[0];
          const content = choice && choice.message && choice.message.content;
          console.log(
            "Generated content:",
            content ? content.substring(0, 100) + "..." : "empty",
          );

          // Track successful call
          await trackOpenAICall(currentIndex);

          // Reset current index on success
          await setCurrentKeyIndex(0);

          if (content) {
            return stripFencesAndPreamble(content);
          }

          return "";
        } catch (error) {
          console.log("Exception:", error.message);
          lastError = error;

          if (attempt === maxRetries - 1) {
            if (keyAttempt < apiKeys.length - 1) {
              console.log("Trying next API key...");
              break; // Break inner retry loop, try next key
            }
            throw error;
          }

          if (
            error.message.includes("network") ||
            error.message.includes("fetch")
          ) {
            const delay =
              baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
            await sleep(delay);
            continue;
          }

          throw error;
        }
      }
    }

    throw new Error(
      `OpenAI API request failed with all available API keys. ${
        lastError && lastError.message
          ? `Last error: ${lastError.message}`
          : "Check your keys and account status at https://platform.openai.com/account/billing"
      }`,
    );
  }

  /**
   * Map OpenAI error codes to helpful messages
   */
  function isOpenAIQuotaExhausted(errMsg, errorCode) {
    return (
      /insufficient_quota|billing_hard_limit|quota_exceeded/.test(errorCode) ||
      /exceeded.*quota|insufficient.*quota|billing.*limit|out of credits/i.test(
        String(errMsg || ""),
      )
    );
  }

  function getOpenAIRetryDelayMs(res, attempt, status) {
    const retryAfter =
      res && res.headers && res.headers.get
        ? res.headers.get("retry-after")
        : null;
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!Number.isNaN(seconds) && seconds > 0) {
        return seconds * 1000;
      }
    }
    // Free tier is often ~3 requests/minute; wait longer on 429
    const base = status === 429 ? 20000 : 2000;
    return base * Math.pow(2, attempt) + Math.random() * 1000;
  }

  function mapOpenAIError(status, bodySnippet, errorCode) {
    if (status === 401) {
      return "Unauthorized (401). Invalid OpenAI API key. Check your key at https://platform.openai.com/api-keys";
    }
    if (status === 403) {
      return "Forbidden (403). Your account or API key doesn't have access. Check https://platform.openai.com/account/billing";
    }
    if (status === 429) {
      if (isOpenAIQuotaExhausted(bodySnippet, errorCode || "")) {
        return (
          "OpenAI quota exhausted (429). This key has no free credits left. " +
          "Add another key in settings, add billing at https://platform.openai.com/account/billing, or wait for quota reset."
        );
      }
      return (
        "Rate limited (429). Free-tier keys allow only a few requests per minute. " +
        "Wait 30–60 seconds and try again. Add multiple keys (one per line in settings) from different OpenAI accounts for automatic failover."
      );
    }
    if (status === 500) {
      return "OpenAI server error (500). Their servers are having issues. Please try again in a moment.";
    }
    if (status === 503) {
      return "Service unavailable (503). OpenAI is temporarily offline. Please try again shortly.";
    }
    if (bodySnippet && /invalid.*model/i.test(bodySnippet)) {
      return "Invalid model. Try 'gpt-4o-mini', 'gpt-4o', or 'gpt-3.5-turbo'";
    }
    if (bodySnippet && /billing|quota/i.test(bodySnippet)) {
      return "Billing issue. Check your OpenAI account billing and subscription at https://platform.openai.com/account/billing";
    }
    return `Request failed (${status}). Check your API key and internet connection.`;
  }

  function isOpenAIModelUnsupported(errMsg, errorCode) {
    const message = String(errMsg || "").toLowerCase();
    const code = String(errorCode || "").toLowerCase();
    return (
      /invalid.*model|unsupported.*model|model.*not.*available|not.*found|model.*does.*not.*exist|permission.*model|model.*not.*allowed|not.*enabled|not.*authorized|not.*have.*access|access.*denied|permission.*denied|not.*available.*for.*your.*account/.test(
        message,
      ) ||
      /model_not_found|resource_not_found|permission_denied|not_authorized|access_denied|model_not_allowed/.test(
        code,
      )
    );
  }

  /**
   * Wrapper function that calls either Gemini or OpenAI based on configuration
   */
  async function generateWithAI(getSettings, messages, options) {
    const s = getSettings();
    const platform =
      (s && s.aiPlatform && String(s.aiPlatform).trim().toLowerCase()) ||
      "auto";
    const hasOpenAI = getApiKeyList(s).length > 0;
    const hasGemini =
      s && s.geminiApiKey && String(s.geminiApiKey).trim().length > 0;

    if (platform === "openai") {
      if (!hasOpenAI) {
        throw new Error(
          "OpenAI is selected but no OpenAI API key is configured. Add a key in settings.",
        );
      }
      console.log("Using OpenAI API (OpenAI only)...");
      return openaiGenerateContent(getSettings, messages, options);
    }

    if (platform === "gemini") {
      if (!hasGemini) {
        throw new Error(
          "Gemini is selected but no Gemini API key is configured. Add a key in settings.",
        );
      }
      console.log("Using Gemini API (Gemini only)...");
      return geminiGenerateContent(getSettings, messages, options);
    }

    if (platform === "both") {
      if (hasOpenAI) {
        try {
          console.log("Using OpenAI API first, with Gemini failover...");
          return await openaiGenerateContent(getSettings, messages, options);
        } catch (error) {
          console.warn("OpenAI failed, falling back to Gemini:", error.message);
          if (hasGemini) {
            return geminiGenerateContent(getSettings, messages, options);
          }
          throw error;
        }
      }
      if (hasGemini) {
        console.log("OpenAI not configured, using Gemini API...");
        return geminiGenerateContent(getSettings, messages, options);
      }
      throw new Error(
        "No AI API key configured. Add an OpenAI or Gemini API key in Fiverr Assistant settings.",
      );
    }

    // Auto fallback behavior: prefer OpenAI, otherwise use Gemini.
    if (hasOpenAI) {
      console.log("Using OpenAI API (auto)...");
      return openaiGenerateContent(getSettings, messages, options);
    }
    if (hasGemini) {
      console.log("Using Gemini API (auto)...");
      return geminiGenerateContent(getSettings, messages, options);
    }

    throw new Error(
      "No AI API key configured. Add an OpenAI or Gemini API key in Fiverr Assistant settings.",
    );
  }

  function attachToolbarButton(toolbarRow, sendTa, _root, getSettings) {
    injectModalStyles();

    function createEl(tag, options = {}) {
      const el = document.createElement(tag);
      if (options.className) el.className = options.className;
      if (options.type) el.type = options.type;
      if (options.id) el.id = options.id;
      if (options.textContent != null) el.textContent = options.textContent;
      if (options.placeholder) el.placeholder = options.placeholder;
      if (options.rows != null) el.rows = options.rows;
      if (options.cols != null) el.cols = options.cols;
      if (options.readOnly) el.readOnly = true;
      if (options.style) el.style.cssText = options.style;
      if (options.title) el.title = options.title;
      if (options.ariaLabel) el.setAttribute("aria-label", options.ariaLabel);
      if (options.htmlFor) el.htmlFor = options.htmlFor;
      if (options.role) el.setAttribute("role", options.role);
      if (options.dataset) {
        Object.entries(options.dataset).forEach(([key, value]) => {
          el.dataset[key] = value;
        });
      }
      if (options.attrs) {
        Object.entries(options.attrs).forEach(([key, value]) => {
          el.setAttribute(key, value);
        });
      }
      return el;
    }

    function clearChildren(el) {
      while (el.firstChild) {
        el.removeChild(el.firstChild);
      }
    }

    const btn = createEl("button", {
      type: "button",
      className: "far-ia-ai-toggle",
      title: "AI reply assistant",
      ariaLabel: "Open AI reply assistant",
    });
    const icon = createEl("svg", {
      attrs: {
        xmlns: "http://www.w3.org/2000/svg",
        width: "20",
        height: "20",
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.7",
        "aria-hidden": "true",
      },
    });
    icon.appendChild(
      createEl("path", {
        attrs: {
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          d: "M12 18v-5M9 21h6M8 5a4 4 0 1 1 8 0v3H8V5z",
        },
      }),
    );
    btn.appendChild(icon);
    toolbarRow.appendChild(btn);

    let backdrop = null;

    function closeModal() {
      const tasks = document.querySelectorAll(".far-ia-task-modal");
      tasks.forEach((n) => n.remove());
      if (backdrop && backdrop.parentNode)
        backdrop.parentNode.removeChild(backdrop);
      backdrop = null;
      btn.classList.remove("far-ia-ai-toggle--on");
      document.removeEventListener("keydown", onEsc);
      deactivateModalProtection().catch((err) =>
        console.warn("Error deactivating modal protection:", err),
      );
    }

    function onEsc(e) {
      if (e.key !== "Escape") return;
      const tasks = document.querySelectorAll(".far-ia-task-modal");
      if (tasks.length) {
        tasks[tasks.length - 1].remove();
        return;
      }
      closeModal();
    }

    async function openTaskExplanationModal(sellerPrivateNote) {
      const wrap = createEl("div", {
        className: "far-ia-backdrop far-ia-task-modal",
        role: "dialog",
      });
      wrap.setAttribute("aria-modal", "true");
      const dlg = createEl("div", { className: "far-ia-dialog" });

      const head = createEl("div", { className: "far-ia-head" });
      head.appendChild(
        createEl("span", {
          className: "far-ia-title",
          textContent: "Task explanation",
        }),
      );
      const closeBtn = createEl("button", {
        type: "button",
        className: "far-ia-btn",
        textContent: "Close",
        style: "max-width:80px",
      });
      closeBtn.dataset.close = "";
      head.appendChild(closeBtn);
      dlg.appendChild(head);

      const body = createEl("div", { className: "far-ia-body" });
      body.appendChild(
        createEl("p", {
          className: "far-ia-small",
          textContent:
            "Bangla and English summaries of what the buyer wants (from the thread).",
        }),
      );
      body.appendChild(
        createEl("div", {
          className: "far-ia-small",
          style: "font-weight:600",
          textContent: "BN",
        }),
      );
      body.appendChild(
        createEl("div", {
          className: "far-ia-out",
          dataset: { outBn: "" },
          style: "pointer-events:none;background:#f8fafc",
        }),
      );
      body.appendChild(
        createEl("div", {
          className: "far-ia-small",
          style: "font-weight:600",
          textContent: "EN",
        }),
      );
      body.appendChild(
        createEl("div", {
          className: "far-ia-out",
          dataset: { outEn: "" },
          style: "pointer-events:none;background:#f8fafc",
        }),
      );
      body.appendChild(
        createEl("p", {
          className: "far-ia-err",
          dataset: { err: "" },
          style: "display:none",
        }),
      );
      dlg.appendChild(body);
      wrap.appendChild(dlg);
      document.body.appendChild(wrap);

      const outBn = dlg.querySelector("[data-out-bn]");
      const outEn = dlg.querySelector("[data-out-en]");
      const errEl = dlg.querySelector("[data-err]");
      dlg
        .querySelector("[data-close]")
        .addEventListener("click", () => wrap.remove());
      wrap.addEventListener("click", (e) => {
        if (e.target === wrap) wrap.remove();
      });

      const sellerName = getSellerDisplayName(getSettings);
      const { text: transcript, imageUrls } = buildInboxTranscript(getSettings);
      const sys =
        TASK_SUMMARY_SYSTEM_PROMPT +
        "Base the summary only on the thread and any attached images.";
      let userText =
        "Seller display name: " +
        sellerName +
        "\n\nConversation:\n" +
        transcript;
      const noteExtra =
        (sellerPrivateNote && String(sellerPrivateNote).trim()) || "";
      if (noteExtra) {
        userText +=
          "\n\nSeller focus for this summary (optional nuance only; stay faithful to the thread):\n" +
          noteExtra;
      }
      const userContent = await buildUserContentWithImages(
        userText,
        imageUrls,
        getSettings,
      );

      errEl.style.display = "none";
      outBn.textContent = "Loading…";
      outEn.textContent = "";

      generateWithAI(
        getSettings,
        [
          { role: "system", content: sys },
          { role: "user", content: userContent },
        ],
        { temperature: 0.3 },
      )
        .then((raw) => {
          const parts = raw.split(/\bEN:\s*/i);
          let bn = parts[0] || "";
          bn = bn.replace(/^\s*BN:\s*/i, "").trim();
          const en = parts.length > 1 ? parts.slice(1).join("EN:").trim() : "";
          outBn.textContent = bn || raw.trim();
          outEn.textContent = en || "";
          if (!outEn.textContent) {
            outEn.textContent =
              "(If English is missing above, copy from the BN block or run again.)";
          }
        })
        .catch((e) => {
          errEl.textContent = e.message || "Error";
          errEl.style.display = "block";
          outBn.textContent = "";
        });

      trapFocus(dlg);
    }

    function openMainModal() {
      closeModal();
      document.addEventListener("keydown", onEsc);
      btn.classList.add("far-ia-ai-toggle--on");
      activateModalProtection().catch((err) =>
        console.warn("Error activating modal protection:", err),
      );

      // Initialize or refresh message selection UI for any new messages
      initializeMessageSelection().catch((err) =>
        console.warn("Failed to initialize message selection:", err),
      );

      /** @type {{role:string,content:string}[]} */
      let chatPanelHistory = [];

      backdrop = document.createElement("div");
      backdrop.className = "far-ia-backdrop";
      backdrop.setAttribute("role", "dialog");
      backdrop.setAttribute("aria-modal", "true");
      const dlg = createEl("div", { className: "far-ia-dialog" });

      const head = createEl("div", { className: "far-ia-head" });
      head.appendChild(
        createEl("span", {
          className: "far-ia-title",
          textContent: "✨ AI Assistant",
        }),
      );
      const tabs = createEl("div", { className: "far-ia-tabs" });
      tabs.appendChild(
        createEl("button", {
          type: "button",
          className: "far-ia-tab-btn active",
          dataset: { tab: "generate" },
          textContent: "Generate Response",
        }),
      );
      tabs.appendChild(
        createEl("button", {
          type: "button",
          className: "far-ia-tab-btn",
          dataset: { tab: "chat" },
          textContent: "Live Chat",
        }),
      );
      head.appendChild(tabs);
      head.appendChild(
        createEl("button", {
          type: "button",
          className: "far-ia-btn",
          dataset: { x: "" },
          style: "max-width:72px",
          textContent: "Close",
        }),
      );
      dlg.appendChild(head);

      const body = createEl("div", { className: "far-ia-body" });
      body.appendChild(
        createEl("p", {
          className: "far-ia-small",
          textContent:
            "Uses the visible conversation as context. Buyer image attachments in the thread are included for vision-capable models (e.g. gemini-2.5-flash). Paste the output into Fiverr when ready.",
        }),
      );
      body.appendChild(
        createEl("div", {
          className: "far-ia-loading-text",
          style:
            "color:#64748b; font-size:12px; margin-bottom:8px; display:none;",
        }),
      );
      dlg.appendChild(body);

      backdrop.appendChild(dlg);
      document.body.appendChild(backdrop);

      // Restructure modal into tabs - convert old flat layout to new tabbed layout
      (function restructureModalToTabs() {
        // Create tab structure if not already present
        if (!dlg.querySelector(".far-ia-tab-content")) {
          // Move content into tabs
          const body = dlg.querySelector(".far-ia-body");
          if (body) {
            clearChildren(body);

            const generateTab = createEl("div", {
              className: "far-ia-tab-content active",
              dataset: { tabContent: "generate" },
            });
            generateTab.appendChild(
              createEl("p", {
                className: "far-ia-small",
                textContent:
                  "✓ Context: Uses visible conversation and attachments as reference.",
              }),
            );
            generateTab.appendChild(
              createEl("label", {
                className: "far-ia-small",
                style:
                  "font-weight:600;color:#475569;margin-top:6px;display:block;",
                htmlFor: "far-ia-seller-note",
                textContent: "Your private note (optional)",
              }),
            );
            generateTab.appendChild(
              createEl("textarea", {
                id: "far-ia-seller-note",
                className: "far-ia-seller-note",
                dataset: { sellerNote: "" },
                rows: 3,
                placeholder: "Tone, price, deadline, context not in thread...",
                ariaLabel: "Your private note (optional)",
              }),
            );

            const quickGroup = createEl("div", {
              className: "far-ia-preset-group",
            });
            quickGroup.appendChild(
              createEl("div", {
                className: "far-ia-preset-group-title",
                textContent: "Quick Messages",
              }),
            );
            quickGroup.appendChild(
              createEl("button", {
                type: "button",
                className: "far-ia-btn",
                dataset: { a: "first" },
                textContent:
                  "📌 First message — short welcome; invite requirements",
              }),
            );
            quickGroup.appendChild(
              createEl("button", {
                type: "button",
                className: "far-ia-btn",
                dataset: { a: "reply" },
                textContent:
                  "💬 Reply — professional response to buyer's last message",
              }),
            );
            quickGroup.appendChild(
              createEl("button", {
                type: "button",
                className: "far-ia-btn",
                dataset: { a: "clarify" },
                textContent:
                  "❓ Clarify — ask focused questions from the thread",
              }),
            );
            generateTab.appendChild(quickGroup);

            const managementGroup = createEl("div", {
              className: "far-ia-preset-group",
            });
            managementGroup.appendChild(
              createEl("div", {
                className: "far-ia-preset-group-title",
                textContent: "Management",
              }),
            );
            managementGroup.appendChild(
              createEl("button", {
                type: "button",
                className: "far-ia-btn",
                dataset: { a: "cool" },
                textContent: "😊 Cool-Down — de-escalation, empathy",
              }),
            );
            managementGroup.appendChild(
              createEl("button", {
                type: "button",
                className: "far-ia-btn",
                dataset: { a: "postdelivery" },
                textContent:
                  "✅ After Delivery — set expectations (revisions vs new work)",
              }),
            );
            generateTab.appendChild(managementGroup);

            const advancedGroup = createEl("div", {
              className: "far-ia-preset-group",
            });
            advancedGroup.appendChild(
              createEl("div", {
                className: "far-ia-preset-group-title",
                textContent: "Advanced",
              }),
            );
            const costRow = createEl("div", { className: "far-ia-cost-row" });
            costRow.appendChild(
              createEl("input", {
                type: "text",
                className: "far-ia-cost-input",
                dataset: { costInput: "" },
                placeholder: "Optional: your price (e.g., $50, $25-50)",
                title:
                  "Optional: Enter your price or let AI estimate from task scope",
                ariaLabel: "Your cost or price (optional)",
              }),
            );
            costRow.appendChild(
              createEl("button", {
                type: "button",
                className: "far-ia-btn far-ia-cost-btn",
                dataset: { a: "cost" },
                textContent: "💰 Cost",
              }),
            );
            advancedGroup.appendChild(costRow);
            advancedGroup.appendChild(
              createEl("button", {
                type: "button",
                className: "far-ia-btn",
                dataset: { a: "quote" },
                textContent:
                  "📋 Quote — structured quote; no invented specifics",
              }),
            );
            advancedGroup.appendChild(
              createEl("button", {
                type: "button",
                className: "far-ia-btn",
                dataset: { a: "cursorPrompt" },
                textContent: "🧠 Cursor AI prompt — software engineer style",
              }),
            );
            advancedGroup.appendChild(
              createEl("button", {
                type: "button",
                className: "far-ia-btn",
                dataset: { a: "task" },
                textContent:
                  "🔍 Task Explain — Bangla + English summary (new window)",
              }),
            );
            advancedGroup.appendChild(
              createEl("button", {
                type: "button",
                className: "far-ia-btn",
                dataset: { a: "analysis" },
                textContent: "📊 Analyze — communication improvement score",
              }),
            );
            generateTab.appendChild(advancedGroup);

            generateTab.appendChild(
              createEl("div", {
                className: "far-ia-loading-text",
                style:
                  "color:#1dbf73;font-size:12px;margin-bottom:8px;display:none;font-weight:500;",
              }),
            );
            generateTab.appendChild(
              createEl("textarea", {
                className: "far-ia-out",
                readOnly: true,
                placeholder: "✓ Generated message...",
                dataset: { out: "" },
              }),
            );
            generateTab.appendChild(
              createEl("p", {
                className: "far-ia-err",
                dataset: { err: "" },
                style: "display:none",
              }),
            );
            const actionsRow = createEl("div", {
              className: "far-ia-actions",
              style: "display:flex;gap:8px;",
            });
            actionsRow.appendChild(
              createEl("button", {
                type: "button",
                className: "far-ia-btn",
                dataset: { copy: "" },
                style: "flex:1;",
                textContent: "📋 Copy",
              }),
            );
            actionsRow.appendChild(
              createEl("button", {
                type: "button",
                className: "far-ia-btn",
                dataset: { insert: "" },
                style: "flex:1;display:none;",
                textContent: "→ Insert",
              }),
            );
            generateTab.appendChild(actionsRow);
            body.appendChild(generateTab);

            const chatTab = createEl("div", {
              className: "far-ia-tab-content",
              dataset: { tabContent: "chat" },
            });
            chatTab.appendChild(
              createEl("p", {
                className: "far-ia-small",
                textContent: "Ask AI for rewrites, tone changes, refinements.",
              }),
            );
            chatTab.appendChild(
              createEl("div", {
                className: "far-ia-chat-log",
                dataset: { chatLog: "" },
                style: "flex:1;min-height:120px;margin-bottom:8px;",
              }),
            );
            chatTab.appendChild(
              createEl("textarea", {
                className: "far-ia-chat-input",
                dataset: { chatIn: "" },
                placeholder: "Ask: shorter, formal, friendly...",
                rows: 3,
                style: "width:100%;margin-bottom:8px;",
              }),
            );
            chatTab.appendChild(
              createEl("button", {
                type: "button",
                className: "far-ia-btn",
                dataset: { chatSend: "" },
                style: "width:100%;text-align:center;",
                textContent: "→ Send Message",
              }),
            );
            body.appendChild(chatTab);
          }
        }
      })();

      // Tab switching functionality
      const tabButtons = dlg.querySelectorAll(".far-ia-tab-btn");
      const tabContents = dlg.querySelectorAll(".far-ia-tab-content");

      tabButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
          const tabName = btn.getAttribute("data-tab");
          tabButtons.forEach((b) => b.classList.remove("active"));
          tabContents.forEach((c) => c.classList.remove("active"));
          btn.classList.add("active");
          const content = dlg.querySelector(`[data-tab-content="${tabName}"]`);
          if (content) content.classList.add("active");
        });
      });

      const out = dlg.querySelector("[data-out]");
      const err = dlg.querySelector("[data-err]");
      const chatLog = dlg.querySelector("[data-chat-log]");
      const chatIn = dlg.querySelector("[data-chat-in]");
      const costInput = dlg.querySelector("[data-cost-input]");
      const noteTa = dlg.querySelector("[data-seller-note]");
      const insertBtn = dlg.querySelector("[data-insert]");

      function appendSellerNoteForApi(baseUserText) {
        const n = noteTa ? String(noteTa.value || "").trim() : "";
        if (!n) return baseUserText;
        return (
          baseUserText +
          "\n\n---\nSeller private note for this generation (internal—work into the buyer-facing text naturally; never quote or attribute this note):\n" +
          n
        );
      }
      if (sendTa && sendTa.tagName === "TEXTAREA") {
        insertBtn.style.display = "";
        insertBtn.addEventListener("click", () => {
          const v = (out.value || "").trim();
          if (!v) return;
          sendTa.value = v;
          sendTa.dispatchEvent(new Event("input", { bubbles: true }));
          sendTa.focus();
          closeModal();
        });
      }

      function setLoading(isLoading, retryInfo = null) {
        dlg
          .querySelectorAll(".far-ia-btn[data-a], [data-chat-send]")
          .forEach((b) => {
            b.disabled = isLoading;
          });

        // Update loading text to show retry information
        if (retryInfo) {
          const loadingText = dlg.querySelector(".far-ia-loading-text");
          if (loadingText) {
            loadingText.textContent = `Gemini API is busy... Retrying ${retryInfo.current}/${retryInfo.max} (${retryInfo.delay}s)`;
          }
        }
      }

      function logChat(role, text) {
        const row = document.createElement("div");
        const isUser = role === "user";
        const isAI = role === "assistant" || role === "ai";
        const isError = !isUser && !isAI;

        row.className =
          "far-ia-chat-row " + (isUser ? "seller" : isAI ? "buyer" : "error");

        // Create message content container
        const msgContent = document.createElement("div");
        msgContent.style.cssText =
          "white-space:pre-wrap;overflow-wrap:break-word;";
        const label = document.createElement("strong");
        label.textContent = isUser ? "You:" : isAI ? "AI:" : "Error:";
        msgContent.appendChild(label);
        msgContent.appendChild(document.createTextNode(" "));
        msgContent.appendChild(
          document.createTextNode(
            typeof text === "string" ? text : String(text),
          ),
        );
        row.appendChild(msgContent);

        // Create action buttons (except for errors)
        if (!isError) {
          const actions = document.createElement("div");
          actions.className = "far-ia-chat-actions";

          const copyBtn = document.createElement("button");
          copyBtn.className = "far-ia-chat-btn";
          copyBtn.type = "button";
          copyBtn.textContent = "📋 Copy";
          copyBtn.addEventListener("click", () => {
            navigator.clipboard
              .writeText(text)
              .then(() => {
                const orig = copyBtn.textContent;
                copyBtn.textContent = "✓ Copied";
                setTimeout(() => {
                  copyBtn.textContent = orig;
                }, 2000);
              })
              .catch((err) => console.warn("Copy failed:", err));
          });

          const insertBtn = document.createElement("button");
          insertBtn.className = "far-ia-chat-btn";
          insertBtn.type = "button";
          insertBtn.textContent = "📌 Insert";
          insertBtn.addEventListener("click", () => {
            const outField = out;
            if (outField) {
              outField.value = text;
              outField.focus();
              outField.scrollTop = outField.scrollHeight;
              insertBtn.textContent = "✓ Inserted";
              setTimeout(() => {
                insertBtn.textContent = "📌 Insert";
              }, 2000);
            }
          });

          actions.appendChild(copyBtn);
          actions.appendChild(insertBtn);
          row.appendChild(actions);
        }

        chatLog.appendChild(row);
        chatLog.scrollTop = chatLog.scrollHeight;
      }

      function presetInstruction(kind, transcript, selectedMessages = []) {
        const myCost =
          (costInput && String(costInput.value || "").trim()) || "";
        return buildPresetUserText(kind, transcript, getSettings, {
          costPrice: myCost,
          selectedMessages,
        });
      }

      async function runCommunicationAnalysis() {
        chatPanelHistory = [];
        clearChildren(chatLog);
        err.style.display = "none";
        out.value = "";
        setLoading(true);

        // Show loading text
        const loadingText = dlg.querySelector(".far-ia-loading-text");
        if (loadingText) loadingText.style.display = "block";

        try {
          const analysis = await generateCommunicationAnalysis(getSettings);
          out.value = analysis;
        } catch (e) {
          err.textContent = e.message || "Error";
          err.style.display = "block";
        } finally {
          setLoading(false);
          const loadingText = dlg.querySelector(".far-ia-loading-text");
          if (loadingText) loadingText.style.display = "none";
        }
      }

      async function runPreset(kind) {
        chatPanelHistory = [];
        clearChildren(chatLog);
        err.style.display = "none";
        out.value = "";
        setLoading(true);

        // Show loading text
        const loadingText = dlg.querySelector(".far-ia-loading-text");
        if (loadingText) loadingText.style.display = "block";
        const sellerName = getSellerDisplayName(getSettings);
        const sys =
          BASE_SYSTEM_PROMPT +
          " Seller display name (use when natural): " +
          sellerName +
          ". Aim for a reply that leaves the buyer confident this seller is reliable and the right fit—without pressure or empty claims.";
        const { text: transcript, imageUrls } =
          buildInboxTranscript(getSettings);

        // Get selected messages for the first message type
        let selectedMessages = [];
        if (kind === "first") {
          selectedMessages = await getSelectedMessages();
        }

        const userText = appendSellerNoteForApi(
          presetInstruction(kind, transcript, selectedMessages),
        );
        const userContent = await buildUserContentWithImages(
          userText,
          imageUrls,
          getSettings,
        );
        generateWithAI(getSettings, [
          { role: "system", content: sys },
          { role: "user", content: userContent },
        ])
          .then((t) => {
            out.value = t;
          })
          .catch((e) => {
            err.textContent = e.message || "Error";
            err.style.display = "block";
          })
          .finally(() => {
            setLoading(false);
            const loadingText = dlg.querySelector(".far-ia-loading-text");
            if (loadingText) loadingText.style.display = "none";
          });
      }

      dlg.querySelector("[data-x]").addEventListener("click", closeModal);
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) closeModal();
      });

      dlg.querySelectorAll(".far-ia-btn[data-a]").forEach((b) => {
        b.addEventListener("click", () => {
          const kind = b.getAttribute("data-a");
          if (kind === "task") {
            const taskNote = noteTa ? String(noteTa.value || "").trim() : "";
            openTaskExplanationModal(taskNote);
            return;
          }
          if (kind === "analysis") {
            runCommunicationAnalysis();
            return;
          }
          runPreset(kind);
        });
      });

      dlg.querySelector("[data-copy]").addEventListener("click", () => {
        out.select();
        document.execCommand("copy");
      });

      dlg
        .querySelector("[data-chat-send]")
        .addEventListener("click", async () => {
          let q = (chatIn.value || "").trim();
          if (!q) return;
          const noteBlock = noteTa ? String(noteTa.value || "").trim() : "";
          err.style.display = "none";
          logChat("user", q);
          chatIn.value = "";
          setLoading(true);

          // Show loading text
          const loadingText = dlg.querySelector(".far-ia-loading-text");
          if (loadingText) loadingText.style.display = "block";

          const sellerName = getSellerDisplayName(getSettings);
          const { text: transcript, imageUrls } =
            buildInboxTranscript(getSettings);
          const sys =
            BASE_SYSTEM_PROMPT +
            " Seller: " +
            sellerName +
            ". Default: paste-ready single message only, same professional standard—trust-building and clear, not salesy. If the user asks for analysis, you may use short bullets without filler phrases.";

          const messages = [{ role: "system", content: sys }];
          let firstUserContentForHistory = null;
          if (chatPanelHistory.length === 0) {
            let firstText =
              "Fiverr thread (context):\n" +
              transcript +
              "\n\nUser request:\n" +
              q;
            if (noteBlock) {
              firstText +=
                "\n\n---\nSeller private note (internal—do not paste verbatim to the buyer):\n" +
                noteBlock;
            }
            firstUserContentForHistory = await buildUserContentWithImages(
              firstText,
              imageUrls,
              getSettings,
            );
            messages.push({
              role: "user",
              content: firstUserContentForHistory,
            });
          } else {
            const cap = chatPanelHistory.slice(-CHAT_HISTORY_MAX_TURNS);
            messages.push(...cap);
            const followText = noteBlock
              ? q +
                "\n\n---\nSeller private note (internal—do not paste verbatim):\n" +
                noteBlock
              : q;
            messages.push({ role: "user", content: followText });
          }

          generateWithAI(getSettings, messages)
            .then((t) => {
              out.value = t;
              logChat("assistant", t);
              if (chatPanelHistory.length === 0) {
                chatPanelHistory.push(
                  { role: "user", content: firstUserContentForHistory },
                  { role: "assistant", content: t },
                );
              } else {
                chatPanelHistory.push(
                  {
                    role: "user",
                    content: noteBlock
                      ? q +
                        "\n\n---\nSeller private note (internal):\n" +
                        noteBlock
                      : q,
                  },
                  { role: "assistant", content: t },
                );
              }
            })
            .catch((e) => {
              err.textContent = e.message || "Error";
              err.style.display = "block";
            })
            .finally(() => {
              setLoading(false);
              const loadingText = dlg.querySelector(".far-ia-loading-text");
              if (loadingText) loadingText.style.display = "none";
            });
        });

      trapFocus(dlg);
      dlg.querySelector("[data-x]").focus();
    }

    btn.addEventListener("click", () => {
      openMainModal();
    });

    // Initialize message selection UI on page load
    initializeMessageSelection().catch((err) =>
      console.warn("Failed to initialize message selection:", err),
    );
  }

  window.FarInboxAi = {
    attachToolbarButton,
    buildInboxTranscript,
    startCustomOfferDescriptionHelper,
    generatePresetReply,
    isLastInboxMessageFromBuyer,
    getLastInboxMessageRole,
    /** exposed for tests / debugging only */
    _constants: {
      INBOX_MESSAGE_LIST_SELECTOR,
      INBOX_MESSAGE_ROW_SELECTOR,
      CUSTOM_OFFER_DESCRIPTION_TEXTAREA_SELECTOR,
    },
  };
})();
