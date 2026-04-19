/**
 * LLM Provider Adapters
 *
 * Adapter pattern for Groq and Anthropic with format-specific serialization.
 * Groq uses OpenAI-compatible API; Anthropic uses its own Messages API.
 *
 * Key differences handled:
 * - Groq: system message in messages array, response_format for JSON
 * - Anthropic: system as top-level param, manual JSON extraction
 * - Different auth headers, response shapes, and error formats
 */

import type { LLMAdapter, LLMCallParams } from "./types";

// ════════════════════════════════════════════════════
// SHARED UTILITIES
// ════════════════════════════════════════════════════

/** Extract JSON from LLM output that may have markdown wrapping */
function extractJSON(text: string): string {
  // Strip ```json ... ``` wrappers
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  // Try parsing directly
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    // Noop — try fallback
  }

  // Try to find JSON object or array in the text
  const match = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (match) {
    try {
      JSON.parse(match[1]);
      return match[1];
    } catch {
      // Noop — fall through to error
    }
  }

  throw new Error(
    `LLM returned invalid JSON: ${cleaned.substring(0, 200)}...`
  );
}

/** Fetch with exponential backoff retry (handles 429, 500, 502, 503) */
async function fetchWithRetry(
  url: string,
  opts: RequestInit,
  retries = 3
): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, opts);

    if (res.ok) return res;

    const isRetryable = [429, 500, 502, 503].includes(res.status);
    if (!isRetryable || i === retries - 1) {
      const errorText = await res.text();
      throw new Error(
        `LLM API error (${res.status}): ${errorText.substring(0, 300)}`
      );
    }

    // Exponential backoff: 2s, 4s, 8s + jitter
    const delay = 2000 * Math.pow(2, i) + Math.random() * 500;
    console.log(
      `[LLM] ${res.status} on attempt ${i + 1}/${retries}. Retrying in ${Math.round(delay)}ms...`
    );
    await new Promise((r) => setTimeout(r, delay));
  }

  throw new Error("LLM fetch failed after all retries");
}

// ════════════════════════════════════════════════════
// GROQ ADAPTER — OpenAI-compatible format
// ════════════════════════════════════════════════════

class GroqAdapter implements LLMAdapter {
  readonly provider = "groq" as const;
  readonly model = "llama-3.3-70b-versatile";

  async call(params: LLMCallParams): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GROQ_API_KEY environment variable is not set. " +
          "Set it via: npx convex env set GROQ_API_KEY gsk_..."
      );
    }

    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        // Groq: system message goes IN the messages array
        { role: "system", content: params.systemPrompt },
        { role: "user", content: params.userPrompt },
      ],
      temperature: params.temperature ?? 0.3,
      max_tokens: params.maxTokens ?? 4096,
    };

    // Groq supports OpenAI-style JSON mode natively
    if (params.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    const res = await fetchWithRetry(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    const data = await res.json();

    if (!data.choices?.[0]?.message?.content) {
      throw new Error(
        `Groq returned unexpected response: ${JSON.stringify(data).substring(0, 300)}`
      );
    }

    return data.choices[0].message.content;
  }
}

// ════════════════════════════════════════════════════
// ANTHROPIC ADAPTER — Anthropic Messages API format
// ════════════════════════════════════════════════════

class AnthropicAdapter implements LLMAdapter {
  readonly provider = "anthropic" as const;
  readonly model = "claude-sonnet-4-20250514";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async call(params: LLMCallParams): Promise<string> {
    const body = {
      model: this.model,
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 0.3,
      // Anthropic: system is a TOP-LEVEL parameter, NOT in messages array
      system: params.systemPrompt,
      messages: [{ role: "user" as const, content: params.userPrompt }],
    };

    const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        // Anthropic uses x-api-key, NOT Authorization: Bearer
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    // Anthropic response shape: { content: [{ type: "text", text: "..." }] }
    if (!data.content?.[0]?.text) {
      throw new Error(
        `Anthropic returned unexpected response: ${JSON.stringify(data).substring(0, 300)}`
      );
    }

    const rawText = data.content[0].text;

    // Anthropic does NOT have native json_mode.
    // Extract JSON manually when requested.
    if (params.jsonMode) {
      return extractJSON(rawText);
    }

    return rawText;
  }
}

// ════════════════════════════════════════════════════
// FACTORY
// ════════════════════════════════════════════════════

/**
 * Create an LLM adapter for the specified provider.
 *
 * @param provider - "groq" (uses server env key) or "anthropic" (requires user key)
 * @param anthropicApiKey - Required when provider is "anthropic"
 */
export function createAdapter(
  provider: "groq" | "anthropic",
  anthropicApiKey?: string
): LLMAdapter {
  if (provider === "anthropic") {
    if (!anthropicApiKey) {
      throw new Error(
        "Anthropic provider requires an API key. " +
          "Add one in Settings → Claude Intelligence."
      );
    }
    return new AnthropicAdapter(anthropicApiKey);
  }

  return new GroqAdapter();
}
