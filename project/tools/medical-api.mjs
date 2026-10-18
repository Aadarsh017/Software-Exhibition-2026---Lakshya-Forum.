// Real Medical Knowledge Engine using River AI (DeepSeek-V4.1-Flash), NIH MedlinePlus & OpenFDA
// Zero external npm dependencies, built with standard Node.js APIs

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env");

// Load .env automatically
if (existsSync(envPath)) {
  try {
    const envContent = readFileSync(envPath, "utf-8");
    envContent.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    });
  } catch (err) {
    console.warn("Could not read .env file:", err.message);
  }
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour in-memory cache
const cache = new Map();

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCached(key, data) {
  if (cache.size > 200) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, { data, timestamp: Date.now() });
}

function decodeHtmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Calls River AI's OpenAI-compatible inference endpoint (deepseek-ai/DeepSeek-V4.1-Flash)
 */
export async function callRiverAi(messages, options = {}) {
  const apiKey = options.apiKey || process.env.RIVER_API_KEY || "";
  if (!apiKey) {
    throw new Error("RIVER_API_KEY is not configured");
  }

  const model = options.model || process.env.RIVER_MODEL || "deepseek-ai/DeepSeek-V4.1-Flash";
  const baseUrl = process.env.RIVER_BASE_URL || "https://api.river.ai/v1";
  const url = `${baseUrl}/chat/completions`;

  const payload = {
    model,
    messages,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.max_tokens ?? 1500,
  };
  if (options.jsonMode) {
    payload.response_format = { type: "json_object" };
  }

  const maxAttempts = options.retries ?? 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 22000);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.status === 429 && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
        continue;
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`River AI HTTP ${res.status}: ${errText.slice(0, 200)}`);
      }

      const data = await res.json();
      return {
        content: data.choices?.[0]?.message?.content || "",
        usage: data.usage || null,
        model: data.model || model,
      };
    } catch (err) {
      clearTimeout(timeout);
      if (attempt >= maxAttempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

/**
 * Searches the US National Library of Medicine (NIH) MedlinePlus Web Service
 */
export async function searchMedlinePlus(query) {
  const cleanQuery = query.trim().toLowerCase();
  const cacheKey = `medline:${cleanQuery}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://wsearch.nlm.nih.gov/ws/query?db=healthTopics&term=${encodeURIComponent(cleanQuery)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      return [];
    }

    const text = await res.text();
    const results = [];
    const docRegex = /<document rank="(\d+)" url="([^"]+)">([\s\S]*?)<\/document>/g;
    let match;

    while ((match = docRegex.exec(text)) !== null) {
      const url = match[2];
      const docBody = match[3];

      const titleMatch = docBody.match(/<content name="title">([\s\S]*?)<\/content>/);
      const summaryMatch = docBody.match(/<content name="FullSummary">([\s\S]*?)<\/content>/);
      const orgMatch = docBody.match(/<content name="organizationName">([\s\S]*?)<\/content>/);

      const title = decodeHtmlEntities(titleMatch?.[1] || "");
      const summary = decodeHtmlEntities(summaryMatch?.[1] || "");
      const organization = decodeHtmlEntities(orgMatch?.[1] || "National Library of Medicine (NIH)");

      if (title && summary) {
        results.push({
          title,
          url,
          organization,
          summary,
        });
      }

      if (results.length >= 3) break;
    }

    setCached(cacheKey, results);
    return results;
  } catch (error) {
    console.error("MedlinePlus search error:", error.message);
    return [];
  }
}

/**
 * Queries OpenFDA for official FDA-approved OTC drug labels, indications, and safety warnings
 */
export async function searchOpenFdaDrugs(symptomOrDrug) {
  const cleanTerm = symptomOrDrug.trim().toLowerCase();
  const cacheKey = `fda:${cleanTerm}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const query = `(indications_and_usage:"${encodeURIComponent(cleanTerm)}"+OR+openfda.generic_name:"${encodeURIComponent(cleanTerm)}")+AND+openfda.product_type:"HUMAN+OTC+DRUG"`;
    const url = `https://api.fda.gov/drug/label.json?search=${query}&limit=3`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      return [];
    }

    const data = await res.json();
    const results = (data.results || []).map((r) => {
      const brand = r.openfda?.brand_name?.[0] || "OTC Formulation";
      const generic = r.openfda?.generic_name?.[0] || "Active ingredient";
      const purpose = cleanFdaText(r.purpose?.[0] || "");
      const active = cleanFdaText(r.active_ingredient?.[0] || "");
      const warnings = cleanFdaText(r.warnings?.[0] || "");
      const doNotUse = cleanFdaText(r.do_not_use?.[0] || "");
      const askDoctor = cleanFdaText(r.ask_doctor?.[0] || "");
      const stopUse = cleanFdaText(r.stop_use?.[0] || "");
      const pregnancy = cleanFdaText(r.pregnancy_or_breast_feeding?.[0] || "");

      return {
        brand,
        generic,
        purpose,
        activeIngredient: active,
        warnings,
        doNotUse,
        askDoctor,
        stopUse,
        pregnancy,
      };
    });

    setCached(cacheKey, results);
    return results;
  } catch (error) {
    console.error("OpenFDA search error:", error.message);
    return [];
  }
}

