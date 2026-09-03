type RawCalendarEvent = {
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  type: 'sleep' | 'study' | 'rest';
  label: string;
  goal: string | null;
};

type CalendarEvent = {
  date: string;
  endDate: string;
  start: number;
  end: number;
  type: 'sleep' | 'study' | 'rest';
  label: string;
  goal: string | null;
};

const OPENAI_API_URL = 'https://api.openai.com/v1';
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const calendarSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    events: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          start_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          end_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          start_time: { type: 'string', pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d$' },
          end_time: { type: 'string', pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d$' },
          type: { type: 'string', enum: ['sleep', 'study', 'rest'] },
          label: { type: 'string', minLength: 1, maxLength: 40 },
          goal: { type: ['string', 'null'], maxLength: 80 },
        },
        required: ['start_date', 'end_date', 'start_time', 'end_time', 'type', 'label', 'goal'],
      },
    },
  },
  required: ['events'],
} as const;

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function nextIsoDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

function timeValue(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours + minutes / 60;
}

function normalizeEvents(input: unknown): CalendarEvent[] {
  if (!input || typeof input !== 'object' || !Array.isArray((input as { events?: unknown }).events)) return [];
  const normalized: CalendarEvent[] = [];
  for (const candidate of (input as { events: unknown[] }).events.slice(0, 8)) {
    if (!candidate || typeof candidate !== 'object') continue;
    const event = candidate as Partial<RawCalendarEvent>;
    if (!event.start_date || !isIsoDate(event.start_date) || !event.end_date || !isIsoDate(event.end_date) || !event.start_time || !event.end_time) continue;
    if (event.type !== 'sleep' && event.type !== 'study' && event.type !== 'rest') continue;
    const start = timeValue(event.start_time);
    const end = timeValue(event.end_time);
    const label = typeof event.label === 'string' ? event.label.trim().slice(0, 40) : '';
    const goal = typeof event.goal === 'string' && event.goal.trim() ? event.goal.trim().slice(0, 80) : null;
    if (start === null || end === null || !label) continue;
    let endDate = event.end_date;
    if (endDate === event.start_date && end < start) endDate = nextIsoDate(event.start_date);
    const startsAt = Date.parse(`${event.start_date}T00:00:00Z`) + start * 60 * 60 * 1000;
    const endsAt = Date.parse(`${endDate}T00:00:00Z`) + end * 60 * 60 * 1000;
    if (endsAt <= startsAt) continue;
    normalized.push({ date: event.start_date, endDate, start, end, type: event.type, label, goal: event.type === 'study' ? goal : null });
  }
  return normalized;
}

function outputText(payload: unknown) {
  if (!payload || typeof payload !== 'object') return '';
  const response = payload as { output_text?: unknown; output?: unknown[] };
  if (typeof response.output_text === 'string') return response.output_text;
  for (const item of response.output ?? []) {
    if (!item || typeof item !== 'object') continue;
    const message = item as { type?: unknown; content?: unknown[] };
    if (message.type !== 'message') continue;
    const content = message.content ?? [];
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const output = part as { type?: unknown; text?: unknown };
      if (output.type === 'output_text' && typeof output.text === 'string') return output.text;
    }
  }
  return '';
}

