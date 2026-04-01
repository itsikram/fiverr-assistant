/**
 * Fiverr Assistant — OpenAI inbox reply helper (content script module).
 *
 * SELECTORS — paste paths from DevTools if Fiverr changes the inbox DOM:
 * - INBOX_MESSAGE_LIST_SELECTOR / inboxMessageListSelector option: scroll/list root (default `.message-flow`).
 * - INBOX_MESSAGE_ROW_SELECTOR / inboxMessageRowSelector option: each chat row (default `.message-flow .message`).
 * Rows are classified as seller if the header shows “Me” or avatar `data-track-value` matches profile username.
 *
 * MODEL: `openaiModel` in options (default `gpt-4o-mini`). Use a vision-capable model so buyer attachments (`.attachments-list`, secured Cloudinary URLs) are sent as images; gpt-3.5 gets URLs in text only.
 */
(function () {
  "use strict";

  const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
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

  function modelSupportsVision(modelName) {
    const m = String(modelName || "").toLowerCase().trim();
    if (!m) return true;
    if (/gpt-3\.5|gpt-3\.0|davinci|babbage|curie|ada/.test(m)) return false;
    if (/gpt-4o|gpt-4-turbo|gpt-4\.1|gpt-5|o3|o4|vision/.test(m)) return true;
    if (/^gpt-4[^o-]|^gpt-4$/.test(m)) return true;
    return /gpt-4|gpt-5/.test(m);
  }

  /**
   * @param {string} text
   * @param {string[]} imageUrls
   * @param {() => object} getSettings
   * @returns {string|object[]}
   */
  function buildUserContentWithImages(text, imageUrls, getSettings) {
    const model = (getSettings().openaiModel && String(getSettings().openaiModel).trim()) || "gpt-4o-mini";
    const urls = Array.from(new Set((imageUrls || []).filter(Boolean))).slice(0, MAX_THREAD_IMAGES);
    if (urls.length === 0) return text;

    const vision = modelSupportsVision(model);
    const note =
      "\n\nThe following image(s) are attachments from this Fiverr conversation (chronological). Use them when the buyer shared screenshots, errors, designs, or files.";

    if (!vision) {
      return (
        text +
        note +
        "\n\n[Your model may not support vision. Image URLs from the thread:]\n" +
        urls.map((u, i) => i + 1 + ". " + u).join("\n")
      );
    }

    const parts = [{ type: "text", text: text + note }];
    urls.forEach((url) => {
      parts.push({ type: "image_url", image_url: { url: url, detail: "auto" } });
    });
    return parts;
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
    const userContent = buildUserContentWithImages(userText, imageUrls, getSettings);
    return openaiChatCompletion(
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

  function mapOpenAIError(status, bodySnippet) {
    if (status === 401) return "Invalid API key (401). Check your key in extension settings.";
    if (status === 429) return "Rate limited (429). Try again shortly.";
    if (status === 0 || status >= 500) return "OpenAI or network error. Try again.";
    return "Request failed (" + status + ").";
  }

  /**
   * Never log secrets. Safe error for UI only.
   */
  async function openaiChatCompletion(getSettings, messages, options) {
    const s = getSettings();
    const apiKey = (s && s.openaiApiKey && String(s.openaiApiKey).trim()) || "";
    if (!apiKey) {
      throw new Error("Add your OpenAI API key in Fiverr Assistant settings.");
    }
    const model = (s && s.openaiModel && String(s.openaiModel).trim()) || "gpt-4o-mini";

    const body = {
      model,
      temperature: options && typeof options.temperature === "number" ? options.temperature : 0.5,
      messages,
    };

    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
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
      const apiErr =
        data && data.error && typeof data.error.message === "string" ? data.error.message : "";
      let msg = mapOpenAIError(res.status, "");
      if (apiErr && !/sk-|api[_-]?key/i.test(apiErr)) {
        msg = msg + " " + apiErr.slice(0, 200);
      }
      throw new Error(msg.trim());
    }
    const choice = data && data.choices && data.choices[0] && data.choices[0].message;
    let rawContent = choice && choice.content;
    if (typeof rawContent === "string") {
      return stripFencesAndPreamble(rawContent);
    }
    if (Array.isArray(rawContent)) {
      const textParts = rawContent
        .filter((p) => p && p.type === "text" && p.text)
        .map((p) => p.text);
      return stripFencesAndPreamble(textParts.join("\n"));
    }
    return "";
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

    btn.addEventListener("click", () => {
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

      const userContent = buildUserContentWithImages(userText, imageUrls, getSettings);

      openaiChatCompletion(
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

    function openTaskExplanationModal(sellerPrivateNote) {
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
      const userContent = buildUserContentWithImages(userText, imageUrls, getSettings);

      errEl.style.display = "none";
      outBn.textContent = "Loading…";
      outEn.textContent = "";

      openaiChatCompletion(
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
        '<p class="far-ia-small">Uses the visible conversation as context. Buyer image attachments in the thread are included for vision-capable models (e.g. gpt-4o-mini). Paste the output into Fiverr when ready.</p>' +
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

      function setLoading(isLoading) {
        dlg.querySelectorAll(".far-ia-btn[data-a], [data-chat-send]").forEach((b) => {
          b.disabled = isLoading;
        });
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

      function runPreset(kind) {
        chatPanelHistory = [];
        chatLog.innerHTML = "";
        err.style.display = "none";
        out.value = "";
        setLoading(true);
        const sellerName = getSellerDisplayName(getSettings);
        const sys =
          BASE_SYSTEM_PROMPT +
          " Seller display name (use when natural): " +
          sellerName +
          ". Aim for a reply that leaves the buyer confident this seller is reliable and the right fit—without pressure or empty claims.";
        const { text: transcript, imageUrls } = buildInboxTranscript(getSettings);
        const userText = appendSellerNoteForApi(presetInstruction(kind, transcript));
        const userContent = buildUserContentWithImages(userText, imageUrls, getSettings);
        openaiChatCompletion(getSettings, [
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
          .finally(() => setLoading(false));
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

      dlg.querySelector("[data-chat-send]").addEventListener("click", () => {
        let q = (chatIn.value || "").trim();
        if (!q) return;
        const noteBlock = noteTa ? String(noteTa.value || "").trim() : "";
        err.style.display = "none";
        logChat("user", q);
        chatIn.value = "";
        setLoading(true);

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
          firstUserContentForHistory = buildUserContentWithImages(firstText, imageUrls, getSettings);
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

        openaiChatCompletion(getSettings, messages)
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
          .finally(() => setLoading(false));
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
