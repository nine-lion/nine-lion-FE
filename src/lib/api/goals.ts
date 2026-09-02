import { apiFetch, apiFetchForm } from './client';

// ────────────────────────────────────────────────────────────────────────────
// Types — match nine-lion-BE-AI openapi.json (paths: /goals/*, schemas:
// GoalDraft / GoalRead / VoiceGoalResponse / TranscriptionResponse / etc.)
// ────────────────────────────────────────────────────────────────────────────

export type GoalFieldKey = 'exam' | 'date' | 'scope' | 'target';

export type GoalDraft = {
  exam: string | null;
  date: string | null; // YYYY-MM-DD
  scope: string | null;
  target: string | null;
  confidence: number; // 0..1
  provider: string; // "openai:gpt-4o-mini" | "heuristic" | "heuristic_fallback"
  notes: string | null;
  missing_fields: GoalFieldKey[];
  missing_labels: string[];
  is_complete: boolean;
  needs_confirmation: boolean;
};

export type GoalRead = {
  id: string;
  exam: string;
  date: string; // alias of BE's exam_date
  scope: string;
  target: string;
  source: 'voice' | 'manual';
  transcript: string | null;
  created_at: string;
  updated_at: string;
  d_day: number;
};

export type VoiceGoalResponse = {
  transcript: string;
  draft: GoalDraft;
  reference_date: string;
  stt_model: string;
  duration: number | null;
  saved: boolean;
  goal: GoalRead | null;
};

export type TranscriptionResponse = {
  text: string;
  language: string | null;
  duration: number | null;
  model: string;
};

export type GoalDraftResponse = {
  transcript: string;
  draft: GoalDraft;
  reference_date: string;
};

export type GoalCreateInput = {
  exam: string;
  date: string;
  scope: string;
  target: string;
  source?: 'voice' | 'manual';
  transcript?: string;
};

export type GoalUpdateInput = Partial<{
  exam: string;
  date: string;
  scope: string;
  target: string;
}>;

// ────────────────────────────────────────────────────────────────────────────
// Voice — POST /goals/voice/* (multipart/form-data)
// ────────────────────────────────────────────────────────────────────────────

export type VoiceGoalOptions = {
  referenceDate?: string; // YYYY-MM-DD, default = today
  save?: boolean; // BE only saves when all 4 fields are filled
};

function buildAudioForm(blob: Blob, options: VoiceGoalOptions, fields: Record<string, string> = {}) {
  const body = new FormData();
  body.append('audio', blob, 'recording.webm');
  if (options.referenceDate) body.append('reference_date', options.referenceDate);
  if (options.save !== undefined) body.append('save', String(options.save));
  for (const [key, value] of Object.entries(fields)) {
    body.append(key, value);
  }
  return body;
}

/**
 * POST /goals/voice — audio → transcript → 4-field draft (+ optional save).
 * The primary entrypoint for the planner tab's voice button.
 */
export function createGoalFromVoice(
  audio: Blob,
  options: VoiceGoalOptions = {},
): Promise<VoiceGoalResponse> {
  return apiFetchForm<VoiceGoalResponse>('/goals/voice', {
    method: 'POST',
    body: buildAudioForm(audio, options),
  });
}

/**
 * POST /goals/voice/transcribe — audio → transcript only (no draft extraction).
 * Useful when showing the raw STT result before extracting goals.
 */
export function transcribeAudio(audio: Blob, prompt?: string): Promise<TranscriptionResponse> {
  const fields: Record<string, string> = {}; if (prompt) fields.prompt = prompt;
  return apiFetchForm<TranscriptionResponse>('/goals/voice/transcribe', {
    method: 'POST',
    body: buildAudioForm(audio, {}, fields),
  });
}

/**
 * POST /goals/parse — re-extract a draft from a (possibly user-edited) transcript.
 * Used after the user manually corrects the auto-transcript in the UI.
 */
export function parseGoalText(text: string, referenceDate?: string): Promise<GoalDraftResponse> {
  return apiFetch<GoalDraftResponse>('/goals/parse', {
    method: 'POST',
    body: JSON.stringify({ text, reference_date: referenceDate }),
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Goal CRUD
// ────────────────────────────────────────────────────────────────────────────

export function listGoals(params: { limit?: number; offset?: number } = {}): Promise<GoalRead[]> {
  const search = new URLSearchParams();
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.offset !== undefined) search.set('offset', String(params.offset));
  const query = search.toString();
  return apiFetch<GoalRead[]>(`/goals${query ? `?${query}` : ''}`);
}

export function createGoal(input: GoalCreateInput): Promise<GoalRead> {
  return apiFetch<GoalRead>('/goals', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getGoal(goalId: string): Promise<GoalRead> {
  return apiFetch<GoalRead>(`/goals/${goalId}`);
}

export function updateGoal(goalId: string, patch: GoalUpdateInput): Promise<GoalRead> {
  return apiFetch<GoalRead>(`/goals/${goalId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteGoal(goalId: string): Promise<void> {
  await apiFetch<null>(`/goals/${goalId}`, {
    method: 'DELETE',
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Health — for the connection banner
// ────────────────────────────────────────────────────────────────────────────

export type HealthResponse = {
  status: 'ok';
  version: string;
  now: string;
  stt: { provider: string; model: string };
  extractor: { provider: string; model: string };
  openai_configured: boolean;
};

export async function fetchHealth(): Promise<HealthResponse | null> {
  try {
    return await apiFetch<HealthResponse>('/health');
  } catch {
    return null;
  }
}
