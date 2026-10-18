// Health Chat Helper — Modern Conversational Clinical Assistant
// Powered by DeepSeek-V4.1-Flash on River AI, grounded in NIH MedlinePlus & OpenFDA databases

// UI Element Bindings
const messages = document.querySelector("#messages");
const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const sendLabel = document.querySelector(".send-label");
const sendIcon = document.querySelector(".send-icon");
const spinnerIcon = document.querySelector(".spinner-icon");
const clearInputBtn = document.querySelector("#clear-input-btn");
const voiceInputBtn = document.querySelector("#voice-input-btn");
const installAppButton = document.querySelector("#install-app");
const newChatButton = document.querySelector("#new-chat");
const themeToggleBtn = document.querySelector("#theme-toggle");
const exportSummaryBtn = document.querySelector("#export-summary-btn");
const dismissNoticeBtn = document.querySelector("#dismiss-notice");
const emergencyGuidelineBar = document.querySelector(".emergency-guideline-bar");
const quickButtons = document.querySelectorAll("[data-prompt]");
const dashboardTopic = document.querySelector("#dashboard-topic");
const dashboardProgress = document.querySelector("#dashboard-progress");
const dashboardPriority = document.querySelector("#dashboard-priority");
const statusPill = document.querySelector("#status-pill");
const summaryModal = document.querySelector("#summary-modal");
const closeModalBtn = document.querySelector("#close-modal-btn");
const dismissModalBtn = document.querySelector("#dismiss-modal-btn");
const printSummaryBtn = document.querySelector("#print-summary-btn");
const modalBody = document.querySelector("#modal-body");
const toast = document.querySelector("#toast");

// Storage & Configuration Keys
const recordStoreKey = "health-chat-helper-records-v1";
const themeStoreKey = "health-chat-theme-v1";
const maxStoredRecords = 100;

let deferredInstallPrompt = null;
let isApiConnected = false;
let isGenerating = false;
let speechRecognizer = null;
let isListening = false;
let currentSpeakingUtterance = null;
let toastTimeout = null;

const greetingMessage =
  "Hello! I am **Health Chat Helper**, your AI clinical and wellness assistant powered by **DeepSeek-V4.1-Flash** on River AI, deeply grounded in the **U.S. National Library of Medicine (NIH MedlinePlus)** and **U.S. FDA Drug Database**.\n\nYou can describe your symptoms, ask about medication safety, explore self-care remedies, or discuss any health question naturally. How can I help you today?";

// Conversation Memory for DeepSeek
const conversationHistory = [];

const sessionState = {
  topic: "General Inquiry",
  turnCount: 0,
  priority: { label: "Ready", tone: "stable" },
  warnings: "None detected",
  lastSources: [],
  sessionStart: new Date(),
};

// --- Theme Management ---
function initTheme() {
  const savedTheme = localStorage.getItem(themeStoreKey);
  const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const initialTheme = savedTheme || (systemPrefersDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", initialTheme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(themeStoreKey, next);
  showToast(`Switched to ${next} theme`);
}

// --- Toast Notifications ---
function showToast(text, duration = 2500) {
  if (!toast) return;
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.hidden = true;
  }, duration);
}

