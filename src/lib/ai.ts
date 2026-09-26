import "server-only";
import { APICallError, wrapLanguageModel } from "ai";
import { createGoogleVertex } from "@ai-sdk/google-vertex";

/**
 * Google Cloud credentials for Vertex AI, in order:
 *   1. GOOGLE_VERTEX_CREDENTIALS: a service-account JSON key pasted into .env.local (raw JSON or base64),
 *      so sharing the env file is enough and access is controlled by that account's IAM role.
 *   2. Otherwise Application Default Credentials: GOOGLE_APPLICATION_CREDENTIALS (key file path)
 *      or `gcloud auth application-default login`.
 */
function serviceAccountCredentials() {
  const raw = process.env.GOOGLE_VERTEX_CREDENTIALS?.trim();
  if (!raw) return undefined;
  const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  try {
    const key = JSON.parse(json) as { client_email?: string; private_key?: string };
    if (!key.client_email || !key.private_key) throw new Error("missing client_email or private_key");
    return { client_email: key.client_email, private_key: key.private_key };
  } catch (err) {
    throw new Error(`GOOGLE_VERTEX_CREDENTIALS is not a valid service-account JSON key: ${(err as Error).message}`);
  }
}

const credentials = serviceAccountCredentials();
export const googleVertex = createGoogleVertex(credentials ? { googleAuthOptions: { credentials } } : {});

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
