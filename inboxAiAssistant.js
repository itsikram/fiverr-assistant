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

  const GEMINI_CHAT_URL = "https://generativelanguage.googleapis.com/v1beta/models/";
  const MAX_TRANSCRIPT_CHARS = 12000;
  const CHAT_HISTORY_MAX_TURNS = 12;
  /** Max images sent per API call (buyer attachments + thread); avoids huge payloads */
  const MAX_THREAD_IMAGES = 10;

  /** @type {string} — list container; override in options or here if DevTools path changes */
  const INBOX_MESSAGE_LIST_SELECTOR = ".message-flow";
  /** @type {string} — message bubbles/rows; override in options or here */
  const INBOX_MESSAGE_ROW_SELECTOR = ".message-flow .message";

  /** Fiverr custom offer modal — paste from DevTools if `name` changes */
  const CUSTOM_OFFER_DESCRIPTION_TEXTAREA_SELECTOR = 'textarea[name="custom_offer.description"]';

  const BASE_SYSTEM_PROMPT = [
    "You help a Fiverr seller draft inbox replies that read like a seasoned professional buyers want to work with.",
    "Output ONLY the final message text the seller can paste into Fiverr.",
    "No preamble like 'Sure, here is' or 'Here is a message'. No markdown code fences.",
    "No meta-commentary unless the user explicitly asks for analysis.",
    "Tone: polished, courteous, and quietly confident—clear structure, correct grammar, full sentences. Sound human, not robotic or stiff.",
    "Build trust and make choosing this seller feel easy: mirror the buyer's goals in your own words, show you understood their messages, and end with one clear next step (e.g. what you need from them or that you're ready to proceed once details are confirmed).",
    "Win through competence, not hype: no begging ('please hire me'), no fake urgency, no exaggerated promises, no invented credentials or stats. Avoid generic flattery and stacking exclamation marks.",
    "Use the seller's display name naturally when it fits (e.g. sign-off); do not repeat it every sentence.",
    "Never invent specific prices, deadlines, deliverables, ratings, reviews, or portfolio claims not grounded in the conversation; if unknown, ask concise professional clarifying questions instead of guessing.",
    "When the user message includes images from the conversation (screenshots, uploads), look at them and use what is visible—errors, UI, designs, documents—when drafting the reply. Only describe what you can reasonably see.",
  ].join(" ");

  /** Task explanation (BN/EN) stays neutral—no sales voice */
  const TASK_SUMMARY_SYSTEM_PROMPT =
    "Summarize the buyer's request from the Fiverr thread accurately and neutrally. No selling, pitching, or persuasion. " +
    "Output ONLY two labeled sections in this exact format (no text before BN):\n\nBN:\n<text in Bangla>\n\nEN:\n<text in English>\n\n";

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
    const listSel = (s && s.inboxMessageListSelector && String(s.inboxMessageListSelector).trim()) || INBOX_MESSAGE_LIST_SELECTOR;
    const rowSel = (s && s.inboxMessageRowSelector && String(s.inboxMessageRowSelector).trim()) || INBOX_MESSAGE_ROW_SELECTOR;
    return { listSel, rowSel };
  }

  function isLikelyInboxAttachmentUrl(url) {
    if (!url || typeof url !== "string") return false;
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) return false;
    if (/favicon|emoji|gravatar|pixel|1x1|spacer|data:image/i.test(u)) return false;
    return (
      /secured-attachments|messaging_message\/attachment|\/attachment\//i.test(u) ||
      /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(u) ||
      (/fiverr-res\.cloudinary\.com|cloudinary\.com/i.test(u) && /\/image\//i.test(u))
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

    rowEl.querySelectorAll('.message-content img[src], [data-track-tag="box"] img[src]').forEach((img) => {
      const av = rowEl.querySelector('[data-track-tag="avatar"]');
      if (av && av.contains(img)) return;
      const lc = img.closest('[data-track-tag="link_card"], .link_card, [data-testid="custom-offer"]');
      if (lc) return;
      if (img.closest(".attachments-list")) return;
      const src = img.getAttribute("src");
      if (src && /secured-attachments|messaging_message\/attachment/i.test(src)) add(src);
    });

    return urls;
  }

  /**
   * Gemini models that support vision capabilities
   */
  function modelSupportsVision(modelName) {
    const m = String(modelName || "").toLowerCase().trim();
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

    if (/\.(pdf|svgz?|bmp|tif|tiff|heic|heif|ico|avif|eps|psd|ai)(\?|#|$)/i.test(lower)) return false;
    if (/\.(mp4|webm|mov|mkv|ogg|m4v|zip|rar|7z|doc|docx|xls|xlsx)(\?|#|$)/i.test(lower)) return false;
    if (/cloudinary\.com\/[^/]*\/(raw|video)\//i.test(lower)) return false;
    if (/[/_]f_(pdf|svg|bmp|tiff|heif|heic|avif)([/_]|\.|$)/i.test(lower)) return false;

    if (/\.(png|jpe?g|gif|webp)(\?|#|$)/i.test(lower)) return true;

    if (/cloudinary\.com/i.test(lower) && /\/image\//i.test(lower)) {
      if (/f_(jpe?g|png|gif|webp|auto)(?:[,/_]|$)/i.test(lower)) return true;
      if (/\/image\/upload\/[^?]*\.(png|jpe?g|gif|webp)(?:\?|$)/i.test(lower)) return true;
      return false;
    }

    if (/secured-attachments|messaging_message\/attachment|\/attachment\//i.test(lower)) {
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
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) return null;
      
      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.warn('Failed to convert image URL to base64:', url, error);
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
    const model = (settings.geminiModel && String(settings.geminiModel).trim()) || "gemini-2.5-flash";
    const urls = Array.from(new Set((imageUrls || []).filter(Boolean))).slice(0, MAX_THREAD_IMAGES);
    
    // Check if image processing is disabled
    if (settings.disableImageProcessing) {
      if (urls.length > 0) {
        return {
          text: text + "\n\n[Image processing is currently disabled. Image URLs from the thread:]\n" + urls.map((u, i) => i + 1 + ". " + u).join("\n")
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
        text: text + note + "\n\n[Your model may not support vision. Image URLs from the thread:]\n" + urls.map((u, i) => i + 1 + ". " + u).join("\n")
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
          const [mimeType, base64] = base64Data.split(',');
          const mimeMatch = mimeType.match(/data:([^;]+)/);
          const mimeTypeStr = mimeMatch ? mimeMatch[1] : 'image/jpeg';
          
          parts.push({
            inline_data: {
              mime_type: mimeTypeStr,
              data: base64
            }
          });
        } else {
          // Fallback to text if conversion fails
          parts.push({ text: `[Image: ${url}]` });
        }
      } catch (error) {
        console.warn('Failed to process image:', url, error);
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
    const rowRelative = rowSelParts.length > 1 ? rowSelParts.slice(1).join(" ") : rowSel;
    const rows = Array.from(
      scopeEl ? scopeEl.querySelectorAll(rowRelative) : document.querySelectorAll(rowSel)
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
          /^(WE HAVE YOUR BACK|Learn more|This message relates to:|Translate to English)$/i.test(tx) ||
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

      const displayText = text || "(image attachment(s) only — no text in this message)";
      items.push({ role, timeStr, text: displayText, images });
    });

    let lines = items.map((it) => {
      const label = it.role === "seller" ? "seller" : it.role === "buyer" ? "buyer" : "unknown";
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
        const label = it.role === "seller" ? "seller" : it.role === "buyer" ? "buyer" : "unknown";
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
    const rowRelative = rowSelParts.length > 1 ? rowSelParts.slice(1).join(" ") : rowSel;
    const rows = Array.from(
      scopeEl ? scopeEl.querySelectorAll(rowRelative) : document.querySelectorAll(rowSel)
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
          /^(WE HAVE YOUR BACK|Learn more|This message relates to:|Translate to English)$/i.test(tx) ||
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
   * @param {string} kind
   * @param {string} transcript
   * @param {() => object} getSettings
   * @param {{ costPrice?: string }} presetOptions
   */
  function buildPresetUserText(kind, transcript, getSettings, presetOptions) {
    const opt = presetOptions || {};
    const costPrice = (opt.costPrice && String(opt.costPrice).trim()) || "";
    const sellerName = getSellerDisplayName(getSettings);
    const ctx = "Seller name for natural use: " + sellerName + "\n\nThread transcript:\n" + transcript + "\n";
    switch (kind) {
      case "first":
        return (
          ctx +
          "Task: Write a short first reply for a new or early thread. Thank them and show you take their project seriously. " +
          "If the buyer has already described their task, goals, or requirements in the thread, reflect that understanding and respond to what they said—do not ask them to “send requirements” or repeat a generic laundry list of things you need. " +
          "Only ask for further details or clarifications for gaps that are actually missing from their messages. If the thread has no real task content yet, then it is fine to invite what you need to proceed. Sound capable and easy to work with—no hype. Output only the message."
        );
      case "reply":
        return (
          ctx +
          "Task: Reply professionally to the buyer’s latest message using full thread context. Address their points clearly, show understanding, and where appropriate signal readiness to move forward once scope is aligned—dependable and solution-oriented, never pushy. Output only the message."
        );
      case "clarify":
        return (
          ctx +
          "Task: Write one short professional message whose purpose is to get clearer on the buyer’s task before quoting or starting work. Base it only on what appears in the thread: briefly mirror what you understood so far, then ask a small number of specific, concrete questions that would remove real ambiguity (e.g. deliverables, format, deadline, references, constraints)—not a generic ‘please send requirements’ dump. " +
          "If the thread is vague, say so politely and invite the missing pieces. If they already gave enough detail, ask only the few remaining gaps. Collaborative tone, no blame, no invented assumptions. Output only the message."
        );
      case "cost": {
        const withPrice = costPrice
          ? " The seller’s stated price to communicate is: " +
            costPrice +
            ". Quote that figure confidently and professionally; keep it consistent with the thread context; do not add other dollar amounts unless they already appear in the transcript."
          : " Use only amounts or ranges discussed in the thread; if budget/pricing is unknown, ask professional clarifying questions—do not invent numbers.";
        return (
          ctx +
          "Task: One message about pricing." +
          withPrice +
          " Sound confident and fair; briefly tie price to value only when supported by the thread. Output only the message."
        );
      }
      case "quote":
        return (
          ctx +
          "Task: A structured quote-style message: scope, deliverables, timeline, revision policy if inferable; otherwise neutral professional wording. No invented specifics. Present it so the buyer can compare options and feel confident proceeding—clear headings or lines are fine inside the message text. Output only the message."
        );
      case "cool":
        return ctx + "Task: A cool-down / de-escalation message: empathy, commitment to fix, professional. Output only the message.";
      case "postdelivery":
        return (
          ctx +
          "Task: One message for the buyer around or after order delivery, based only on what appears in the thread (scope, gig, revisions if mentioned). Goals: (1) Thank them and confirm you stand behind the delivery as agreed. (2) Invite them to flag any genuine error, bug, or mismatch with the agreed scope that you will correct—professional and constructive. (3) Clearly and politely explain that once the work is delivered per the order, any new ideas, redesigns, extra features, or changes they want after delivery are not treated as revisions under that order: revisions (if the gig/order included them) apply to refining the agreed deliverable within scope, not open-ended post-delivery change requests. Suggest that new or additional work after delivery can be handled through a new custom offer or order if they need it—without sounding hostile or refusing legitimate fixes for mistakes in what was delivered. (4) Keep it short, professional, and Fiverr-appropriate. Do not invent package details, revision counts, or guarantees not supported by the conversation. Output only the message."
        );
      default:
        return ctx;
    }
  }

  /**
   * @param {string} kind preset id (e.g. "first")
   * @param {() => object} getSettings
   * @returns {Promise<string>}
   */
  async function generatePresetReply(kind, getSettings) {
    const sellerName = getSellerDisplayName(getSettings);
    const sys =
      BASE_SYSTEM_PROMPT +
      " Seller display name (use when natural): " +
      sellerName +
      ". Aim for a reply that leaves the buyer confident this seller is reliable and the right fit—without pressure or empty claims.";
    const { text: transcript, imageUrls } = buildInboxTranscript(getSettings);
    const userText = buildPresetUserText(kind, transcript, getSettings, { costPrice: "" });
    const userContent = await buildUserContentWithImages(userText, imageUrls, getSettings);
    return geminiGenerateContent(
      getSettings,
      [
        { role: "system", content: sys },
        { role: "user", content: userContent },
      ],
      { temperature: 0.45 }
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
      if (bodySnippet && /api.key.invalid/i.test(bodySnippet)) {
        return "Invalid API key (400). Check your Gemini API key in extension settings.";
      }
      if (bodySnippet && /unsupported.image/i.test(bodySnippet)) {
        return "Request failed (400). An attachment URL was not a supported image type (use PNG, JPEG, GIF, or WebP).";
      }
      return "Bad request (400). Check request format.";
    }
    if (status === 401) return "Invalid API key (401). Check your Gemini API key in extension settings.";
    if (status === 403) return "Access forbidden (403). API key may not have permission for this model.";
    if (status === 429) return "Rate limited (429). Gemini API is experiencing high demand. Please try again in a few moments.";
    if (status === 503) return "Service unavailable (503). Gemini API is currently experiencing high demand. Please try again later.";
    if (status === 0 || status >= 500) {
      if (bodySnippet && /high demand|currently experiencing/i.test(bodySnippet)) {
        return "Gemini API is experiencing high demand. This is temporary - please try again in a few moments.";
      }
      return "Gemini API or network error. Try again.";
    }
    return "Request failed (" + status + ").";
  }

  /**
   * Convert OpenAI-style messages to Gemini format
   * @param {Array} messages - OpenAI format [{role, content}]
   * @returns {Array} Gemini format [{role, parts}]
   */
  function convertMessagesToGeminiFormat(messages) {
    return messages.map(msg => {
      if (typeof msg.content === 'string') {
        return {
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        };
      } else if (Array.isArray(msg.content)) {
        // Handle multimodal content
        const parts = msg.content.map(part => {
          if (part.type === 'text') {
            return { text: part.text };
          } else if (part.type === 'image_url') {
            // For now, we'll handle images as URLs in text
            // In a full implementation, we'd need to fetch and convert to base64
            return { text: `[Image: ${part.image_url.url}]` };
          }
          return { text: '' };
        });
        return {
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: parts.filter(p => p.text)
        };
      } else if (msg.content && msg.content.parts) {
        // Already in Gemini format
        return {
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: msg.content.parts
        };
      } else if (msg.content && msg.content.text) {
        // Gemini format with single text part
        return {
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content.text }]
        };
      }
      // Fallback
      return {
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(msg.content || '') }]
      };
    });
  }

  /**
   * Sleep function for retry delays
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Never log secrets. Safe error for UI only.
   */
  async function geminiGenerateContent(getSettings, messages, options) {
    const s = getSettings();
    const apiKey = (s && s.geminiApiKey && String(s.geminiApiKey).trim()) || "";
    if (!apiKey) {
      throw new Error("Add your Gemini API key in Fiverr Assistant settings.");
    }
    const model = (s && s.geminiModel && String(s.geminiModel).trim()) || "gemini-2.5-flash";
    
    const geminiMessages = convertMessagesToGeminiFormat(messages);
    
    const body = {
      contents: geminiMessages,
      generationConfig: {
        temperature: options && typeof options.temperature === "number" ? options.temperature : 0.7,
        maxOutputTokens: 8192,
      },
    };

    const url = `${GEMINI_CHAT_URL}${model}:generateContent`;
    
    // Retry mechanism for rate limiting and high demand errors
    const maxRetries = 3;
    const baseDelay = 1000; // 1 second
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const res = await fetch(`${url}?key=${apiKey}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        const rawText = await res.text();
        let data;
        try {
          data = JSON.parse(rawText);
        } catch (_) {
          data = null;
        }

        if (!res.ok) {
          const apiErr = data && data.error && typeof data.error.message === "string" ? data.error.message : "";
          
          // Check if this is a retryable error
          const isRetryable = (
            res.status === 429 || // Rate limited
            res.status === 503 || // Service unavailable
            (res.status >= 500 && /high demand|currently experiencing/i.test(apiErr)) || // High demand message
            (res.status === 0 && attempt < maxRetries - 1) // Network error (but not on last attempt)
          );
          
          if (isRetryable && attempt < maxRetries - 1) {
            const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000; // Exponential backoff with jitter
            console.log(`Gemini API retry ${attempt + 1}/${maxRetries} after ${delay}ms due to: ${res.status} ${apiErr}`);
            await sleep(delay);
            continue;
          }
          
          // Not retryable or last attempt - throw error
          let msg = mapGeminiError(res.status, apiErr);
          if (apiErr && !/api[_-]?key/i.test(apiErr)) {
            if (!(res.status === 400 && /unsupported.image/i.test(apiErr))) {
              msg = msg + " " + apiErr.slice(0, 200);
            }
          }
          throw new Error(msg.trim());
        }
        
        // Success - parse response
        const candidate = data && data.candidates && data.candidates[0];
        const content = candidate && candidate.content;
        const parts = content && content.parts;
        
        if (parts && parts.length > 0) {
          const textParts = parts
            .filter((p) => p && p.text)
            .map((p) => p.text);
          return stripFencesAndPreamble(textParts.join("\n"));
        }
        
        return "";
        
      } catch (error) {
        // If this is the last attempt, re-throw the error
        if (attempt === maxRetries - 1) {
          throw error;
        }
        
        // For network errors, retry with exponential backoff
        if (error.message.includes("network") || error.message.includes("fetch")) {
          const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
          console.log(`Gemini API retry ${attempt + 1}/${maxRetries} after ${delay}ms due to network error`);
          await sleep(delay);
          continue;
        }
        
        // For other errors, don't retry
        throw error;
      }
    }
    
    throw new Error("Gemini API request failed after all retries.");
  }

  function injectModalStyles() {
    if (document.getElementById("far-inbox-ai-styles")) return;
    const st = document.createElement("style");
    st.id = "far-inbox-ai-styles";
    st.textContent =
      ".far-ia-backdrop{position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:100002;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;}" +
      ".far-ia-task-modal{z-index:100003;}" +
      ".far-ia-dialog{background:#fff;color:#0e0e10;border-radius:12px;max-width:560px;width:100%;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,0.25);font-family:system-ui,-apple-system,sans-serif;font-size:14px;}" +
      ".far-ia-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #e2e8f0;background:#fafafa;}" +
      ".far-ia-title{font-weight:700;font-size:15px;color:#1dbf73;}" +
      ".far-ia-body{padding:12px 16px;overflow-y:auto;flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;}" +
      ".far-ia-presets{display:flex;flex-direction:column;gap:6px;}" +
      ".far-ia-cost-row{display:flex;flex-direction:row;align-items:stretch;gap:8px;width:100%;}" +
      ".far-ia-cost-input{flex:0 0 118px;min-width:96px;max-width:168px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;box-sizing:border-box;font:inherit;}" +
      ".far-ia-cost-input:focus{outline:2px solid rgba(29,191,115,0.35);outline-offset:1px;}" +
      ".far-ia-btn.far-ia-cost-btn{flex:1;min-width:0;text-align:left;}" +
      ".far-ia-btn{text-align:left;padding:10px 12px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;cursor:pointer;font-size:13px;line-height:1.35;}" +
      ".far-ia-btn:hover{border-color:#1dbf73;background:#f0fdf4;}" +
      ".far-ia-btn:disabled{opacity:0.55;cursor:not-allowed;}" +
      ".far-ia-out{width:100%;min-height:100px;max-height:200px;resize:vertical;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;box-sizing:border-box;}" +
      ".far-ia-err{color:#b91c1c;font-size:13px;}" +
      ".far-ia-chat-log{min-height:60px;max-height:140px;overflow-y:auto;font-size:12px;color:#475569;border:1px solid #e2e8f0;border-radius:8px;padding:8px;background:#f8fafc;}" +
      ".far-ia-chat-row{margin-bottom:6px;}" +
      ".far-ia-chat-input-row{display:flex;gap:8px;align-items:flex-end;}" +
      ".far-ia-chat-input{flex:1;min-height:40px;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;resize:vertical;}" +
      ".far-ia-seller-note{width:100%;min-height:64px;max-height:140px;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;line-height:1.4;resize:vertical;font:inherit;}" +
      ".far-ia-seller-note:focus{outline:2px solid rgba(29,191,115,0.35);outline-offset:1px;}" +
      ".far-ia-small{font-size:11px;color:#64748b;}" +
      ".far-ia-ai-toggle{display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:8px;border:1px solid #c4c4c4;background:#fff;color:#222;cursor:pointer;padding:0;}" +
      ".far-ia-ai-toggle:hover{background:#f5f5f5;}" +
      ".far-ia-ai-toggle--on{border-color:#1dbf73;background:#1dbf73;color:#fff;}" +
      ".far-ia-task-modal .far-ia-out{min-height:160px;max-height:40vh;white-space:pre-wrap;}";
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
    observer.observe(document.documentElement, { childList: true, subtree: true });
    schedule();
  }

  function injectCustomOfferDescriptionButton(getSettings) {
    const ta = document.querySelector(CUSTOM_OFFER_DESCRIPTION_TEXTAREA_SELECTOR);
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
      const { text: transcript, imageUrls } = buildInboxTranscript(getSettings);
      const form = ta.closest("form");
      const gigHeading =
        form && form.querySelector('h6[data-track-tag="heading"]');
      const titleText = gigHeading ? String(gigHeading.textContent || "").replace(/\s+/g, " ").trim() : "";

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

      const userContent = await buildUserContentWithImages(userText, imageUrls, getSettings);

      geminiGenerateContent(
        getSettings,
        [
          { role: "system", content: sys },
          { role: "user", content: userContent },
        ],
        { temperature: 0.45 }
      )
        .then((text) => {
          let out = (text || "").trim();
          const maxLen = parseInt(ta.getAttribute("maxlength") || "1500", 10) || 1500;
          if (out.length > maxLen) out = out.slice(0, maxLen);
          ta.value = out;
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          ta.dispatchEvent(new Event("change", { bubbles: true }));
          ta.focus();
        })
        .catch((e) => {
          err.textContent = e.message || "Could not generate description.";
          err.style.display = "block";
        })
        .finally(() => {
          btn.disabled = false;
        });
    });

    wrap.appendChild(btn);
    wrap.appendChild(err);
    col.appendChild(wrap);
  }

  function trapFocus(dialog) {
    const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const nodes = () => Array.from(dialog.querySelectorAll(sel)).filter((el) => !el.disabled && el.offsetParent !== null);
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

  function attachToolbarButton(toolbarRow, sendTa, _root, getSettings) {
    injectModalStyles();

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "far-ia-ai-toggle";
    btn.title = "AI reply assistant";
    btn.setAttribute("aria-label", "Open AI reply assistant");
    btn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18v-5M9 21h6M8 5a4 4 0 1 1 8 0v3H8V5z"/></svg>';
    toolbarRow.appendChild(btn);

    let backdrop = null;

    function closeModal() {
      const tasks = document.querySelectorAll(".far-ia-task-modal");
      tasks.forEach((n) => n.remove());
      if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      backdrop = null;
      btn.classList.remove("far-ia-ai-toggle--on");
      document.removeEventListener("keydown", onEsc);
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
      const wrap = document.createElement("div");
      wrap.className = "far-ia-backdrop far-ia-task-modal";
      wrap.setAttribute("role", "dialog");
      wrap.setAttribute("aria-modal", "true");
      const dlg = document.createElement("div");
      dlg.className = "far-ia-dialog";
      dlg.innerHTML =
        '<div class="far-ia-head"><span class="far-ia-title">Task explanation</span><button type="button" class="far-ia-btn" data-close style="max-width:80px">Close</button></div>' +
        '<div class="far-ia-body"><p class="far-ia-small">Bangla and English summaries of what the buyer wants (from the thread).</p>' +
        '<div class="far-ia-small" style="font-weight:600">BN</div>' +
        '<div data-out-bn class="far-ia-out" readonly style="pointer-events:none;background:#f8fafc"></div>' +
        '<div class="far-ia-small" style="font-weight:600">EN</div>' +
        '<div data-out-en class="far-ia-out" readonly style="pointer-events:none;background:#f8fafc"></div>' +
        '<p data-err class="far-ia-err" style="display:none"></p></div>';
      wrap.appendChild(dlg);
      document.body.appendChild(wrap);

      const outBn = dlg.querySelector("[data-out-bn]");
      const outEn = dlg.querySelector("[data-out-en]");
      const errEl = dlg.querySelector("[data-err]");
      dlg.querySelector("[data-close]").addEventListener("click", () => wrap.remove());
      wrap.addEventListener("click", (e) => {
        if (e.target === wrap) wrap.remove();
      });

      const sellerName = getSellerDisplayName(getSettings);
      const { text: transcript, imageUrls } = buildInboxTranscript(getSettings);
      const sys =
        TASK_SUMMARY_SYSTEM_PROMPT + "Base the summary only on the thread and any attached images.";
      let userText = "Seller display name: " + sellerName + "\n\nConversation:\n" + transcript;
      const noteExtra = (sellerPrivateNote && String(sellerPrivateNote).trim()) || "";
      if (noteExtra) {
        userText += "\n\nSeller focus for this summary (optional nuance only; stay faithful to the thread):\n" + noteExtra;
      }
      const userContent = await buildUserContentWithImages(userText, imageUrls, getSettings);

      errEl.style.display = "none";
      outBn.textContent = "Loading…";
      outEn.textContent = "";

      geminiGenerateContent(
        getSettings,
        [
          { role: "system", content: sys },
          { role: "user", content: userContent },
        ],
        { temperature: 0.3 }
      )
        .then((raw) => {
          const parts = raw.split(/\bEN:\s*/i);
          let bn = parts[0] || "";
          bn = bn.replace(/^\s*BN:\s*/i, "").trim();
          const en = parts.length > 1 ? parts.slice(1).join("EN:").trim() : "";
          outBn.textContent = bn || raw.trim();
          outEn.textContent = en || "";
          if (!outEn.textContent) {
            outEn.textContent = "(If English is missing above, copy from the BN block or run again.)";
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

      /** @type {{role:string,content:string}[]} */
      let chatPanelHistory = [];

      backdrop = document.createElement("div");
      backdrop.className = "far-ia-backdrop";
      backdrop.setAttribute("role", "dialog");
      backdrop.setAttribute("aria-modal", "true");
      const dlg = document.createElement("div");
      dlg.className = "far-ia-dialog";
      dlg.innerHTML =
        '<div class="far-ia-head"><span class="far-ia-title">AI inbox assistant</span><button type="button" class="far-ia-btn" data-x style="max-width:72px">Close</button></div>' +
        '<div class="far-ia-body">' +
        '<p class="far-ia-small">Uses the visible conversation as context. Buyer image attachments in the thread are included for vision-capable models (e.g. gemini-2.5-flash). Paste the output into Fiverr when ready.</p>' +
        '<div class="far-ia-loading-text" style="color:#64748b; font-size:12px; margin-bottom:8px; display:none;"></div>' +
        '<label class="far-ia-small" for="far-ia-seller-note" style="font-weight:600;color:#475569">Your note to the AI (optional)</label>' +
        '<textarea id="far-ia-seller-note" class="far-ia-seller-note" data-seller-note rows="3" placeholder="Tone, constraints, price to mention or avoid, deadline, context not in the thread… Not sent to the buyer." aria-label="Private note for AI"></textarea>' +
        '<div class="far-ia-presets">' +
        '<button type="button" class="far-ia-btn" data-a="first">Generate first message — short welcome; invite requirements</button>' +
        '<button type="button" class="far-ia-btn" data-a="reply">Generate professional response — reply to buyer’s last message</button>' +
        '<button type="button" class="far-ia-btn" data-a="clarify">Generate clarification message — ask focused questions from the thread</button>' +
        '<div class="far-ia-cost-row">' +
        '<input type="text" class="far-ia-cost-input" data-cost-input placeholder="$ / price" title="Your price to mention in the cost message" aria-label="Your cost or price" />' +
        '<button type="button" class="far-ia-btn far-ia-cost-btn" data-a="cost">Generate cost message</button>' +
        "</div>" +
        '<button type="button" class="far-ia-btn" data-a="quote">Generate quote message — structured quote; no invented specifics</button>' +
        '<button type="button" class="far-ia-btn" data-a="cool">Generate cool-down message — de-escalation, empathy</button>' +
        '<button type="button" class="far-ia-btn" data-a="postdelivery">After delivery — set expectations (revisions vs new work; reduce post-delivery scope creep)</button>' +
        '<button type="button" class="far-ia-btn" data-a="task">Generate task explanation — Bangla + English (new window)</button>' +
        "</div>" +
        '<textarea class="far-ia-out" readonly placeholder="Generated message appears here…" data-out></textarea>' +
        '<p class="far-ia-err" data-err style="display:none"></p>' +
        '<div class="far-ia-small">Chat about this thread</div>' +
        '<div class="far-ia-chat-log" data-chat-log></div>' +
        '<div class="far-ia-chat-input-row">' +
        '<textarea class="far-ia-chat-input" data-chat-in placeholder="Ask for a rewrite, shorter text, tone change…" rows="2"></textarea>' +
        '<button type="button" class="far-ia-btn" data-chat-send style="max-width:88px">Send</button>' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
        '<button type="button" class="far-ia-btn" data-copy style="max-width:120px">Copy output</button>' +
        '<button type="button" class="far-ia-btn" data-insert style="max-width:180px;display:none">Insert into message box</button>' +
        "</div>" +
        "</div>";

      backdrop.appendChild(dlg);
      document.body.appendChild(backdrop);

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
        dlg.querySelectorAll(".far-ia-btn[data-a], [data-chat-send]").forEach((b) => {
          b.disabled = isLoading;
        });
        
        // Update loading text to show retry information
        if (retryInfo) {
          const loadingText = dlg.querySelector('.far-ia-loading-text');
          if (loadingText) {
            loadingText.textContent = `Gemini API is busy... Retrying ${retryInfo.current}/${retryInfo.max} (${retryInfo.delay}s)`;
          }
        }
      }

      function logChat(role, text) {
        const row = document.createElement("div");
        row.className = "far-ia-chat-row";
        row.textContent = (role === "user" ? "You: " : "AI: ") + text;
        chatLog.appendChild(row);
        chatLog.scrollTop = chatLog.scrollHeight;
      }

      function presetInstruction(kind, transcript) {
        const myCost = (costInput && String(costInput.value || "").trim()) || "";
        return buildPresetUserText(kind, transcript, getSettings, { costPrice: myCost });
      }

      async function runPreset(kind) {
        chatPanelHistory = [];
        chatLog.innerHTML = "";
        err.style.display = "none";
        out.value = "";
        setLoading(true);
        
        // Show loading text
        const loadingText = dlg.querySelector('.far-ia-loading-text');
        if (loadingText) loadingText.style.display = 'block';
        const sellerName = getSellerDisplayName(getSettings);
        const sys =
          BASE_SYSTEM_PROMPT +
          " Seller display name (use when natural): " +
          sellerName +
          ". Aim for a reply that leaves the buyer confident this seller is reliable and the right fit—without pressure or empty claims.";
        const { text: transcript, imageUrls } = buildInboxTranscript(getSettings);
        const userText = appendSellerNoteForApi(presetInstruction(kind, transcript));
        const userContent = await buildUserContentWithImages(userText, imageUrls, getSettings);
        geminiGenerateContent(getSettings, [
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
            const loadingText = dlg.querySelector('.far-ia-loading-text');
            if (loadingText) loadingText.style.display = 'none';
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
          runPreset(kind);
        });
      });

      dlg.querySelector("[data-copy]").addEventListener("click", () => {
        out.select();
        document.execCommand("copy");
      });

      dlg.querySelector("[data-chat-send]").addEventListener("click", async () => {
        let q = (chatIn.value || "").trim();
        if (!q) return;
        const noteBlock = noteTa ? String(noteTa.value || "").trim() : "";
        err.style.display = "none";
        logChat("user", q);
        chatIn.value = "";
        setLoading(true);
        
        // Show loading text
        const loadingText = dlg.querySelector('.far-ia-loading-text');
        if (loadingText) loadingText.style.display = 'block';

        const sellerName = getSellerDisplayName(getSettings);
        const { text: transcript, imageUrls } = buildInboxTranscript(getSettings);
        const sys =
          BASE_SYSTEM_PROMPT +
          " Seller: " +
          sellerName +
          ". Default: paste-ready single message only, same professional standard—trust-building and clear, not salesy. If the user asks for analysis, you may use short bullets without filler phrases.";

        const messages = [{ role: "system", content: sys }];
        let firstUserContentForHistory = null;
        if (chatPanelHistory.length === 0) {
          let firstText = "Fiverr thread (context):\n" + transcript + "\n\nUser request:\n" + q;
          if (noteBlock) {
            firstText +=
              "\n\n---\nSeller private note (internal—do not paste verbatim to the buyer):\n" + noteBlock;
          }
          firstUserContentForHistory = await buildUserContentWithImages(firstText, imageUrls, getSettings);
          messages.push({ role: "user", content: firstUserContentForHistory });
        } else {
          const cap = chatPanelHistory.slice(-CHAT_HISTORY_MAX_TURNS);
          messages.push(...cap);
          const followText =
            noteBlock
              ? q + "\n\n---\nSeller private note (internal—do not paste verbatim):\n" + noteBlock
              : q;
          messages.push({ role: "user", content: followText });
        }

        geminiGenerateContent(getSettings, messages)
          .then((t) => {
            out.value = t;
            logChat("assistant", t);
            if (chatPanelHistory.length === 0) {
              chatPanelHistory.push(
                { role: "user", content: firstUserContentForHistory },
                { role: "assistant", content: t }
              );
            } else {
              chatPanelHistory.push(
                {
                  role: "user",
                  content:
                    noteBlock
                      ? q + "\n\n---\nSeller private note (internal):\n" + noteBlock
                      : q,
                },
                { role: "assistant", content: t }
              );
            }
          })
          .catch((e) => {
            err.textContent = e.message || "Error";
            err.style.display = "block";
          })
          .finally(() => {
            setLoading(false);
            const loadingText = dlg.querySelector('.far-ia-loading-text');
            if (loadingText) loadingText.style.display = 'none';
          });
      });

      trapFocus(dlg);
      dlg.querySelector("[data-x]").focus();
    }

    btn.addEventListener("click", () => {
      openMainModal();
    });
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
