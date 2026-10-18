const recordStoreKey = "health-chat-helper-records-v1";
const themeStoreKey = "health-chat-theme-v1";

const totalRecords = document.querySelector("#total-records");
const careRecords = document.querySelector("#care-records");
const urgentRecords = document.querySelector("#urgent-records");
const lastSaved = document.querySelector("#last-saved");
const recordsList = document.querySelector("#records-list");
const emptyTemplate = document.querySelector("#empty-template");
const filter = document.querySelector("#record-filter");
const exportJsonButton = document.querySelector("#export-json");
const exportCsvButton = document.querySelector("#export-csv");
const clearDataButton = document.querySelector("#clear-data");
const themeToggleBtn = document.querySelector("#theme-toggle");

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
}

if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", toggleTheme);
}
initTheme();
const answerLabels = {
  age: "Age group",
  "sex-gender": "Sex/gender if relevant",
  timing: "Started",
  severity: "Current severity",
  "warning-signs": "Warning signs",
  "health-history": "Health history",
  "already-tried": "Already tried",
};

function readRecords() {
  try {
    return JSON.parse(localStorage.getItem(recordStoreKey) || "[]");
  } catch {
    return [];
  }
}

function writeText(element, value) {
  if (element) {
    element.textContent = value;
  }
}

function formatDate(value) {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function getFilteredRecords(records) {
  const value = filter?.value || "all";
  if (value === "all") {
    return records;
  }

  return records.filter((record) => record.type === value);
}

function updateMetrics(records) {
  writeText(totalRecords, records.length.toString());
  writeText(careRecords, records.filter((record) => record.type === "care-plan").length.toString());
  writeText(urgentRecords, records.filter((record) => record.type === "urgent").length.toString());
  writeText(lastSaved, records.length ? formatDate(records[0].savedAt) : "Never");
}

function getAnswerSection(record) {
  const answers = record.answers || {};
  const items = Object.entries(answers).map(([key, value]) => `${answerLabels[key] || formatKey(key)}: ${value}`);
  return { title: "Consultation Details", items };
}

function formatKey(key) {
  return key
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function renderRecord(record) {
  const item = createElement("article", "record-item");
  const header = createElement("div", "record-header");
  const titleBlock = createElement("div", "");
  const priority = record.priority || { label: "Stored", tone: "stable" };
  const typeLabel = record.type === "urgent" ? "Urgent event" : "Care guide";

  const metaText = record.dataSource
    ? `${typeLabel} • ${record.dataSource} • ${formatDate(record.savedAt)}`
    : `${typeLabel} - ${formatDate(record.savedAt)}`;

  titleBlock.append(
    createElement("h3", "record-title", record.topic || "Stored health record"),
    createElement("p", "record-meta", metaText)
  );

  header.append(titleBlock, createElement("span", `priority-pill priority-${priority.tone || "stable"}`, priority.label || "Stored"));
  item.appendChild(header);

  const sectionGrid = createElement("div", "record-section-grid");
  const sections = [getAnswerSection(record), ...(record.sections || [])].filter((section) => section.items?.length);
  const urlRegex = /(https?:\/\/[^\s\)]+)/;

  sections.forEach((section) => {
    const sectionElement = createElement("section", "record-section");
    sectionElement.appendChild(createElement("h3", "", section.title));

    const list = document.createElement("ul");
    section.items.forEach((entry) => {
      if (typeof entry === "string" && urlRegex.test(entry)) {
        const li = document.createElement("li");
        const parts = entry.split(urlRegex);
        parts.forEach((part) => {
          if (part.startsWith("http://") || part.startsWith("https://")) {
            const a = document.createElement("a");
            a.href = part;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.textContent = "Official Reference ↗";
            a.style.marginLeft = "6px";
            a.style.fontWeight = "bold";
            a.style.color = "var(--primary, #0f766e)";
            li.appendChild(a);
          } else {
            li.appendChild(document.createTextNode(part));
          }
        });
        list.appendChild(li);
      } else {
        list.appendChild(createElement("li", "", entry));
      }
    });
    sectionGrid.appendChild(sectionElement);
  });

  item.appendChild(sectionGrid);
  return item;
}

function render() {
  const records = readRecords();
  const visibleRecords = getFilteredRecords(records);
  updateMetrics(records);
  recordsList.innerHTML = "";

  if (!visibleRecords.length) {
    recordsList.appendChild(emptyTemplate.content.cloneNode(true));
    return;
  }

  const fragment = document.createDocumentFragment();
  visibleRecords.forEach((record) => {
    fragment.appendChild(renderRecord(record));
  });
  recordsList.appendChild(fragment);
}

function downloadFile(filename, type, content) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toCsvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function exportCsv(records) {
  const rows = [
    ["savedAt", "type", "topic", "priority", "dataSource", "answers"],
    ...records.map((record) => [
      record.savedAt,
      record.type,
      record.topic,
      record.priority?.label,
      record.dataSource || "Verified Clinical Baseline",
      JSON.stringify(record.answers || {}),
    ]),
  ];

  return rows.map((row) => row.map(toCsvCell).join(",")).join("\n");
}

exportJsonButton.addEventListener("click", () => {
  downloadFile("health-chat-records.json", "application/json", JSON.stringify(readRecords(), null, 2));
});

exportCsvButton.addEventListener("click", () => {
  downloadFile("health-chat-records.csv", "text/csv", exportCsv(readRecords()));
});

clearDataButton.addEventListener("click", () => {
  const confirmed = window.confirm("Clear all locally stored health chat records from this browser?");
  if (!confirmed) {
    return;
  }

  localStorage.removeItem(recordStoreKey);
  render();
});

filter.addEventListener("change", render);
window.addEventListener("storage", render);
render();