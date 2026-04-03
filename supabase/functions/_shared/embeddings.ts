import { normalizeWhitespace, safeString } from "./locationPipeline.ts";

export const EMBEDDING_MODEL =
  Deno.env.get("GEMINI_EMBEDDING_MODEL") || "gemini-embedding-001";
export const EMBEDDING_DIM = 768;

export type EmbeddingTaskType = "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT";

export interface EmbeddingRequest {
  text: string;
  title?: string;
  taskType: EmbeddingTaskType;
}

export interface EmbeddingDocumentInput {
  name: string;
  currentPosition: string;
  bio: string;
  occupation: string;
  sectors: string[];
  flemishConnections: string[];
  locationText: string;
}

export interface PersonTextChunkInput {
  chunk_type: "bio" | "position" | "combined";
  chunk_index: number;
  chunk_text: string;
}

function toContent(text: string) {
  return {
    parts: [{ text }],
  };
}

function getEmbeddingUrl(method: "single" | "batch"): string {
  return method === "batch"
    ? `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents`
    : `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`;
}

function getAsyncEmbeddingBatchUrl(): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:asyncBatchEmbedContent`;
}

function normalizeSentenceBoundaries(value: string): string[] {
  return normalizeWhitespace(value)
    .split(/(?<=[.!?])\s+/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
}

function appendLabeledLine(lines: string[], label: string, value: string | string[]) {
  const normalized = Array.isArray(value)
    ? value.map((item) => normalizeWhitespace(item)).filter(Boolean).join(", ")
    : normalizeWhitespace(value);

  if (normalized) {
    lines.push(`${label}: ${normalized}`);
  }
}

export function buildStructuredEmbeddingText(input: EmbeddingDocumentInput): string {
  const lines: string[] = [];
  appendLabeledLine(lines, "Name", input.name);
  appendLabeledLine(lines, "Role", input.currentPosition);
  appendLabeledLine(lines, "Occupation", input.occupation);
  appendLabeledLine(lines, "Sectors", input.sectors);
  appendLabeledLine(lines, "Flemish connections", input.flemishConnections);
  appendLabeledLine(lines, "Location", input.locationText);
  appendLabeledLine(lines, "Bio", input.bio);
  return lines.join("\n");
}

function pushChunk(
  chunks: PersonTextChunkInput[],
  chunk_type: PersonTextChunkInput["chunk_type"],
  chunk_index: number,
  chunk_text: string,
) {
  const normalized = normalizeWhitespace(chunk_text);
  if (!normalized) return;
  chunks.push({ chunk_type, chunk_index, chunk_text: normalized });
}

function buildBioChunks(bio: string): PersonTextChunkInput[] {
  const sentences = normalizeSentenceBoundaries(bio);
  if (sentences.length === 0) return [];

  const chunks: PersonTextChunkInput[] = [];
  let buffer = "";
  let chunkIndex = 0;

  for (const sentence of sentences) {
    const candidate = buffer ? `${buffer} ${sentence}` : sentence;
    if (candidate.length <= 340) {
      buffer = candidate;
      continue;
    }

    if (buffer) {
      pushChunk(chunks, "bio", chunkIndex, buffer);
      chunkIndex += 1;
      buffer = sentence;
      continue;
    }

    const words = sentence.split(/\s+/);
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length <= 340) {
        current = next;
      } else {
        pushChunk(chunks, "bio", chunkIndex, current);
        chunkIndex += 1;
        current = word;
      }
    }
    pushChunk(chunks, "bio", chunkIndex, current);
    chunkIndex += 1;
    buffer = "";
  }

  if (buffer) {
    pushChunk(chunks, "bio", chunkIndex, buffer);
  }

  return chunks.slice(0, 4);
}

export function buildPersonTextChunks(input: EmbeddingDocumentInput): PersonTextChunkInput[] {
  const chunks: PersonTextChunkInput[] = [];
  const roleLine = [
    safeString(input.currentPosition),
    safeString(input.occupation),
    input.sectors.length > 0 ? input.sectors.join(", ") : "",
    safeString(input.locationText),
  ]
    .filter(Boolean)
    .join(" | ");

  if (roleLine) {
    pushChunk(chunks, "position", 0, roleLine);
  }

  buildBioChunks(input.bio).forEach((chunk) => chunks.push(chunk));

  const combined = [
    safeString(input.currentPosition),
    safeString(input.bio),
    input.flemishConnections.length > 0
      ? `Flemish: ${input.flemishConnections.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join(". ");

  if (combined) {
    pushChunk(chunks, "combined", 0, combined);
  }

  return chunks.slice(0, 6);
}

