import { NextRequest, NextResponse } from 'next/server';
import { formatClockKo, formatMinutesKo } from '@/lib/time';

export const runtime = 'nodejs';

type DaySummary = {
  date: string;
  sleepMinutes: number;
  mealMinutes: number;
  restMinutes: number;
  studyMinutes: number;
  studyStartMinutes: number | null;
};

type UsageSummary = {
  sleepMinutes: number;
  mealMinutes: number;
  restMinutes: number;
  studyMinutes: number;
  studyStartMinutes: number | null;
  dayCount: number;
};

type InsightCategory = 'sleep' | 'meal' | 'rest' | 'study' | 'schedule';
type Insight = { category: InsightCategory; observation: string; suggestion: string };

const INSIGHT_CATEGORIES: readonly InsightCategory[] = ['sleep', 'meal', 'rest', 'study', 'schedule'];

function normalizeCategory(value: unknown): InsightCategory {
  return typeof value === 'string' && (INSIGHT_CATEGORIES as readonly string[]).includes(value)
    ? (value as InsightCategory)
    : 'schedule';
}

function isDaySummary(value: unknown): value is DaySummary {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.date === 'string' &&
    typeof record.sleepMinutes === 'number' &&
    typeof record.mealMinutes === 'number' &&
    typeof record.restMinutes === 'number' &&
    typeof record.studyMinutes === 'number' &&
    (record.studyStartMinutes === null || typeof record.studyStartMinutes === 'number')
  );
}

function isUsageSummary(value: unknown): value is UsageSummary {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.sleepMinutes === 'number' &&
    typeof record.mealMinutes === 'number' &&
    typeof record.restMinutes === 'number' &&
    typeof record.studyMinutes === 'number' &&
    (record.studyStartMinutes === null || typeof record.studyStartMinutes === 'number') &&
    typeof record.dayCount === 'number'
  );
}

function isInsightShape(value: unknown): value is { observation: string; suggestion: string; category?: unknown } {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.observation === 'string' && typeof record.suggestion === 'string';
}

function buildOptimizePrompt(summary: UsageSummary, days: DaySummary[]) {
  const summaryLines = [
    `- 평균 수면 시간: ${formatMinutesKo(summary.sleepMinutes)}`,
    `- 평균 식사 시간: ${formatMinutesKo(summary.mealMinutes)}`,
    `- 평균 기타 휴식 시간: ${formatMinutesKo(summary.restMinutes)}`,
    `- 평균 공부 시간: ${formatMinutesKo(summary.studyMinutes)}`,
    summary.studyStartMinutes !== null ? `- 평균 공부 시작 시각: ${formatClockKo(summary.studyStartMinutes)}` : null,
    `- 분석에 사용된 기록 일수: ${summary.dayCount}일`,
  ].filter((line): line is string => Boolean(line)).join('\n');

  const breakdownLines = days
    .slice(-30)
    .map((day) => {
      const parts = [
        `수면 ${formatMinutesKo(day.sleepMinutes)}`,
        `식사 ${formatMinutesKo(day.mealMinutes)}`,
        `휴식 ${formatMinutesKo(day.restMinutes)}`,
        `공부 ${formatMinutesKo(day.studyMinutes)}`,
      ];
      if (day.studyStartMinutes !== null) parts.push(`공부 시작 ${formatClockKo(day.studyStartMinutes)}`);
      return `${day.date}: ${parts.join(', ')}`;
    })
    .join('\n');

  return `You are an AI study coach reviewing a student's accumulated daily time-usage logs from a Korean study-planning app called "Goalsetter". The logs record each day's sleep, meal, other rest/break, and study time in minutes, plus the clock time studying first started that day.

Averaged data:
${summaryLines}

Per-day breakdown (most recent last):
${breakdownLines}

Based only on this real data, write concrete, numbers-grounded optimization advice in Korean, in the voice of a supportive but direct coach. Every observation must cite an actual figure derived from the data above — never invent a number that isn't supported by it.

Return strict JSON, no prose outside it:
{
  "insights": [ { "category": "sleep"|"meal"|"rest"|"study"|"schedule", "observation": "실제 수치를 인용한 관찰 (한 문장)", "suggestion": "그 관찰에 대한 구체적 개선 제안 (한 문장)" } ],
  "plan": [ "실행 가능한 개선 계획 항목 (한 문장), 우선순위 순으로" ],
  "expectedGainMinutes": <계획을 실행했을 때 하루에 추가로 확보 가능한 공부 시간(분)에 대한 현실적인 정수 추정치>
}

Rules:
- "insights"는 2~4개, 각각 데이터의 서로 다른 측면에 근거할 것.
- 각 insight의 "category"는 그 observation이 다루는 주제를 정확히 하나 골라 표시할 것: 수면 관련이면 "sleep", 식사 관련이면 "meal", 그 외 휴식/이동 등이면 "rest", 공부 시간/집중도 관련이면 "study", 공부 시작 시각이나 하루 일정 배분 관련이면 "schedule".
- "plan"은 3~5개, 우선순위 순으로 정렬된 한 문장짜리 실행 항목일 것.
- "expectedGainMinutes"는 과장하지 말고 제안한 축소분에 기반한 현실적인 추정치일 것.
- 이미 습관이 건강하고 효율적이라면 억지로 문제를 만들지 말고 그렇게 말할 것.`;
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: '서버에 OPENAI_API_KEY가 설정되어 있지 않아요.' }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했어요.' }, { status: 400 });
  }

  const { summary, days } = (body ?? {}) as { summary?: unknown; days?: unknown };
  if (!isUsageSummary(summary) || !Array.isArray(days) || days.length === 0) {
    return NextResponse.json({ error: '분석할 시간 기록이 부족해요.' }, { status: 400 });
  }
  const validDays = days.filter(isDaySummary);
  if (validDays.length === 0) {
    return NextResponse.json({ error: '분석할 시간 기록이 부족해요.' }, { status: 400 });
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildOptimizePrompt(summary, validDays) },
        { role: 'user', content: '위 데이터를 분석해서 JSON으로 응답해줘.' },
      ],
    }),
  });

  if (!response.ok) {
    return NextResponse.json({ error: `분석 요청에 실패했어요. (${response.status})` }, { status: 502 });
  }

  const data = await response.json();
  const content: string = data.choices?.[0]?.message?.content ?? '{}';

  let parsed: { insights?: unknown; plan?: unknown; expectedGainMinutes?: unknown };
  try {
    parsed = JSON.parse(content);
  } catch {
    return NextResponse.json({ error: '분석 결과를 해석하지 못했어요.' }, { status: 502 });
  }

  const insights: Insight[] = Array.isArray(parsed.insights)
    ? parsed.insights
        .filter(isInsightShape)
        .map((item) => ({ category: normalizeCategory(item.category), observation: item.observation, suggestion: item.suggestion }))
    : [];
  const plan = Array.isArray(parsed.plan) ? parsed.plan.filter((item): item is string => typeof item === 'string') : [];
  const expectedGainMinutes =
    typeof parsed.expectedGainMinutes === 'number' && Number.isFinite(parsed.expectedGainMinutes)
      ? Math.max(0, Math.round(parsed.expectedGainMinutes))
      : 0;

  if (insights.length === 0 && plan.length === 0) {
    return NextResponse.json({ error: '분석 결과가 비어 있어요.' }, { status: 502 });
  }

  return NextResponse.json({ insights, plan, expectedGainMinutes });
}
