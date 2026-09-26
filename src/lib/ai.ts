import "server-only";
import { APICallError, wrapLanguageModel } from "ai";
import { googleVertex } from "@ai-sdk/google-vertex";

const isRateLimit = (err: unknown) => APICallError.isInstance(err) && err.statusCode === 429;

/**
 * Vertex AI model with a fallback: newer Gemini models have small shared quotas on new projects,
 * so when the primary model is rate-limited (HTTP 429) the request is retried on the fallback model.
 */
export function chatModel() {
  const primaryId = process.env.CHAT_MODEL ?? "gemini-3.5-flash";
  const fallbackId = process.env.CHAT_FALLBACK_MODEL ?? "gemini-2.5-flash";
  const fallback = googleVertex(fallbackId);

  return wrapLanguageModel({
    model: googleVertex(primaryId),
    middleware: {
      specificationVersion: "v4",
      async wrapGenerate({ doGenerate, params }) {
        try {
          return await doGenerate();
        } catch (err) {
          if (!isRateLimit(err) || fallbackId === primaryId) throw err;
          console.warn(`${primaryId} rate-limited, falling back to ${fallbackId}`);
          return fallback.doGenerate(params);
        }
      },
      async wrapStream({ doStream, params }) {
        try {
          return await doStream();
        } catch (err) {
          if (!isRateLimit(err) || fallbackId === primaryId) throw err;
          console.warn(`${primaryId} rate-limited, falling back to ${fallbackId}`);
          return fallback.doStream(params);
        }
      },
    },
  });
}