function extractEmbeddingValues(payload: unknown): number[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;

  if (Array.isArray(record.values)) {
    return record.values.filter((value): value is number => typeof value === "number");
  }

  if (record.embedding && typeof record.embedding === "object") {
    return extractEmbeddingValues(record.embedding);
  }

  return [];
}

function validateEmbedding(values: number[]): number[] {
  if (values.length !== EMBEDDING_DIM) {
    throw new Error(`Expected ${EMBEDDING_DIM} embedding dimensions, got ${values.length}`);
  }
  return values;
}

async function embedSingle(
  apiKey: string,
  request: EmbeddingRequest,
): Promise<number[]> {
  const response = await fetch(getEmbeddingUrl("single"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      content: toContent(request.text),
      taskType: request.taskType,
      title: request.title || undefined,
      outputDimensionality: EMBEDDING_DIM,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding API error ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json();
  return validateEmbedding(extractEmbeddingValues(payload));
}

async function embedBatch(
  apiKey: string,
  requests: EmbeddingRequest[],
): Promise<number[][]> {
  const response = await fetch(getEmbeddingUrl("batch"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      requests: requests.map((request) => ({
        model: `models/${EMBEDDING_MODEL}`,
        content: toContent(request.text),
        taskType: request.taskType,
        title: request.title || undefined,
        outputDimensionality: EMBEDDING_DIM,
      })),
    }),
  });

  if (!response.ok) {
    throw new Error(`Batch embedding API error ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json();
  const rawEmbeddings = Array.isArray(payload?.embeddings)
    ? payload.embeddings
    : Array.isArray(payload?.responses)
      ? payload.responses
      : [];

  if (rawEmbeddings.length !== requests.length) {
    throw new Error(
      `Expected ${requests.length} batch embeddings, got ${rawEmbeddings.length}`,
    );
  }

  return rawEmbeddings.map((item: unknown) =>
    validateEmbedding(extractEmbeddingValues(item))
  );
}

export async function createAsyncEmbeddingBatch(
  apiKey: string,
  requests: Array<{
    request: {
      model?: string;
      content: { parts: Array<{ text: string }> };
      taskType: EmbeddingTaskType;
      title?: string;
      outputDimensionality: number;
    };
    metadata?: Record<string, unknown>;
  }>,
  displayName: string,
): Promise<string> {
  const response = await fetch(getAsyncEmbeddingBatchUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      batch: {
        displayName,
        inputConfig: {
          requests: {
            requests: requests.map((item) => ({
              request: {
                model: item.request.model || `models/${EMBEDDING_MODEL}`,
                content: item.request.content,
                taskType: item.request.taskType,
                title: item.request.title || undefined,
                outputDimensionality: item.request.outputDimensionality,
              },
              metadata: item.metadata || undefined,
            })),
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Async embedding batch API error ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json();
  const batchName = typeof payload?.name === "string" ? payload.name : "";

  if (!batchName) {
    throw new Error("Async embedding batch did not return a batch name");
  }

  return batchName;
}

export async function getAsyncEmbeddingBatch(
  apiKey: string,
  batchName: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${batchName}`,
    {
      method: "GET",
      headers: {
        "x-goog-api-key": apiKey,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Async embedding batch lookup failed ${response.status}: ${await response.text()}`);
  }

  return await response.json() as Record<string, unknown>;
}

export async function cancelAsyncEmbeddingBatch(
  apiKey: string,
  batchName: string,
): Promise<void> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${batchName}:cancel`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Async embedding batch cancel failed ${response.status}: ${await response.text()}`);
  }
}

export async function embedTexts(
  apiKey: string,
  requests: EmbeddingRequest[],
): Promise<number[][]> {
  if (requests.length === 0) return [];
  if (requests.length === 1) {
    return [await embedSingle(apiKey, requests[0])];
  }

  return await embedBatch(apiKey, requests);
}
