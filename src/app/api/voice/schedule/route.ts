import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

type BlockType = 'study' | 'sleep' | 'rest';
type ScheduleSegment = { start: string; end: string; type: BlockType; label: string };

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEFAULT_LABEL: Record<BlockType, string> = { study: '공부', sleep: '수면', rest: '휴식' };

function buildSchedulePrompt(referenceDate: string) {
  return `You extract a day's activity timeline from a Korean speech transcript for a study-planning calendar app.
The entire recording describes activities on a single date: ${referenceDate} (YYYY-MM-DD).
Break the narration into consecutive time segments in chronological order. Infer AM/PM from context when the speaker doesn't say it explicitly — segments described later in the narration happen later in the day unless the speaker clearly says otherwise.
Classify each segment's "type" as one of: "study" (공부, 학습), "sleep" (수면, 잠), "rest" (식사, 휴식, 이동 등 그 외 활동).
Round times to the nearest 5 minutes, formatted as 24-hour "HH:MM".
Return strict JSON: {"segments": [{"start": "HH:MM", "end": "HH:MM", "type": "study"|"sleep"|"rest", "label": "짧은 한글 설명"}]}.
Only include segments the speaker actually described. If nothing usable is said, return {"segments": []}.`;
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: '서버에 OPENAI_API_KEY가 설정되어 있지 않아요.' }, { status: 500 });
  }

  const formData = await request.formData();
  const audio = formData.get('audio');
  const referenceDate = String(formData.get('referenceDate') ?? new Date().toISOString().slice(0, 10));

  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: '오디오 데이터를 받지 못했어요.' }, { status: 400 });
  }

  const transcriptionForm = new FormData();
  transcriptionForm.append('file', audio, 'recording.webm');
  transcriptionForm.append('model', 'whisper-1');
  transcriptionForm.append('language', 'ko');

  const transcriptionResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: transcriptionForm,
  });

  if (!transcriptionResponse.ok) {
    return NextResponse.json(
      { error: `음성 인식에 실패했어요. (${transcriptionResponse.status})` },
      { status: 502 },
    );
  }

  const { text: transcript } = (await transcriptionResponse.json()) as { text: string };

  if (!transcript?.trim()) {
    return NextResponse.json({ error: '음성에서 텍스트를 인식하지 못했어요.' }, { status: 422 });
  }

  const extractionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSchedulePrompt(referenceDate) },
        { role: 'user', content: transcript },
      ],
    }),
  });

  if (!extractionResponse.ok) {
    return NextResponse.json(
      { error: `내용 정리에 실패했어요. (${extractionResponse.status})`, transcript },
      { status: 502 },
    );
  }

  const extractionData = await extractionResponse.json();
  const content: string = extractionData.choices?.[0]?.message?.content ?? '{}';

  let parsed: { segments?: Partial<ScheduleSegment>[] };
  try {
    parsed = JSON.parse(content);
  } catch {
    return NextResponse.json({ error: '인식 결과를 해석하지 못했어요.', transcript }, { status: 502 });
  }

  const segments: ScheduleSegment[] = (parsed.segments ?? [])
    .filter(
      (segment): segment is { start: string; end: string; type: BlockType; label?: string } =>
        typeof segment.start === 'string' &&
        TIME_PATTERN.test(segment.start) &&
        typeof segment.end === 'string' &&
        TIME_PATTERN.test(segment.end) &&
        segment.start < segment.end &&
        (segment.type === 'study' || segment.type === 'sleep' || segment.type === 'rest'),
    )
    .map((segment) => ({
      start: segment.start,
      end: segment.end,
      type: segment.type,
      label: segment.label?.trim() || DEFAULT_LABEL[segment.type],
    }));

  return NextResponse.json({ transcript, date: referenceDate, segments });
}
