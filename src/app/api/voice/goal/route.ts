import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

type GoalFields = { exam: string; date: string; scope: string; target: string };

function buildExtractionPrompt(referenceDate: string) {
  return `You extract exam-goal details from Korean speech transcripts for a study-planning app.
Today's date is ${referenceDate} (YYYY-MM-DD). Resolve any relative dates (e.g. "다음 달", "이번 달 26일") against this date.
Return strict JSON with exactly these keys: "exam" (시험 이름), "date" (YYYY-MM-DD, best-effort guess; "" if not stated), "scope" (출제범위/과목/단원), "target" (학습 목표).
If a field isn't mentioned in the transcript, return an empty string for it. Never invent information that isn't present.`;
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
        { role: 'system', content: buildExtractionPrompt(referenceDate) },
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

  let parsed: Partial<GoalFields>;
  try {
    parsed = JSON.parse(content);
  } catch {
    return NextResponse.json({ error: '인식 결과를 해석하지 못했어요.', transcript }, { status: 502 });
  }

  return NextResponse.json({
    transcript,
    exam: parsed.exam ?? '',
    date: parsed.date ?? '',
    scope: parsed.scope ?? '',
    target: parsed.target ?? '',
  } satisfies { transcript: string } & GoalFields);
}
