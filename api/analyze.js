// Signal — AI business-data analyst (Vercel serverless function)
//
// Receives a small business dataset (rows of numbers) and returns a structured,
// plain-language briefing: what's moving, what stands out, what to watch, what to do.
//
// Requires a logged-in Supabase user (Authorization: Bearer <token>).
// Set ANTHROPIC_API_KEY in your Vercel project env vars (never commit it).

const SUPABASE_URL = process.env.SUPABASE_URL || "https://umfqbkzfddaxxwyamjvx.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtZnFia3pmZGRheHh3eWFtanZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNjk5NzgsImV4cCI6MjEwMTc0NTk3OH0.rLgt85ToIcHmJM9pCcS2_rqBhAgWbC-ckvKq0brXGeM";

// Verify the caller's Supabase access token. Returns the user, or null if invalid.
async function getUser(req) {
  const auth = req.headers["authorization"] || req.headers["Authorization"] || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  try {
    const r = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + token },
    });
    if (!r.ok) return null;
    const user = await r.json();
    return user && user.id ? user : null;
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST." });
  }

  // must be signed in
  const user = await getUser(req);
  if (!user) {
    return res.status(401).json({ error: "Please sign in to run an analysis." });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const rows = body.rows;
    const label = (body.label || "business data").toString().slice(0, 80);

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "Send a non-empty 'rows' array." });
    }
    // Guard the payload size — this is a small-business tool, not a data warehouse.
    const trimmed = rows.slice(0, 300);

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 2200,
        system: buildPrompt(label),
        messages: [
          { role: "user", content: "DATA (JSON rows):\n" + JSON.stringify(trimmed) },
        ],
      }),
    });

    if (!apiRes.ok) {
      const t = await apiRes.text();
      return res.status(502).json({ error: "Analysis service error.", detail: t.slice(0, 300) });
    }

    const data = await apiRes.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    // The model is told to return ONLY JSON, but be robust: strip fences, and if
    // there's any stray text around it, extract the outermost {...} block.
    let insights = null;
    const attempts = [];
    let clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    attempts.push(clean);
    // pull the first { ... last } in case the model added a sentence before/after
    const first = clean.indexOf("{");
    const last = clean.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      attempts.push(clean.slice(first, last + 1));
      // last resort: strip trailing commas that break JSON.parse
      attempts.push(clean.slice(first, last + 1).replace(/,(\s*[}\]])/g, "$1"));
    }
    for (const candidate of attempts) {
      try { insights = JSON.parse(candidate); break; } catch (e) { /* try next */ }
    }
    if (!insights) {
      return res.status(502).json({ error: "Could not parse the analysis.", raw: text.slice(0, 500) });
    }

    return res.status(200).json({ insights });
  } catch (err) {
    return res.status(500).json({ error: "Unexpected error.", detail: String(err).slice(0, 300) });
  }
}

function buildPrompt(label) {
  return `You are Signal, an AI analyst that reads a small business's own numbers and explains them in plain language to an owner who is NOT a data person. You are looking at ${label}.

Analyze the data the user provides. Reason across ALL the rows — compute the actual changes, totals, and comparisons yourself. Be specific and use real numbers from the data. Never invent a figure that isn't supported by the data.

Focus on what an owner actually needs to know:
- What's MOVING: the biggest increases and decreases (compare the relevant columns — e.g. this period vs last period). State the item, the direction, and the real numbers.
- What's STANDING OUT: top performers, or a clear opportunity worth leaning into.
- What to WATCH: risks, anomalies, or quiet problems (e.g. high revenue but thin margin, a sharp unexplained drop, something overstocked or fading).
- What to DO: 2 to 4 concrete, practical next actions tied to the findings. Not generic advice — specific to what the numbers show.

Write for a busy owner: plain words, no jargon, lead with the point. If the data lacks something needed for a conclusion, say so rather than guessing.

Respond with ONLY a JSON object (no preamble, no markdown fences) in exactly this shape:
{
  "headline": "one punchy sentence — the single most important takeaway",
  "summary": "2-3 sentences: the overall state of things in plain language",
  "movements": [
    { "name": "item or metric", "direction": "up" | "down", "metric": "the real numbers, e.g. '40 → 95 units (+138%)'", "detail": "one sentence on why it matters" }
  ],
  "standouts": [
    { "name": "item", "note": "one sentence — why it's a standout or opportunity" }
  ],
  "concerns": [
    { "name": "item or issue", "note": "one sentence — the risk and what's behind it" }
  ],
  "actions": [
    "a specific, concrete next step tied to the findings"
  ]
}

Keep each array to the 3-5 most important entries. Quality over quantity.`;
}
