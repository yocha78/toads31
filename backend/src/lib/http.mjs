// Small helpers shared by the API handlers

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

export function readBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// A display name as people type it: trimmed, single spaces, no control characters or markup.
// Returns null when it isn't acceptable.
export function cleanName(v, max) {
  if (typeof v !== "string") return null;
  const s = v.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!s || s.length > max) return null;
  if (/[\u0000-\u001f\u007f<>]/.test(s)) return null;
  return s;
}

// Names are unique ignoring case and accents' composed/decomposed forms
export const nameKey = s => s.normalize("NFC").toLocaleLowerCase("en-GB");