function cleanFdaText(text) {
  if (!text) return "";
  return text
    .replace(/^Warnings?\s*/i, "")
    .replace(/^Directions?\s*/i, "")
    .replace(/^Uses?\s*/i, "")
    .replace(/^Purpose\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Standard emergency keywords and patterns (CDC & ACEP triage alignment)
 */
const EMERGENCY_PATTERNS = [
  "chest pain",
  "pressure in chest",
  "can't breathe",
  "cant breathe",
  "trouble breathing",
  "shortness of breath",
  "blue lips",
  "stroke",
  "face drooping",
  "weakness on one side",
  "slurred speech",
  "severe bleeding",
  "bleeding won't stop",
  "seizure",
  "overdose",
  "poison",
  "suicide",
  "kill myself",
  "hurt myself",
  "fainting",
  "passed out",
  "unconscious",
  "anaphylaxis",
  "swollen tongue",
  "swollen throat",
  "worst headache",
  "sudden severe headache",
  "stiff neck",
  "vomiting blood",
  "blood in vomit",
  "blood in stool",
  "very little urination",
  "not peeing",
  "severe burn",
  "major injury",
];

export function checkEmergency(text) {
  const norm = text.toLowerCase().replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim();

  for (const term of EMERGENCY_PATTERNS) {
    const termIndex = norm.indexOf(term);
    if (termIndex !== -1) {
      const contextBefore = norm.slice(Math.max(0, termIndex - 45), termIndex);
      const isNegated =
        /(^|\s)(no|not|without|deny|denies|none)\s/.test(contextBefore) &&
        !/\bbut\b|\bhowever\b/.test(contextBefore);

      if (!isNegated) {
        return {
          isEmergency: true,
          term,
          guidance:
            "This may be a medical emergency. Contact local emergency services (such as 911 in the US/Canada, 112 in Europe, 999 in the UK) immediately or proceed to the nearest emergency department.",
        };
      }
    }
  }

  return { isEmergency: false };
}

/**
 * Generates an explained care guide.
 * Uses River AI (DeepSeek-V4.1-Flash) grounded with live NIH MedlinePlus and OpenFDA facts,
 * with deterministic template fallback if the AI key or service is unavailable.
 */
export async function generateCarePlan({ topicName, answers = {}, userMessage = "" }) {
  // Query live NIH MedlinePlus & OpenFDA
  const [medlineDocs, fdaDrugs] = await Promise.all([
    searchMedlinePlus(topicName || userMessage || "general health"),
    searchOpenFdaDrugs(topicName || userMessage || "pain"),
  ]);

  const topDoc = medlineDocs[0] || null;

  // Determine Triage Priority
  const age = (answers.age || "").toLowerCase();
  const timing = (answers.timing || "").toLowerCase();
  const severity = (answers.severity || "").toLowerCase();
  const warningSigns = (answers["warning-signs"] || "").toLowerCase();
  const healthHistory = (answers["health-history"] || "").toLowerCase();

  let priority = {
    label: "Routine self-care",
    tone: "stable",
    text: "Based on your reported answers with no urgent warning signs, evidence-based self-care and symptom monitoring are appropriate.",
  };

  if (warningSigns.includes("not sure")) {
    priority = {
      label: "Use caution",
      tone: "caution",
      text: "Because warning signs are uncertain, observe closely and consult a healthcare professional if symptoms worsen or fail to improve.",
    };
  } else if (warningSigns && !warningSigns.includes("no warning signs")) {
    priority = {
      label: "Higher priority",
      tone: "warning",
      text: "You reported an active warning sign. Prompt clinical evaluation or urgent medical care is advised.",
    };
  } else if (
    severity.includes("severe") ||
    severity.includes("getting worse") ||
    timing.includes("suddenly") ||
    timing.includes("month")
  ) {
    priority = {
      label: "Use caution",
      tone: "caution",
      text: timing.includes("month")
        ? "Symptoms lasting a month or longer require non-emergency clinical evaluation to identify the root cause."
        : "Significant severity or sudden onset warrants closer monitoring and medical advice if not rapidly resolving.",
    };
  } else if (
    ["baby", "child", "older adult"].includes(age) ||
    /(pregnant|breastfeeding|long term|regular medicines)/.test(healthHistory)
  ) {
    priority = {
      label: "Extra care",
      tone: "info",
      text: "Age extremes, pregnancy, chronic health conditions, and regular medications require tailored clinical guidance.",
    };
  }

  // Compile official sources
  const officialSources = [];
  if (topDoc?.url) {
    officialSources.push({
      name: `MedlinePlus: ${topDoc.title}`,
      url: topDoc.url,
      publisher: "National Library of Medicine (NIH)",
    });
  }
  if (fdaDrugs.length > 0) {
    officialSources.push({
      name: "OpenFDA Drug Safety Labels & OTC Monographs",
      url: "https://open.fda.gov/apis/drug/label/",
      publisher: "U.S. Food and Drug Administration (FDA)",
    });
  }

  // Attempt generation with River AI (DeepSeek-V4.1-Flash)
  const apiKey = process.env.RIVER_API_KEY;
  if (apiKey) {
    try {
      const fdaSummary = fdaDrugs
        .map((d) => `${d.generic} (${d.brand}): Purpose: ${d.purpose}. Warnings: ${d.warnings.slice(0, 150)}. Contraindications: ${d.doNotUse.slice(0, 150)}. Stop use: ${d.stopUse.slice(0, 150)}`)
        .join("\n");

      const systemPrompt = `You are an expert clinical triage assistant.
Synthesize an evidence-based care guide grounded strictly in the provided official NIH MedlinePlus overview and FDA drug safety monographs.
Do NOT invent dosages or prescribe treatments. Focus on supportive self-care, active ingredients, contraindications, and clear red flags.
Respond ONLY with a valid JSON object matching this schema:
{
  "summary": ["string", "string"],
  "clinicalCauses": ["string", "string", "string"],
  "priorityRationale": ["string", "string"],
  "stepByStepPlan": ["string", "string", "string", "string"],
  "whatToAvoid": ["string", "string", "string"],
  "medicationSafety": ["string", "string", "string"],
  "personalizedPrecautions": ["string", "string"],
  "whatToMonitor": ["string", "string"],
  "redFlags": ["string", "string", "string"],
  "doctorQuestions": ["string", "string", "string"]
}`;

      const userPrompt = `Condition: ${topicName}
Patient Intake Data:
- Age Group: ${answers.age || "Not specified"}
- Sex/Gender: ${answers["sex-gender"] || "Not specified"}
- Duration: ${answers.timing || "Not specified"}
- Severity: ${answers.severity || "Not specified"}
- Warning Signs: ${answers["warning-signs"] || "None reported"}
- Health History: ${answers["health-history"] || "None reported"}
- Already Tried: ${answers["already-tried"] || "Nothing yet"}

Assigned Safety Level: ${priority.label} (${priority.text})

Official NIH MedlinePlus Clinical Evidence:
${topDoc?.summary || "No specific MedlinePlus record found. Provide established medical guidelines."}

Official OpenFDA Drug Evidence:
${fdaSummary || "No specific OTC record found. Emphasize pharmacist consultation."}`;

      const aiResponse = await callRiverAi(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        { jsonMode: true, temperature: 0.2, max_tokens: 1800 }
      );

      const parsed = JSON.parse(aiResponse.content);

      return {
        kind: "care-plan",
        topic: topicName,
        title: `${topicName} — Evidence-Based Care Guide`,
        priority,
        dataSource: `DeepSeek-V4.1-Flash (River AI) Grounded by NIH & FDA`,
        sources: officialSources,
        sections: [
          {
            title: "Clinical Overview (NIH MedlinePlus)",
            items: [
              topDoc?.summary ? topDoc.summary.slice(0, 380) + "..." : `Evidence-based clinical reference for ${topicName}.`,
              `Authoritative Source: ${topDoc?.organization || "U.S. National Library of Medicine"}`,
            ],
          },
          {
            title: "Information Evaluated",
            items: Object.entries(answers).map(([key, val]) => `${formatAnswerKey(key)}: ${val}`),
          },
          {
            title: "Clinical Causes & Pathophysiology",
            items: parsed.clinicalCauses || [],
          },
          {
            title: "Triage Assessment & Priority Rationale",
            items: [
              `Assigned Safety Tier: ${priority.label}`,
              priority.text,
              ...(parsed.priorityRationale || []),
            ],
          },
          {
            title: "Actionable Step-by-Step Care",
            items: parsed.stepByStepPlan || [],
          },
          {
            title: "What to Avoid",
            items: parsed.whatToAvoid || [],
          },
          {
            title: "Real FDA Medication Safety Data",
            items: parsed.medicationSafety || [],
          },
          {
            title: "Personalized Safety & Demographics",
            items: parsed.personalizedPrecautions || [],
          },
          {
            title: "What to Monitor (Symptom Trajectory)",
            items: parsed.whatToMonitor || [],
          },
          {
            title: "Official Red Flags (Seek Prompt Medical Care)",
            items: parsed.redFlags || [],
          },
          {
            title: "Questions for Your Clinician or Pharmacist",
            items: parsed.doctorQuestions || [],
          },
          {
            title: "Official References & Citations",
            items: officialSources.map((s) => `${s.publisher}: ${s.name} (${s.url})`),
          },
        ],
        footer:
          "Synthesized by DeepSeek-V4.1-Flash on River AI, grounded in verified clinical monographs from the U.S. National Library of Medicine (MedlinePlus) and U.S. Food & Drug Administration (OpenFDA). This is educational advice and does not substitute for licensed medical diagnosis.",
      };
    } catch (aiErr) {
      console.warn("River AI call failed, falling back to deterministic clinical builder:", aiErr.message);
    }
  }

  // Fallback Deterministic Builder
  const medicineGuidance = [];
  const medicineWarnings = [];
  const stopUseSigns = [];

  if (fdaDrugs.length > 0) {
    fdaDrugs.forEach((drug) => {
      if (drug.generic && drug.generic !== "Active ingredient") {
        medicineGuidance.push(
          `FDA-Approved OTC Option: ${drug.generic} (${drug.brand}) — Indicated for ${drug.purpose || "symptomatic relief"}.`
        );
      }
      if (drug.warnings) {
        medicineWarnings.push(`FDA Safety Note (${drug.generic}): ${drug.warnings.slice(0, 200)}...`);
      }
      if (drug.doNotUse) {
        medicineWarnings.push(`Contraindications (${drug.generic}): Do not use ${drug.doNotUse.slice(0, 180)}...`);
      }
      if (drug.stopUse) {
        stopUseSigns.push(`FDA Warning to Stop Use: ${drug.stopUse.slice(0, 200)}`);
      }
    });
  }

  return {
    kind: "care-plan",
    topic: topicName,
    title: `${topicName} — Evidence-Based Care Guide`,
    priority,
    dataSource: "Live NIH MedlinePlus & OpenFDA",
    sources: officialSources,
    sections: [
      {
        title: "Clinical Overview (NIH MedlinePlus)",
        items: [
          topDoc?.summary ? topDoc.summary.slice(0, 350) + "..." : `Evidence-based clinical reference for ${topicName}.`,
          `Primary Source: ${topDoc?.organization || "U.S. National Library of Medicine"}`,
        ],
      },
      {
        title: "Information Evaluated",
        items: Object.entries(answers).map(([key, val]) => `${formatAnswerKey(key)}: ${val}`),
      },
      {
        title: "Clinical Causes & Considerations",
        items: [
          `${topicName} is a common symptom with various potential underlying triggers.`,
          "Accurate assessment depends on onset timing, symptom trajectory, and any associated warning signs.",
          "Persistent or unexplained symptoms warrant direct clinical evaluation.",
        ],
      },
      {
        title: "Triage Assessment & Priority Rationale",
        items: [`Assigned Level: ${priority.label}`, priority.text],
      },
      {
        title: "Actionable Step-by-Step Care",
        items: [
          `Prioritize appropriate rest and supportive hydration while monitoring symptom changes.`,
          "Avoid strenuous activity or sudden exertion until baseline recovery is established.",
        ],
      },
      {
        title: "What to Avoid",
        items: [
          "Avoid exceeding recommended maximum daily limits or combining multiple products with identical active ingredients.",
          "Avoid using leftover prescription antibiotics or shared medications.",
        ],
      },
      {
        title: "Real FDA Medication Safety Data",
        items: medicineGuidance.length ? medicineGuidance : ["Consult a pharmacist for verified OTC options."],
      },
      {
        title: "What to Monitor (Symptom Trajectory)",
        items: [
          "Track whether the symptom is improving, stable, or deteriorating over 24-48 hours.",
        ],
      },
      {
        title: "Official Red Flags (Seek Prompt Medical Care)",
        items: stopUseSigns.length ? stopUseSigns : ["Difficulty breathing, chest pain, or sudden severe confusion."],
      },
      {
        title: "Questions for Your Clinician or Pharmacist",
        items: [`What are the most probable causes of my ${topicName}?`, "Which OTC medicines are safe for me?"],
      },
      {
        title: "Official References & Citations",
        items: officialSources.map((s) => `${s.publisher}: ${s.name} (${s.url})`),
      },
    ],
    footer:
      "Data retrieved from the U.S. National Library of Medicine (MedlinePlus) and U.S. Food and Drug Administration (OpenFDA).",
  };
}

/**
 * Conversational Health Consultant powered by River AI
 * Answers general user health questions and follow-ups
 */
export async function consultRiverAssistant({ message, sessionHistory = [], carePlanContext = null }) {
  const systemPrompt = `You are Health Chat Helper, an empathetic, highly skilled health consultant powered by DeepSeek-V4.1-Flash on River AI.
Your purpose is to provide clear, calm, evidence-based health education and wellness guidance.
Guidelines:
1. Always maintain a warm, supportive, and professional tone.
2. Ground your explanations in verified medical science.
3. If the user asks a follow-up about a symptom or care plan, reference the provided care plan context.
4. Clearly emphasize safety limits: do not provide definitive medical diagnoses or exact drug doses.
5. If you detect any emergency signs (chest pain, stroke signs, difficulty breathing, severe bleeding), immediately urge the user to call emergency services.
6. Keep answers concise, actionable, and structured with bullet points where helpful.`;

  const messages = [
    { role: "system", content: systemPrompt },
  ];

  if (carePlanContext) {
    messages.push({
      role: "system",
      content: `Current Active Care Guide Context:\n${JSON.stringify(carePlanContext, null, 2)}`,
    });
  }

  // Include recent session history
  if (Array.isArray(sessionHistory)) {
    sessionHistory.slice(-6).forEach((h) => {
      messages.push({
        role: h.role === "bot" ? "assistant" : "user",
        content: h.text,
      });
    });
  }

  messages.push({ role: "user", content: message });

  const response = await callRiverAi(messages, {
    temperature: 0.3,
    max_tokens: 1000,
  });

  return response.content;
}

function formatAnswerKey(key) {
  const map = {
    age: "Age group",
    "sex-gender": "Sex/gender",
    timing: "Onset timing",
    severity: "Current severity",
    "warning-signs": "Reported warning signs",
    "health-history": "Health history",
    "already-tried": "Already tried",
  };
  return map[key] || key;
}

/**
 * Main conversational interface powered by River AI (DeepSeek-V4.1-Flash)
 * connected directly to NIH MedlinePlus & OpenFDA databases
 */
export async function chatWithHealthAssistant({ message, history = [] }) {
  const userText = (message || "").trim();
  if (!userText) {
    return {
      reply: "Please let me know how I can help you today.",
      sources: [],
      isEmergency: false,
    };
  }

  // 1. Triage for life-threatening emergencies
  const emergency = checkEmergency(userText);
  let emergencyGuidance = "";
  if (emergency.isEmergency) {
    emergencyGuidance = emergency.guidance;
  }

  // 2. Identify if query contains health/symptom/medication concepts
  const healthKeywordsPattern =
    /pain|fever|cough|headache|ache|sick|hurt|symptom|doctor|medicine|pill|cold|stomach|burn|rash|cut|sleep|diet|exercise|bleed|swollen|throat|dizzy|nausea|vomit|diarrhea|cramp|pressure|breath|asthma|allergy|heart|blood|pressure|diabetes|glucose|infection|itch|wound|sprain|injury/i;
  const isHealthQuery = healthKeywordsPattern.test(userText);

  let groundingText = "";
  const sources = [];

  if (isHealthQuery) {
    try {
      const [medlineDocs, fdaDrugs] = await Promise.all([
        searchMedlinePlus(userText),
        searchOpenFdaDrugs(userText),
      ]);

      if (medlineDocs && medlineDocs.length > 0) {
        const top = medlineDocs[0];
        groundingText += `NIH MedlinePlus Clinical Overview (${top.title}):\n${top.summary.slice(0, 450)}\n\n`;
        sources.push({
          name: `MedlinePlus: ${top.title}`,
          url: top.url,
          publisher: "U.S. National Library of Medicine",
        });
      }

      if (fdaDrugs && fdaDrugs.length > 0) {
        const topDrugs = fdaDrugs.slice(0, 2);
        groundingText += `U.S. FDA Drug Label Monographs:\n`;
        topDrugs.forEach((d) => {
          groundingText += `- ${d.generic} (${d.brand}): Purpose: ${d.purpose}. Warnings: ${d.warnings.slice(0, 160)}. Contraindications: ${d.doNotUse.slice(0, 160)}. Stop use criteria: ${d.stopUse.slice(0, 160)}\n`;
        });
        sources.push({
          name: "OpenFDA Drug Safety Labels",
          url: "https://open.fda.gov/apis/drug/label/",
          publisher: "U.S. Food & Drug Administration",
        });
      }
    } catch (dbErr) {
      console.warn("Medical DB lookup error:", dbErr.message);
    }
  }

  const systemPrompt = `You are Health Chat Helper, an intelligent, empathetic medical and wellness assistant powered by DeepSeek-V4.1-Flash on River AI, integrated with live data from the U.S. National Library of Medicine (NIH MedlinePlus) and U.S. FDA Drug Database.

Behavioral Guidelines:
1. Converse naturally, warmly, and helpfully. You are a conversational AI partner, NOT a rigid multiple-choice questionnaire.
2. If the user greets you or asks general conversational questions (e.g. "what are you doing", "hello", "who are you", "tell me about yourself"), respond naturally, explain your medical and wellness capabilities, and invite them to share what's on their mind.
3. If the user shares symptoms or medical concerns:
   - Explain what the symptoms commonly mean based on clinical pathophysiology and NIH MedlinePlus facts.
   - Outline supportive, evidence-based self-care steps.
   - Discuss over-the-counter options, active ingredients, and FDA safety precautions/contraindications (never prescribe exact doses).
   - Clearly highlight red flags (when to seek emergency or urgent medical attention).
   - Ask 2-3 natural clinical follow-up questions to understand their situation better (such as duration, severity, age group, or other symptoms).
4. If an emergency red flag is detected, immediately emphasize seeking emergency medical care (such as calling 911/112).
5. Format your response cleanly using markdown (bullet points, bold text, headers) so it is clear and easy to read.`;

  const messages = [{ role: "system", content: systemPrompt }];

  if (emergency.isEmergency) {
    messages.push({
      role: "system",
      content: `CRITICAL ALERT: The user mentioned a potential emergency symptom (${emergency.term}). Explicitly warn them to seek immediate emergency care first.`,
    });
  }

  if (groundingText) {
    messages.push({
      role: "system",
      content: `Official Evidence from NIH MedlinePlus & OpenFDA:\n${groundingText}`,
    });
  }

  // Include recent conversation history (up to last 10 turns)
  if (Array.isArray(history)) {
    history.slice(-10).forEach((turn) => {
      if (turn.role && turn.content) {
        messages.push({
          role: turn.role === "bot" ? "assistant" : "user",
          content: turn.content,
        });
      }
    });
  }

  messages.push({ role: "user", content: userText });

  try {
    const aiResponse = await callRiverAi(messages, {
      temperature: 0.3,
      max_tokens: 1200,
    });

    return {
      reply: aiResponse.content,
      sources,
      isEmergency: emergency.isEmergency,
      emergencyNotice: emergencyGuidance || null,
      model: aiResponse.model,
      provider: "River AI",
    };
  } catch (aiErr) {
    console.error("River AI chat error:", aiErr.message);
    let fallbackReply = "I am here to help you evaluate your symptoms and health questions.";
    if (emergency.isEmergency) {
      fallbackReply = emergency.guidance;
    } else if (groundingText) {
      fallbackReply = `Based on NIH MedlinePlus data:\n${groundingText}\n\nPlease consult a healthcare professional for clinical diagnosis.`;
    }
    return {
      reply: fallbackReply,
      sources,
      isEmergency: emergency.isEmergency,
      emergencyNotice: emergencyGuidance || null,
      model: "Local Verified Baseline",
      provider: "Local Baseline",
    };
  }
}