async function transcribe(audio: File, apiKey: string) {
  const body = new FormData();
  body.append('file', audio, audio.name || 'goalsetter-voice.webm');
  body.append('model', process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-transcribe');
  body.append('prompt', '주로 한국어로 말하는 학습 시간 기록입니다. 영어 과목명도 섞일 수 있습니다. 날짜, 시각, 과목명을 정확히 보존하세요.');
  body.append('language', 'ko');

  const response = await fetch(`${OPENAI_API_URL}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  });
  const payload = await response.json() as { text?: unknown; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || 'Speech-to-text request failed.');
  if (typeof payload.text !== 'string' || !payload.text.trim()) throw new Error('음성에서 텍스트를 찾지 못했어요.');
  return payload.text.trim();
}

async function parseCalendarText(rawText: string, today: string, goals: string[], apiKey: string) {
  const response = await fetch(`${OPENAI_API_URL}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_PARSER_MODEL || 'gpt-5-mini',
      store: false,
      instructions: [
        'Convert the user sentence into zero or more calendar time events.',
        `The reference date is ${today} in Asia/Seoul. Resolve Korean and English relative dates from that date.`,
        'Use sleep for sleeping or naps, study for studying or exam preparation, and rest for meals, breaks, exercise, travel, or other activities.',
        'Preserve a short useful Korean or English label from the sentence.',
        `Available study goals: ${goals.length > 0 ? goals.join(', ') : '(none)'}. For each study event, set goal to the exact matching available goal name, or null when no goal can be determined. Always use null for sleep and rest.`,
        'Return an explicit start_date and end_date for every event. For an overnight interval, end_date must be the following date; never split one continuous interval into multiple events.',
        'Do not invent a date or time. Return an empty events array when a required date/time cannot be resolved.',
      ].join('\n'),
      input: rawText,
      text: {
        format: {
          type: 'json_schema',
          name: 'goalsetter_calendar_events',
          strict: true,
          schema: calendarSchema,
        },
      },
      max_output_tokens: 3000,
    }),
  });

  const payload = await response.json() as { error?: { message?: string }; status?: string; incomplete_details?: { reason?: string } };
  if (!response.ok) throw new Error(payload.error?.message || 'Structured parsing request failed.');
  if (payload.status === 'incomplete') {
    const reason = payload.incomplete_details?.reason;
    throw new Error(reason === 'max_output_tokens' ? '일정 구조화 응답이 너무 길어 완료되지 않았어요. 입력을 조금 간단히 해주세요.' : '일정 구조화 응답이 완료되지 않았어요.');
  }
  const text = outputText(payload);
  if (!text) throw new Error('구조화된 일정 데이터를 받지 못했어요.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('일정 데이터가 올바른 JSON 형식이 아니에요.');
  }
  const events = normalizeEvents(parsed);
  if (events.length === 0) throw new Error('날짜와 시작·종료 시간을 포함해 말하거나 입력해주세요.');
  return events;
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json({ error: 'OPENAI_API_KEY가 설정되지 않았어요.' }, 503);

  let rawText = '';
  try {
    const contentType = request.headers.get('content-type') || '';
    let today = '';
    let goals: string[] = [];

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const audio = formData.get('audio');
      const todayValue = formData.get('today');
      const goalsValue = formData.get('goals');
      today = typeof todayValue === 'string' ? todayValue : '';
      if (typeof goalsValue === 'string') {
        try {
          const parsedGoals = JSON.parse(goalsValue);
          if (Array.isArray(parsedGoals)) goals = parsedGoals.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean).slice(0, 20);
        } catch {
          goals = [];
        }
      }
      if (!(audio instanceof File) || !audio.type.startsWith('audio/')) return json({ error: '올바른 음성 파일이 필요해요.' }, 400);
      if (audio.size === 0 || audio.size > MAX_AUDIO_BYTES) return json({ error: '음성 파일은 20MB 이하로 녹음해주세요.' }, 400);
      rawText = await transcribe(audio, apiKey);
    } else if (contentType.includes('application/json')) {
      const body = await request.json() as { text?: unknown; today?: unknown; goals?: unknown };
      rawText = typeof body.text === 'string' ? body.text.trim() : '';
      today = typeof body.today === 'string' ? body.today : '';
      if (Array.isArray(body.goals)) goals = body.goals.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean).slice(0, 20);
    } else {
      return json({ error: '지원하지 않는 입력 형식이에요.' }, 415);
    }

    if (!rawText || rawText.length > 2000) return json({ error: '1~2000자의 자연어 입력이 필요해요.', rawText }, 400);
    if (!isIsoDate(today)) return json({ error: '기준 날짜가 올바르지 않아요.', rawText }, 400);

    const events = await parseCalendarText(rawText, today, goals, apiKey);
    return json({ rawText, events });
  } catch (error) {
    const message = error instanceof Error ? error.message : '입력을 처리하지 못했어요.';
    return json({ error: message, rawText }, 502);
  }
}
