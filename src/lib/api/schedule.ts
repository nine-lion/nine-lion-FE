import { apiFetch, apiFetchForm } from './client';

// ────────────────────────────────────────────────────────────────────────────
// Types — match nine-lion-BE-AI openapi.json (paths: /schedule/*, schemas:
// ScheduleSegment / VoiceScheduleResponse / ScheduleDraftResponse)
// ────────────────────────────────────────────────────────────────────────────

export type ScheduleBlockType = 'study' | 'sleep' | 'rest';

export type ScheduleSegment = {
  start: string; // HH:MM, 24h
  end: string; // HH:MM, 24h
  type: ScheduleBlockType;
  label: string;
};

export type VoiceScheduleResponse = {
  transcript: string;
  date: string; // YYYY-MM-DD
  segments: ScheduleSegment[];
  stt_model: string;
  duration: number | null;
};

export type ScheduleDraftResponse = {
  transcript: string;
  date: string;
  segments: ScheduleSegment[];
};

export type VoiceScheduleOptions = {
  referenceDate?: string; // YYYY-MM-DD, default = today
};

/**
 * POST /schedule/voice — audio → transcript → a day's time-block segments.
 */
export function createScheduleFromVoice(
  audio: Blob,
  options: VoiceScheduleOptions = {},
): Promise<VoiceScheduleResponse> {
  const body = new FormData();
  body.append('audio', audio, 'recording.webm');
  if (options.referenceDate) body.append('reference_date', options.referenceDate);
  return apiFetchForm<VoiceScheduleResponse>('/schedule/voice', {
    method: 'POST',
    body,
  });
}

/**
 * POST /schedule/parse — re-extract segments from a (possibly user-edited) transcript.
 */
export function parseScheduleText(text: string, referenceDate?: string): Promise<ScheduleDraftResponse> {
  return apiFetch<ScheduleDraftResponse>('/schedule/parse', {
    method: 'POST',
    body: JSON.stringify({ text, reference_date: referenceDate }),
  });
}