// --- Markdown Renderer ---
function renderMarkdown(md) {
  if (!md) return "";

  let text = md.replace(/\r\n/g, "\n");

  // Headings
  text = text.replace(/^### (.*$)/gim, "<h3>$1</h3>");
  text = text.replace(/^## (.*$)/gim, "<h2>$1</h2>");
  text = text.replace(/^# (.*$)/gim, "<h2>$1</h2>");

  // Bold & Italic
  text = text.replace(/\*\*\*(.*?)\*\*\*/gim, "<strong><em>$1</em></strong>");
  text = text.replace(/\*\*(.*?)\*\*/gim, "<strong>$1</strong>");
  text = text.replace(/\*(.*?)\*/gim, "<em>$1</em>");

  // Markdown links [text](url)
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/gim,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1 ↗</a>'
  );

  // Raw URLs
  text = text.replace(
    /(^|[^"'>])(https?:\/\/[^\s\)<>]+)/gim,
    '$1<a href="$2" target="_blank" rel="noopener noreferrer">Official Reference ↗</a>'
  );

  // Unordered list items (- or *)
  text = text.replace(/^\s*[-*]\s+(.*)$/gim, "<li>$1</li>");
  text = text.replace(/(<li>[\s\S]*?<\/li>)/gim, "<ul>$1</ul>");
  text = text.replace(/<\/ul>\s*<ul>/gim, "");

  // Paragraphs
  const blocks = text.split(/\n\s*\n/);
  return blocks
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (
        trimmed.startsWith("<h2") ||
        trimmed.startsWith("<h3") ||
        trimmed.startsWith("<ul") ||
        trimmed.startsWith("<ol")
      ) {
        return trimmed;
      }
      return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}

// --- Text-to-Speech (Read Aloud) ---
function speakText(rawContent, buttonEl) {
  if (!("speechSynthesis" in window)) {
    showToast("Text-to-speech is not supported on this browser.");
    return;
  }

  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    if (buttonEl.classList.contains("active")) {
      buttonEl.classList.remove("active");
      buttonEl.querySelector("span").textContent = "Listen";
      return;
    }
  }

  // Strip markdown tags for natural speech
  const cleanSpeechText = rawContent
    .replace(/[#*_`]/g, "")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "");

  const utterance = new SpeechSynthesisUtterance(cleanSpeechText);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  buttonEl.classList.add("active");
  buttonEl.querySelector("span").textContent = "Stop";

  utterance.onend = () => {
    buttonEl.classList.remove("active");
    buttonEl.querySelector("span").textContent = "Listen";
  };

  utterance.onerror = () => {
    buttonEl.classList.remove("active");
    buttonEl.querySelector("span").textContent = "Listen";
  };

  currentSpeakingUtterance = utterance;
  window.speechSynthesis.speak(utterance);
}

// --- Speech Recognition (Voice Input) ---
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    if (voiceInputBtn) voiceInputBtn.hidden = true;
    return;
  }

  speechRecognizer = new SpeechRecognition();
  speechRecognizer.continuous = false;
  speechRecognizer.interimResults = false;
  speechRecognizer.lang = "en-US";

  speechRecognizer.onstart = () => {
    isListening = true;
    if (voiceInputBtn) voiceInputBtn.classList.add("recording");
    showToast("Listening... Speak your symptoms now");
  };

  speechRecognizer.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    if (input) {
      input.value = (input.value ? input.value + " " : "") + transcript;
      updateInputHeight();
      toggleClearButton();
    }
  };

  speechRecognizer.onerror = () => {
    isListening = false;
    if (voiceInputBtn) voiceInputBtn.classList.remove("recording");
    showToast("Microphone error or permission denied");
  };

  speechRecognizer.onend = () => {
    isListening = false;
    if (voiceInputBtn) voiceInputBtn.classList.remove("recording");
  };
}

function toggleVoiceInput() {
  if (!speechRecognizer) return;
  if (isListening) {
    speechRecognizer.stop();
  } else {
    try {
      speechRecognizer.start();
    } catch {
      speechRecognizer.stop();
    }
  }
}

// --- Chat Messages Management ---
function getFormattedTime() {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function addMessage(content, sender, metadata = {}) {
  const row = document.createElement("div");
  row.className = `message-row ${sender}`;

  if (sender === "bot") {
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = "HC";
    avatar.setAttribute("aria-label", "Health Chat AI");
    row.appendChild(avatar);
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (sender === "bot") {
    // Emergency notice banner if flagged
    if (metadata.isEmergency) {
      const alertCard = document.createElement("div");
      alertCard.className = "emergency-notice-banner";
      alertCard.innerHTML = `⚠️ <span>${metadata.emergencyNotice || "Potential medical emergency. Please contact emergency services (e.g., 911 / 112) immediately."}</span>`;
      bubble.appendChild(alertCard);
    }

    // Markdown rendered text
    const contentWrapper = document.createElement("div");
    contentWrapper.className = "markdown-body";
    contentWrapper.innerHTML = renderMarkdown(content);
    bubble.appendChild(contentWrapper);

    // Official sources / clinical evidence box
    if (Array.isArray(metadata.sources) && metadata.sources.length > 0) {
      const sourcesBox = document.createElement("div");
      sourcesBox.className = "sources-box";
      sourcesBox.innerHTML = `<strong>Official Clinical Evidence Grounding:</strong>`;
      metadata.sources.forEach((s) => {
        const link = document.createElement("a");
        link.href = s.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.innerHTML = `${s.name} ↗`;
        sourcesBox.appendChild(link);
      });
      bubble.appendChild(sourcesBox);
    }

    // Interactive Action Toolbar (Copy, Read Aloud, Timestamp)
    const toolbar = document.createElement("div");
    toolbar.className = "message-actions-toolbar";

    const timestamp = document.createElement("span");
    timestamp.className = "msg-timestamp";
    timestamp.textContent = getFormattedTime();
    toolbar.appendChild(timestamp);

    // Copy Button
    const copyBtn = document.createElement("button");
    copyBtn.className = "msg-action-btn";
    copyBtn.type = "button";
    copyBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
      <span>Copy</span>
    `;
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(content).then(() => {
        showToast("Consultation copied to clipboard");
        copyBtn.querySelector("span").textContent = "Copied!";
        setTimeout(() => {
          copyBtn.querySelector("span").textContent = "Copy";
        }, 2000);
      });
    };
    toolbar.appendChild(copyBtn);

    // Read Aloud (TTS) Button
    const speakBtn = document.createElement("button");
    speakBtn.className = "msg-action-btn";
    speakBtn.type = "button";
    speakBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
      </svg>
      <span>Listen</span>
    `;
    speakBtn.onclick = () => speakText(content, speakBtn);
    toolbar.appendChild(speakBtn);

    bubble.appendChild(toolbar);
  } else {
    bubble.textContent = content;
  }

  row.appendChild(bubble);
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
}

function showTyping() {
  const row = document.createElement("div");
  row.className = "message-row bot typing";
  row.innerHTML = `
    <div class="avatar">HC</div>
    <div class="bubble" aria-label="DeepSeek is analyzing medical databases">
      <span class="typing-status-text">Consulting NIH MedlinePlus & OpenFDA...</span>
      <div class="typing-dots">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>
    </div>
  `;
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
  return row;
}

// --- Topic Detection & UI State ---
function detectTopicFromText(text) {
  const norm = text.toLowerCase();
  if (norm.includes("headache") || norm.includes("migraine")) return "Headache & Migraine";
  if (norm.includes("fever") || norm.includes("temperature") || norm.includes("chills")) return "Fever & Chills";
  if (norm.includes("cough") || norm.includes("cold") || norm.includes("throat")) return "Cough & Cold";
  if (norm.includes("stomach") || norm.includes("nausea") || norm.includes("belly")) return "Stomach & Digestion";
  if (norm.includes("sleep") || norm.includes("insomnia") || norm.includes("tired")) return "Sleep & Rest";
  if (norm.includes("chest") || norm.includes("breathe") || norm.includes("breathing")) return "Chest & Respiratory";
  if (norm.includes("pain") || norm.includes("back") || norm.includes("neck") || norm.includes("joint")) return "Pain & Musculoskeletal";
  if (norm.includes("diet") || norm.includes("nutrition") || norm.includes("food")) return "Nutrition & Wellness";
  if (norm.includes("medicine") || norm.includes("pill") || norm.includes("drug")) return "Medication Inquiry";
  return "General Health";
}

function updateContextStrip() {
  if (dashboardTopic) dashboardTopic.textContent = sessionState.topic;
  if (dashboardProgress) dashboardProgress.textContent = `${sessionState.turnCount} turns`;
  if (dashboardPriority) {
    dashboardPriority.textContent = sessionState.priority.label;
    dashboardPriority.className = `dashboard-pill dashboard-${sessionState.priority.tone}`;
  }
}

// --- Local Storage Management ---
function readStoredRecords() {
  try {
    return JSON.parse(localStorage.getItem(recordStoreKey) || "[]");
  } catch {
    return [];
  }
}

function saveStoredRecord(record) {
  try {
    const records = readStoredRecords();
    records.unshift({
      id: `record-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      savedAt: new Date().toISOString(),
      appVersion: "2.2.0",
      ...record,
    });
    localStorage.setItem(recordStoreKey, JSON.stringify(records.slice(0, maxStoredRecords)));
  } catch {
    // Fail-safe protection
  }
}

// --- API Health & Connectivity ---
async function checkApiHealth() {
  try {
    const res = await fetch("/api/status", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      isApiConnected = true;
      if (statusPill) {
        if (data.llm?.connected) {
          statusPill.innerHTML = `
            <span class="status-dot"></span>
            <span class="status-text">DeepSeek Flash • Live NIH & FDA</span>
          `;
          statusPill.title = `Model: ${data.llm.model} via River AI, grounded by NIH MedlinePlus & OpenFDA`;
        }
      }
      return true;
    }
  } catch {
    // Offline mode
  }
  isApiConnected = false;
  if (statusPill) {
    statusPill.innerHTML = `
      <span class="status-dot" style="background:#eab308;box-shadow:0 0 0 3px rgba(234,179,8,0.25)"></span>
      <span class="status-text">Verified Clinical Guidelines</span>
    `;
  }
  return false;
}

// --- Message Sending Flow ---
async function sendMessage(text) {
  const trimmed = text.trim();
  if (!trimmed || isGenerating) return;

  isGenerating = true;
  toggleSendingState(true);

  // 1. Add user message
  addMessage(trimmed, "user");
  input.value = "";
  updateInputHeight();
  toggleClearButton();

  // 2. Add to conversation memory
  conversationHistory.push({ role: "user", content: trimmed });
  sessionState.turnCount += 1;
  sessionState.topic = detectTopicFromText(trimmed);
  updateContextStrip();

  // 3. Show typing indicator
  const typingRow = showTyping();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: trimmed,
        history: conversationHistory,
      }),
    });

    typingRow.remove();

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    const data = await response.json();
    const replyText = data.reply || "I am here to assist with evidence-based health guidance.";

    // Update safety triage status
    if (data.isEmergency) {
      sessionState.priority = { label: "Urgent", tone: "warning" };
      sessionState.warnings = "Emergency alert flagged";
    } else {
      sessionState.priority = { label: "Active", tone: "info" };
      sessionState.warnings = "Normal monitoring";
    }

    sessionState.lastSources = data.sources || [];
    updateContextStrip();

    // 4. Add bot response
    addMessage(replyText, "bot", {
      isEmergency: data.isEmergency,
      emergencyNotice: data.emergencyNotice,
      sources: data.sources,
    });

    // 5. Append to conversation history
    conversationHistory.push({ role: "bot", content: replyText });

    // 6. Save in browser local storage for dashboard
    saveStoredRecord({
      type: data.isEmergency ? "urgent" : "care-plan",
      topic: sessionState.topic,
      priority: sessionState.priority,
      dataSource: "DeepSeek-V4.1-Flash (River AI) Grounded by NIH & FDA",
      sources: data.sources || [],
      answers: { query: trimmed },
      sections: [
        { title: "User Inquiry", items: [trimmed] },
        { title: "Clinical Response", items: [replyText.slice(0, 350) + "..."] },
      ],
      footer: "Powered by DeepSeek-V4.1-Flash on River AI with NIH MedlinePlus and OpenFDA databases.",
    });
  } catch (err) {
    typingRow.remove();
    console.error("Chat error:", err);
    addMessage(
      "I am having trouble connecting to the live medical service right now. Please check your internet connection or retry in a few moments.",
      "bot"
    );
  } finally {
    isGenerating = false;
    toggleSendingState(false);
  }
}

function toggleSendingState(sending) {
  if (sendButton) {
    sendButton.disabled = sending;
  }
  if (sendIcon && spinnerIcon) {
    sendIcon.hidden = sending;
    spinnerIcon.hidden = !sending;
  }
}

function updateInputHeight() {
  if (!input) return;
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
}

function toggleClearButton() {
  if (clearInputBtn) {
    clearInputBtn.hidden = !input.value.trim();
  }
}

function resetChat() {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  conversationHistory.length = 0;
  sessionState.topic = "General Inquiry";
  sessionState.turnCount = 0;
  sessionState.priority = { label: "Ready", tone: "stable" };
  sessionState.warnings = "None detected";
  sessionState.lastSources = [];
  sessionState.sessionStart = new Date();

  messages.innerHTML = "";
  input.value = "";
  updateInputHeight();
  toggleClearButton();

  addMessage(greetingMessage, "bot");
  updateContextStrip();
  showToast("Started fresh consultation");
}

// --- Doctor Consultation Summary Generator ---
function openDoctorSummaryModal() {
  if (!modalBody) return;

  const formattedDate = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const formattedTime = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  let conversationHtml = "";
  if (conversationHistory.length === 0) {
    conversationHtml = "<p><em>No active consultation turns recorded yet.</em></p>";
  } else {
    conversationHtml = conversationHistory
      .map((entry) => {
        const isBot = entry.role === "bot";
        return `
          <div style="margin-bottom: 14px; padding: 10px 14px; border-radius: 8px; background: ${isBot ? "var(--card-bg)" : "var(--primary-soft)"}; border: 1px solid var(--border-subtle)">
            <strong>${isBot ? "AI Clinical Assistant (DeepSeek)" : "Patient / User"}:</strong>
            <div style="margin-top: 4px; white-space: pre-wrap;">${entry.content}</div>
          </div>
        `;
      })
      .join("");
  }

  modalBody.innerHTML = `
    <div class="summary-sheet-header">
      <h3 class="summary-sheet-title">Clinical Consultation Summary Report</h3>
      <p style="margin: 0; color: var(--muted); font-size: 0.86rem;">
        Generated by Health Chat Helper for clinical review with a healthcare provider.
      </p>
    </div>

    <div class="summary-meta-grid">
      <div class="summary-meta-cell">
        <strong>Date & Time</strong>
        <span>${formattedDate} at ${formattedTime}</span>
      </div>
      <div class="summary-meta-cell">
        <strong>Primary Focus Topic</strong>
        <span>${sessionState.topic}</span>
      </div>
      <div class="summary-meta-cell">
        <strong>Triage Classification</strong>
        <span>${sessionState.priority.label} (${sessionState.warnings})</span>
      </div>
      <div class="summary-meta-cell">
        <strong>Evidence Databases</strong>
        <span>NIH MedlinePlus & OpenFDA</span>
      </div>
    </div>

    <div class="summary-section">
      <h3>Consultation Dialogue Transcript</h3>
      ${conversationHtml}
    </div>

    <div class="summary-disclaimer">
      <strong>Clinical Notice:</strong> This summary is prepared by an AI assistant (DeepSeek-V4.1-Flash on River AI) grounded in NIH MedlinePlus and OpenFDA monographs for informational purposes only. It is not an official medical diagnosis. Please present this summary to your physician, nurse practitioner, or pharmacist for professional evaluation.
    </div>
  `;

  summaryModal.hidden = false;
}

function closeDoctorSummaryModal() {
  if (summaryModal) summaryModal.hidden = true;
}

// --- Event Listeners ---
form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

input.addEventListener("input", () => {
  updateInputHeight();
  toggleClearButton();
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

if (clearInputBtn) {
  clearInputBtn.addEventListener("click", () => {
    input.value = "";
    updateInputHeight();
    toggleClearButton();
    input.focus();
  });
}

if (voiceInputBtn) {
  voiceInputBtn.addEventListener("click", toggleVoiceInput);
}

if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", toggleTheme);
}

if (exportSummaryBtn) {
  exportSummaryBtn.addEventListener("click", openDoctorSummaryModal);
}

if (closeModalBtn) {
  closeModalBtn.addEventListener("click", closeDoctorSummaryModal);
}

if (dismissModalBtn) {
  dismissModalBtn.addEventListener("click", closeDoctorSummaryModal);
}

if (summaryModal) {
  summaryModal.addEventListener("click", (e) => {
    if (e.target === summaryModal) closeDoctorSummaryModal();
  });
}

if (printSummaryBtn) {
  printSummaryBtn.addEventListener("click", () => {
    window.print();
  });
}

if (dismissNoticeBtn && emergencyGuidelineBar) {
  dismissNoticeBtn.addEventListener("click", () => {
    emergencyGuidelineBar.style.display = "none";
  });
}

quickButtons.forEach((button) => {
  button.addEventListener("click", () => {
    sendMessage(button.dataset.prompt);
  });
});

if (newChatButton) {
  newChatButton.addEventListener("click", resetChat);
}

// PWA Installation handling
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (installAppButton) installAppButton.hidden = false;
});

if (installAppButton) {
  installAppButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installAppButton.hidden = true;
  });
}

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  if (installAppButton) installAppButton.hidden = true;
});

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}

// Initial Boot Sequence
initTheme();
initSpeechRecognition();
addMessage(greetingMessage, "bot");
updateContextStrip();
checkApiHealth();