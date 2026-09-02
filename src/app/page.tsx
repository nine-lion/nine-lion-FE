'use client';

import { FormEvent, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, Brain, CalendarDays, CalendarRange, Check, ChevronLeft, ChevronRight, Clock3, Coffee, ListChecks, LogIn, LogOut, Mic, Moon, Plus, Send, Sparkles, Square, Target, Trash2, TrendingUp, Utensils, Wind } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { getAccountKey, getServerAccountKey, isAuthenticated } from '@/lib/auth';
import { loadJSON, saveJSON } from '@/lib/storage';
import { formatClockKo, formatMinutesKo } from '@/lib/time';

type Goal = { id: number; exam: string; date: string; scope: string; target: string };
type BlockType = 'sleep' | 'study' | 'rest';
type TimeBlock = { id: number; date: string; start: number; end: number; type: BlockType; label: string };
const BLOCK_TYPE_LABEL: Record<BlockType, string> = { study: '공부', sleep: '수면', rest: '휴식' };
const KOREAN_DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const formatHour = (value: number) => `${String(Math.floor(value)).padStart(2, '0')}:${String(Math.round((value - Math.floor(value)) * 60)).padStart(2, '0')}`;

const MINUTE_STEP = 5;
const roundToStep = (minutes: number) => Math.round(minutes / MINUTE_STEP) * MINUTE_STEP;
const hourToTimeValue = (hour: number) => {
  const totalMinutes = Math.min(Math.max(roundToStep(Math.round(hour * 60)), 0), 23 * 60 + 55);
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
};
const timeValueToHour = (value: string) => {
  const [hour, minute] = value.split(':').map(Number);
  return hour + roundToStep(minute || 0) / 60;
};
const hasOverlap = (blocks: TimeBlock[], date: string, start: number, end: number, excludeId?: number) =>
  blocks.some((block) => block.id !== excludeId && block.date === date && start < block.end && end > block.start);

const APP_TODAY_ISO = '2026-09-03';

type VoiceStatus = 'idle' | 'recording' | 'processing' | 'error';

function useVoiceCapture<T>(endpoint: string, onResult: (result: T) => void) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const start = async () => {
    setErrorMessage('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('이 브라우저는 음성 녹음을 지원하지 않아요.');
      setStatus('error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setStatus('processing');
        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          const body = new FormData();
          body.append('audio', blob, 'recording.webm');
          body.append('referenceDate', APP_TODAY_ISO);
          const response = await fetch(endpoint, { method: 'POST', body });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || '음성 처리에 실패했어요.');
          onResult(data as T);
          setStatus('idle');
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : '음성 처리에 실패했어요.');
          setStatus('error');
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setStatus('recording');
    } catch {
      setErrorMessage('마이크 권한이 필요해요.');
      setStatus('error');
    }
  };

  const stop = () => { recorderRef.current?.stop(); };

  return { status, errorMessage, start, stop };
}

type GoalVoiceResult = { exam: string; date: string; scope: string; target: string };
const useVoiceGoalCapture = (onResult: (result: GoalVoiceResult) => void) =>
  useVoiceCapture<GoalVoiceResult>('/api/voice/goal', onResult);

type ScheduleVoiceResult = { segments: { start: string; end: string; type: BlockType; label: string }[] };
const useVoiceScheduleCapture = (onResult: (result: ScheduleVoiceResult) => void) =>
  useVoiceCapture<ScheduleVoiceResult>('/api/voice/schedule', onResult);

function toHourWithMeridiem(match: RegExpMatchArray, meridiemOverride?: string): number {
  const [, before, hourStr, minuteViaBun, minuteViaColon, after] = match;
  const minuteStr = minuteViaBun || minuteViaColon;
  const meridiem = (meridiemOverride || before || after || '').toLowerCase();
  let hour = Number(hourStr);
  if (meridiem === '오후' || meridiem === 'pm') {
    if (hour < 12) hour += 12;
  } else if (meridiem === '오전' || meridiem === 'am') {
    if (hour === 12) hour = 0;
  }
  return hour + Number(minuteStr || 0) / 60;
}

function parseNaturalEntry(text: string, fallback: Date): Omit<TimeBlock, 'id'>[] | null {
  const entryDate = new Date(fallback);
  let remaining = text;

  const koreanDateMatch = remaining.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  const isoDateMatch = !koreanDateMatch ? remaining.match(/(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/) : null;
  const monthDayMatch = !koreanDateMatch && !isoDateMatch ? remaining.match(/(\d{1,2})[.\/](\d{1,2})(\s*일)?/) : null;
  if (koreanDateMatch) {
    entryDate.setMonth(Number(koreanDateMatch[1]) - 1, Number(koreanDateMatch[2]));
    remaining = remaining.replace(koreanDateMatch[0], ' ');
  } else if (isoDateMatch) {
    entryDate.setFullYear(Number(isoDateMatch[1]), Number(isoDateMatch[2]) - 1, Number(isoDateMatch[3]));
    remaining = remaining.replace(isoDateMatch[0], ' ');
  } else if (monthDayMatch) {
    entryDate.setMonth(Number(monthDayMatch[1]) - 1, Number(monthDayMatch[2]));
    remaining = remaining.replace(monthDayMatch[0], ' ');
  }

  if (/어제|yesterday/i.test(remaining)) entryDate.setDate(entryDate.getDate() - 1);
  if (/내일|tomorrow/i.test(remaining)) entryDate.setDate(entryDate.getDate() + 1);

  const timeMatches = [...remaining.matchAll(/(오전|오후|am|pm)?\s*(\d{1,2})\s*시?\s*(?:(\d{1,2})\s*분|:(\d{2}))?\s*(오전|오후|am|pm)?/gi)];
  if (timeMatches.length < 2) return null;
  const start = toHourWithMeridiem(timeMatches[0]);
  const startMeridiem = (timeMatches[0][1] || timeMatches[0][5] || '').toLowerCase();
  const endHasMeridiem = Boolean(timeMatches[1][1] || timeMatches[1][5]);
  let end = toHourWithMeridiem(timeMatches[1]);
  // "오후 8시에서 11시까지" — the second time omits AM/PM; if read literally it would
  // end before it starts, so assume the speaker meant it to carry the same meridiem.
  if (!endHasMeridiem && startMeridiem) {
    const inferredEnd = toHourWithMeridiem(timeMatches[1], startMeridiem);
    if (inferredEnd > start) end = inferredEnd;
  }
  if (start > 24 || end > 24 || start === end) return null;

  const type: BlockType = /수면|잠|잔|잤|sleep/i.test(text) ? 'sleep' : /밥|식사|쉬|휴식|rest/i.test(text) ? 'rest' : 'study';
  const label = BLOCK_TYPE_LABEL[type];

  if (end > start) {
    return [{ date: isoDate(entryDate), start, end, type, label }];
  }

  // Overnight span (e.g. 오후 11시~오전 6시): a block can't cross midnight in this
  // data model, so split it into the tail of this day and the start of the next.
  const nextDay = new Date(entryDate);
  nextDay.setDate(nextDay.getDate() + 1);
  return [
    { date: isoDate(entryDate), start, end: 24, type, label },
    { date: isoDate(nextDay), start: 0, end, type, label },
  ];
}

const DEFAULT_GOALS: Goal[] = [{ id: 1, exam: '일반기계기사 필기', date: '2026-09-26', scope: '재료역학 · 기계열역학 · 기계유체역학 · 기계재료 및 유압기기', target: '기출 7개년 2회독 + 오답노트 완성' }];
const goalsStorageKey = (accountKey: string) => `goalsetter:${accountKey}:goals`;

function PlannerTab({ accountKey }: { accountKey: string }) {
  const [goals, setGoals] = useState<Goal[]>(() => loadJSON(goalsStorageKey(accountKey), DEFAULT_GOALS));
  useEffect(() => { saveJSON(goalsStorageKey(accountKey), goals); }, [accountKey, goals]);
  const [form, setForm] = useState({ exam: '', date: '', scope: '', target: '' });
  const [saved, setSaved] = useState(false);
  const update = (key: keyof typeof form, value: string) => { setSaved(false); setForm((previous) => ({ ...previous, [key]: value })); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.exam || !form.date || !form.scope || !form.target) return;
    setGoals((previous) => [{ id: Date.now(), ...form }, ...previous]);
    setForm({ exam: '', date: '', scope: '', target: '' }); setSaved(true);
  };
  const { status: voiceStatus, errorMessage: voiceError, start: startVoice, stop: stopVoice } = useVoiceGoalCapture((result) => {
    setSaved(false);
    setForm((previous) => ({
      exam: result.exam || previous.exam,
      date: result.date || previous.date,
      scope: result.scope || previous.scope,
      target: result.target || previous.target,
    }));
  });
  return (
    <div className="planner-grid">
      <section className="goal-editor" aria-labelledby="goal-form-heading">
        <div className="section-kicker"><Target aria-hidden="true" /> 새 목표</div>
        <h1 id="goal-form-heading">시험일까지, 할 일을 선명하게.</h1>
        <p className="section-copy">시험과 범위를 적으면 실행 가능한 공부 목표의 시작점이 만들어집니다.</p>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant={voiceStatus === 'recording' ? 'destructive' : 'outline'}
            size="sm"
            disabled={voiceStatus === 'processing'}
            onClick={voiceStatus === 'recording' ? stopVoice : startVoice}
          >
            {voiceStatus === 'recording' ? <><Square aria-hidden="true" /> 녹음 중지</> : voiceStatus === 'processing' ? '인식 중...' : <><Mic aria-hidden="true" /> 음성으로 입력</>}
          </Button>
          {voiceStatus === 'recording' && <span className="text-caption text-muted-foreground">시험명, 시험일, 범위, 목표를 말해주세요</span>}
          {voiceError && <span className="text-caption text-danger">{voiceError}</span>}
        </div>
        <form onSubmit={submit}>
          <FieldGroup className="goal-fields">
            <Field><FieldLabel htmlFor="exam">내가 칠 시험</FieldLabel><Input id="exam" value={form.exam} onChange={(event) => update('exam', event.target.value)} placeholder="예: 일반기계기사 필기" required /></Field>
            <Field><FieldLabel htmlFor="date">시험일</FieldLabel><Input id="date" type="date" value={form.date} onChange={(event) => update('date', event.target.value)} required /></Field>
            <Field className="wide-field"><FieldLabel htmlFor="scope">범위</FieldLabel><Textarea id="scope" value={form.scope} onChange={(event) => update('scope', event.target.value)} placeholder="과목, 단원, 출제 범위를 적어주세요" required /></Field>
            <Field className="wide-field"><FieldLabel htmlFor="target">목표</FieldLabel><Input id="target" value={form.target} onChange={(event) => update('target', event.target.value)} placeholder="예: 기출 7개년 2회독" required /></Field>
          </FieldGroup>
          <div className="form-footer"><span className={saved ? 'save-note is-visible' : 'save-note'}><Check aria-hidden="true" /> 목표가 추가되었어요</span><Button type="submit" size="lg" className="save-goal">목표 만들기 <ArrowRight aria-hidden="true" /></Button></div>
        </form>
      </section>
      <aside className="goal-list" aria-label="내 시험 목표">
        <div className="goal-list-heading"><div><span className="eyebrow">MY GOALS</span><h2>다가오는 시험</h2></div><span className="goal-count">{goals.length}</span></div>
        {goals.map((goal, index) => {
          const days = Math.max(0, Math.ceil((new Date(`${goal.date}T00:00:00`).getTime() - new Date('2026-09-03T00:00:00').getTime()) / 86400000));
          return <article key={goal.id} className={`goal-card ${index === 0 ? 'featured' : ''}`}><div className="goal-card-top"><span>D-{days}</span><CalendarDays aria-hidden="true" /></div><h3>{goal.exam}</h3><time dateTime={goal.date}>{goal.date.replaceAll('-', '. ')}</time><div className="scope-line"><BookOpen aria-hidden="true" /><p>{goal.scope}</p></div><div className="target-pill"><Target aria-hidden="true" />{goal.target}</div></article>;
        })}
      </aside>
    </div>
  );
}

type CalendarView = 'month' | 'quarter' | 'year';

function getMonthCells(month: Date) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(firstDay);
  start.setDate(1 - firstDay.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function TimeMonthGrid({ month, blocks, today, variant, onBlockClick }: { month: Date; blocks: TimeBlock[]; today: Date; variant: CalendarView; onBlockClick?: (id: number) => void }) {
  const cells = getMonthCells(month);
  return (
    <div className={`calendar-grid calendar-grid--${variant}`} role="grid" aria-label={`${month.getFullYear()}년 ${MONTHS[month.getMonth()]} 시간 기록`}>
      {KOREAN_DAYS.map((day, index) => <div key={day} className={`weekday ${index === 0 ? 'sunday' : ''} ${index === 6 ? 'saturday' : ''}`} role="columnheader">{day}</div>)}
      {cells.map((date) => {
        const dateKey = isoDate(date);
        const outside = date.getMonth() !== month.getMonth();
        const dayBlocks = outside ? [] : blocks.filter((block) => block.date === dateKey);
        const current = dateKey === isoDate(today);
        return (
          <div key={dateKey} className={`day-cell ${outside ? 'outside' : ''} ${current ? 'current' : ''}`} role="gridcell" aria-label={`${date.getMonth() + 1}월 ${date.getDate()}일`}>
            <div className="day-number"><span>{date.getDate()}</span></div>
            <div className="marker-track">{dayBlocks.map((block) => (
              <button
                key={block.id}
                type="button"
                className={`time-block ${block.type}`}
                style={{ left: `${(block.start / 24) * 100}%`, width: `${((block.end - block.start) / 24) * 100}%` }}
                title={`${block.label} ${formatHour(block.start)}–${formatHour(block.end)} (클릭해서 조절)`}
                onClick={(event) => { event.stopPropagation(); onBlockClick?.(block.id); }}
              />
            ))}</div>
            {variant === 'month' && dayBlocks.length > 0 && <div className="hours-total">{dayBlocks.filter((block) => block.type === 'study').reduce((sum, block) => sum + block.end - block.start, 0).toFixed(1)}h 공부</div>}
          </div>
        );
      })}
    </div>
  );
}

function YearMatrix({ year, blocks, today }: { year: number; blocks: TimeBlock[]; today: Date }) {
  const days = Array.from({ length: 31 }, (_, index) => index + 1);
  return (
    <div className="year-matrix-wrap">
      <div className="year-matrix" role="grid" aria-label={`${year}년 연간 시간 기록`}>
        <div className="year-corner" role="columnheader">월</div>
        {days.map((day) => <div key={`heading-${day}`} className="year-day-heading" role="columnheader">{day}</div>)}
        {MONTHS.map((_, monthIndex) => (
          <div className="year-row" key={monthIndex} role="row">
            <div className="year-month-label" role="rowheader">{monthIndex + 1}</div>
            {days.map((day) => {
              const date = new Date(year, monthIndex, day);
              const valid = date.getMonth() === monthIndex;
              if (!valid) return <div key={day} className="year-day-cell invalid" aria-hidden="true" />;
              const dateKey = isoDate(date);
              const dayBlocks = blocks.filter((block) => block.date === dateKey);
              const current = dateKey === isoDate(today);
              const weekend = date.getDay() === 0 ? 'sunday' : date.getDay() === 6 ? 'saturday' : '';
              return (
                <div key={day} className={`year-day-cell ${weekend} ${current ? 'current' : ''}`} role="gridcell" aria-label={`${monthIndex + 1}월 ${day}일`}>
                  {dayBlocks.map((block) => <div key={block.id} className={`year-time-block ${block.type}`} style={{ left: `${(block.start / 24) * 100}%`, width: `${((block.end - block.start) / 24) * 100}%` }} title={`${block.label} ${formatHour(block.start)}–${formatHour(block.end)}`} />)}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function TimeBlockEditForm({
  block,
  blocks,
  onSave,
  onDelete,
}: {
  block: TimeBlock;
  blocks: TimeBlock[];
  onSave: (id: number, segments: Omit<TimeBlock, 'id'>[]) => void;
  onDelete: (id: number) => void;
}) {
  const [type, setType] = useState<TimeBlock['type']>(block.type);
  const [label, setLabel] = useState(block.label);
  const [startDate, setStartDate] = useState(block.date);
  const [endDate, setEndDate] = useState(block.date);
  const [start, setStart] = useState(hourToTimeValue(block.start));
  const [end, setEnd] = useState(hourToTimeValue(block.end));
  const [error, setError] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const startHour = timeValueToHour(start);
    const endHour = timeValueToHour(end);
    const dayDiff = Math.round((new Date(`${endDate}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()) / 86400000);
    let segments: { date: string; start: number; end: number }[] | null = null;
    if (dayDiff === 0 && endHour > startHour) {
      segments = [{ date: startDate, start: startHour, end: endHour }];
    } else if (dayDiff === 1) {
      segments = [{ date: startDate, start: startHour, end: 24 }];
      if (endHour > 0) segments.push({ date: endDate, start: 0, end: endHour });
    }
    if (!segments) { setError('종료 날짜/시간은 시작보다 늦어야 하고, 최대 하루까지만 이어질 수 있어요.'); return; }
    if (segments.some((segment) => hasOverlap(blocks, segment.date, segment.start, segment.end, block.id))) {
      setError('이미 등록된 시간과 겹쳐요.');
      return;
    }
    onSave(block.id, segments.map((segment) => ({ ...segment, type, label: label.trim() || BLOCK_TYPE_LABEL[type] })));
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>시간 기록 조절</DialogTitle>
        <DialogDescription>시작과 종료의 날짜를 각각 고를 수 있어요. 자정을 넘기려면 종료 날짜를 다음 날로 바꿔주세요.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} id="time-block-form">
        <FieldGroup>
          <Field orientation="responsive">
            <FieldLabel htmlFor="block-start">시작</FieldLabel>
            <div className="flex w-full gap-2">
              <Input id="block-start" type="time" step={300} value={start} onChange={(event) => setStart(event.target.value)} required className="flex-1" />
              <Input id="block-start-date" type="date" aria-label="시작 날짜" value={startDate} onChange={(event) => setStartDate(event.target.value)} required className="flex-1" />
            </div>
          </Field>
          <Field orientation="responsive">
            <FieldLabel htmlFor="block-end">종료</FieldLabel>
            <div className="flex w-full gap-2">
              <Input id="block-end" type="time" step={300} value={end} onChange={(event) => setEnd(event.target.value)} required className="flex-1" />
              <Input id="block-end-date" type="date" aria-label="종료 날짜" value={endDate} onChange={(event) => setEndDate(event.target.value)} required className="flex-1" />
            </div>
          </Field>
          <Field orientation="responsive">
            <FieldLabel htmlFor="block-type">종류</FieldLabel>
            <select
              id="block-type"
              value={type}
              onChange={(event) => setType(event.target.value as TimeBlock['type'])}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="study">공부</option>
              <option value="sleep">수면</option>
              <option value="rest">휴식</option>
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="block-label">메모</FieldLabel>
            <Input id="block-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="예: 재료역학" />
          </Field>
          {error && <p className="text-caption text-danger">{error}</p>}
        </FieldGroup>
      </form>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onDelete(block.id)}><Trash2 aria-hidden="true" /> 삭제</Button>
        <Button type="submit" form="time-block-form">저장</Button>
      </DialogFooter>
    </>
  );
}

function TimeBlockEditDialog({
  block,
  blocks,
  onOpenChange,
  onSave,
  onDelete,
}: {
  block: TimeBlock | null;
  blocks: TimeBlock[];
  onOpenChange: (open: boolean) => void;
  onSave: (id: number, segments: Omit<TimeBlock, 'id'>[]) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <Dialog open={block !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {block && <TimeBlockEditForm key={block.id} block={block} blocks={blocks} onSave={onSave} onDelete={onDelete} />}
      </DialogContent>
    </Dialog>
  );
}

const SEED_STUDY_TOPICS = ['재료역학', '기계열역학', '기계유체역학', '유압기기', '기출 풀이', '오답노트 정리'];
const REST_ACTIVITY_POOL = ['휴식', '게임', '친구들과 약속', '외식', '넷플릭스', '헬스장', '카페', 'PC방', '축구', '술자리'];
const roundToFiveMin = (hour: number) => Math.round(hour * 12) / 12;
const HOLIDAY_DATE = '2026-08-15'; // 광복절 — compensation-mindset slacking day
const FORCED_SLEEP_FROM_DATE = '2026-08-17';
const FORCED_SLEEP_TO_DATE = '2026-08-18'; // 11:10PM -> 7:00AM, an explicit pre-midnight example

// Deterministic PRNG (mulberry32) so the mock month looks organically noisy
// but is still reproducible on every load instead of reshuffling itself.
function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type SeedEvent = { hint: number; duration: number; meal?: string; study?: boolean };

function buildSeedBlocks(): TimeBlock[] {
  const rand = mulberry32(20260903);
  const randRange = (min: number, max: number) => min + rand() * (max - min);
  const chance = (probability: number) => rand() < probability;
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
  const shuffledIndices = (count: number) => {
    const list = Array.from({ length: count }, (_, index) => index);
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  };

  const start = new Date(2026, 7, 5); // 2026-08-05
  const end = new Date(2026, 8, 3); // 2026-09-03, about 30 days later
  const dayCount = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;

  const weekdayIndices = shuffledIndices(dayCount).filter((index) => {
    const d = new Date(start);
    d.setDate(d.getDate() + index);
    const weekday = d.getDay();
    return weekday !== 0 && weekday !== 6;
  });
  const allNighterDays = new Set(weekdayIndices.slice(0, 2)); // 10h+ cramming, barely sleeps
  const burnoutZeroDays = new Set(weekdayIndices.slice(2, 5)); // skips studying entirely

  // Which real Monday-start week each day falls in, so Mon->Fri "작심삼일" decay
  // and the one steady week line up with actual weekdays.
  const weekOfDay: number[] = [];
  {
    let weekIndex = -1;
    const weekCursor = new Date(start);
    for (let i = 0; i < dayCount; i += 1) {
      if (weekCursor.getDay() === 1) weekIndex += 1;
      weekOfDay.push(weekIndex);
      weekCursor.setDate(weekCursor.getDate() + 1);
    }
  }
  const totalWeeks = Math.max(...weekOfDay) + 1;
  const steadyWeekIndex = Math.min(2, totalWeeks - 1); // one week that doesn't decay Mon->Fri

  const allBlocks: Omit<TimeBlock, 'id'>[] = [];
  const cursor = new Date(start);
  let prevDate: string | null = null;
  let prevDayLastEnd = 0;

  for (let dayIndex = 0; dayIndex < dayCount; dayIndex += 1) {
    const date = isoDate(cursor);
    const weekday = cursor.getDay(); // 0 = Sun .. 6 = Sat
    const isWeekend = weekday === 0 || weekday === 6;
    const dayBlocks: Omit<TimeBlock, 'id'>[] = [];

    // Appends a block after whatever's already been placed today, so random
    // durations never overlap no matter how they're combined.
    const place = (startHint: number, duration: number, type: BlockType, label: string) => {
      const prevEnd = dayBlocks.length ? dayBlocks[dayBlocks.length - 1].end + 0.1 : 0;
      const blockStart = roundToFiveMin(Math.max(startHint, prevEnd));
      const blockEnd = roundToFiveMin(Math.min(24, blockStart + duration));
      if (blockEnd <= blockStart) return;
      dayBlocks.push({ date, start: blockStart, end: blockEnd, type, label });
    };

    if (date === HOLIDAY_DATE) {
      // Public holiday: compensation-mindset slacking — barely logs anything, no study.
      place(13, 1, 'rest', '점심');
      place(19.5, 3.5, 'rest', '게임');
    } else if (allNighterDays.has(dayIndex)) {
      // All-night cramming binge: 13+ hours of study, only a short nap.
      place(0.5, 5.5, 'study', '벼락치기');
      if (chance(0.6)) place(6.25, 0.5, 'rest', '아침');
      place(7, 6, 'study', '벼락치기');
      if (chance(0.6)) place(13.25, 0.5, 'rest', '점심');
      place(14, 2, 'sleep', '쪽잠');
      if (chance(0.6)) place(17.5, 0.5, 'rest', '저녁');
      place(19, 2, 'study', '벼락치기');
    } else if (burnoutZeroDays.has(dayIndex)) {
      // Burnout: no study at all, oversleeps to recover.
      place(randRange(0.5, 2), randRange(9, 11), 'sleep', '수면');
      if (chance(0.5)) place(11.5, 0.5, 'rest', '아침');
      place(13, randRange(2.5, 4.5), 'rest', pick(REST_ACTIVITY_POOL));
      if (chance(0.6)) place(19, 0.5, 'rest', '저녁');
    } else {
      const mondayOffset = weekday - 1; // Mon=0 .. Fri=4
      const isSteadyWeek = weekOfDay[dayIndex] === steadyWeekIndex;

      const pickWakeHour = () => {
        if (isWeekend) {
          const lateStart = chance(0.45);
          return lateStart ? randRange(10.5, 14.5) : randRange(8, 10.5);
        }
        const base = isSteadyWeek ? randRange(7.3, 8.3) : 6.8 + mondayOffset * 0.9 + randRange(-0.3, 0.5);
        return Math.max(6, Math.min(12, base));
      };

      // Last night's sleep: sometimes a pre-midnight bedtime split across two
      // dates (tail block tonight, head block tomorrow), sometimes a single
      // post-midnight block — not always "went to bed after 12".
      const forcedSleep = prevDate === FORCED_SLEEP_FROM_DATE && date === FORCED_SLEEP_TO_DATE;
      const canPreMidnight = prevDayLastEnd < 23.4 && prevDate !== null && prevDate !== HOLIDAY_DATE;
      let wakeHour: number;

      if (forcedSleep) {
        const bedtime = roundToFiveMin(Math.max(23 + 10 / 60, prevDayLastEnd + 0.15));
        allBlocks.push({ date: prevDate as string, start: bedtime, end: 24, type: 'sleep', label: '수면' });
        wakeHour = 7;
        place(0, wakeHour, 'sleep', '수면');
      } else if (canPreMidnight && chance(0.6)) {
        const bedtime = roundToFiveMin(Math.max(prevDayLastEnd + 0.3, randRange(21.5, 23.75)));
        if (bedtime < 23.9) {
          allBlocks.push({ date: prevDate as string, start: bedtime, end: 24, type: 'sleep', label: '수면' });
          wakeHour = pickWakeHour();
          place(0, wakeHour, 'sleep', '수면');
        } else {
          wakeHour = pickWakeHour();
          const shortSleep = chance(0.15);
          const longSleep = !shortSleep && chance(0.15);
          const sleepDuration = shortSleep ? randRange(4, 5.5) : longSleep ? randRange(9, 10.5) : randRange(6, 8);
          const sleepStart = Math.max(0, wakeHour - sleepDuration);
          place(sleepStart, wakeHour - sleepStart, 'sleep', '수면');
        }
      } else {
        wakeHour = pickWakeHour();
        const shortSleep = chance(0.15);
        const longSleep = !shortSleep && chance(0.15);
        const sleepDuration = shortSleep ? randRange(4, 5.5) : longSleep ? randRange(9, 10.5) : randRange(6, 8);
        const sleepStart = Math.max(0, wakeHour - sleepDuration);
        place(sleepStart, wakeHour - sleepStart, 'sleep', '수면');
      }

      // How "on track" today is — decays Mon->Fri in a decaying week, flat in
      // the steady week, plus occasional wildcard drive/slump days.
      let studyWeight = isWeekend
        ? randRange(0.15, 0.45)
        : isSteadyWeek
          ? randRange(0.62, 0.82)
          : Math.max(0.2, randRange(0.65, 0.85) - mondayOffset * 0.1);
      if (chance(0.08)) studyWeight = randRange(0.8, 0.95);
      else if (chance(0.1)) studyWeight = randRange(0.05, 0.15);

      // Each candidate slot independently may or may not happen, and — aside
      // from meals — independently rolls study vs. rest, so the order and
      // makeup of the day varies instead of following a fixed template.
      const isForcedSleepEve = date === FORCED_SLEEP_FROM_DATE;
      const events: SeedEvent[] = [];
      if (chance(0.5)) events.push({ hint: wakeHour + randRange(0.1, 0.5), duration: 0.5, meal: '아침' });
      if (chance(0.8)) events.push({ hint: wakeHour + randRange(0.4, 1.6), duration: randRange(1, 3), study: chance(studyWeight) });
      if (chance(0.78)) events.push({ hint: randRange(12, 13.3), duration: randRange(0.5, 1), meal: '점심' });
      if (chance(0.55)) events.push({ hint: randRange(13.3, 14.3), duration: randRange(0.5, 2), study: chance(studyWeight) });
      if (chance(0.75)) events.push({ hint: randRange(14.5, 17.5), duration: randRange(1.5, 3.5), study: chance(studyWeight) });
      if (chance(0.75)) events.push({ hint: randRange(18, 19.3), duration: randRange(0.5, 1), meal: '저녁' });
      if (chance(0.7)) {
        const hint = randRange(19.5, 21.5);
        const duration = isForcedSleepEve ? Math.min(randRange(0.5, 2.5), Math.max(0.25, 22.8 - hint)) : randRange(0.5, 2.5);
        events.push({ hint, duration, study: chance(studyWeight) });
      }
      if (!isForcedSleepEve && studyWeight > 0.4 && chance(0.25)) events.push({ hint: randRange(21.5, 23), duration: randRange(1, 2.5), study: true });

      // Keeps ordinary weekdays from accidentally going fully study-free —
      // that's reserved for the explicit burnout days and low-energy rolls.
      if (!isWeekend && studyWeight > 0.2 && !events.some((e) => e.study)) {
        events.push({ hint: randRange(15, 19), duration: randRange(1, 2.5), study: true });
      }

      events.sort((a, b) => a.hint - b.hint);
      for (const ev of events) {
        if (ev.meal) place(ev.hint, ev.duration, 'rest', ev.meal);
        else if (ev.study) place(ev.hint, ev.duration, 'study', pick(SEED_STUDY_TOPICS));
        else place(ev.hint, ev.duration, 'rest', pick(REST_ACTIVITY_POOL));
      }
    }

    allBlocks.push(...dayBlocks);
    prevDate = date;
    prevDayLastEnd = dayBlocks.length ? dayBlocks[dayBlocks.length - 1].end : 0;
    cursor.setDate(cursor.getDate() + 1);
  }

  return allBlocks.map((block, index) => ({ ...block, id: index + 1 }));
}

const DEFAULT_BLOCKS: TimeBlock[] = buildSeedBlocks();
const blocksStorageKey = (accountKey: string) => `goalsetter:${accountKey}:blocks`;
const analysisStorageKey = (accountKey: string) => `goalsetter:${accountKey}:analysis`;

function TimeBlockCreateForm({
  defaultDate,
  blocks,
  onCreate,
}: {
  defaultDate: string;
  blocks: TimeBlock[];
  onCreate: (block: Omit<TimeBlock, 'id'>) => void;
}) {
  const [date, setDate] = useState(defaultDate);
  const [type, setType] = useState<TimeBlock['type']>('study');
  const [label, setLabel] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [error, setError] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const startHour = timeValueToHour(start);
    const endHour = timeValueToHour(end);
    if (endHour <= startHour) { setError('종료 시간은 시작 시간보다 늦어야 해요.'); return; }
    if (hasOverlap(blocks, date, startHour, endHour)) { setError('이미 등록된 시간과 겹쳐요.'); return; }
    onCreate({ date, start: startHour, end: endHour, type, label: label.trim() || BLOCK_TYPE_LABEL[type] });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>시간 기록 추가</DialogTitle>
        <DialogDescription>날짜와 시간을 5분 단위로 골라 새 기록을 추가할 수 있어요.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} id="time-block-create-form">
        <FieldGroup>
          <Field orientation="responsive">
            <FieldLabel htmlFor="new-block-date">날짜</FieldLabel>
            <Input id="new-block-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
          </Field>
          <Field orientation="responsive">
            <FieldLabel htmlFor="new-block-start">시작</FieldLabel>
            <Input id="new-block-start" type="time" step={300} value={start} onChange={(event) => setStart(event.target.value)} required />
          </Field>
          <Field orientation="responsive">
            <FieldLabel htmlFor="new-block-end">종료</FieldLabel>
            <Input id="new-block-end" type="time" step={300} value={end} onChange={(event) => setEnd(event.target.value)} required />
          </Field>
          <Field orientation="responsive">
            <FieldLabel htmlFor="new-block-type">종류</FieldLabel>
            <select
              id="new-block-type"
              value={type}
              onChange={(event) => setType(event.target.value as TimeBlock['type'])}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="study">공부</option>
              <option value="sleep">수면</option>
              <option value="rest">휴식</option>
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="new-block-label">메모</FieldLabel>
            <Input id="new-block-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="예: 재료역학" />
          </Field>
          {error && <p className="text-caption text-danger">{error}</p>}
        </FieldGroup>
      </form>
      <DialogFooter>
        <Button type="submit" form="time-block-create-form">추가</Button>
      </DialogFooter>
    </>
  );
}

function TimeBlockCreateDialog({
  open,
  sessionId,
  defaultDate,
  blocks,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  sessionId: number;
  defaultDate: string;
  blocks: TimeBlock[];
  onOpenChange: (open: boolean) => void;
  onCreate: (block: Omit<TimeBlock, 'id'>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && <TimeBlockCreateForm key={sessionId} defaultDate={defaultDate} blocks={blocks} onCreate={onCreate} />}
      </DialogContent>
    </Dialog>
  );
}

function CalendarTab({ accountKey }: { accountKey: string }) {
  const today = useMemo(() => new Date(2026, 8, 3), []);
  const [month, setMonth] = useState(new Date(2026, 8, 3));
  const [view, setView] = useState<CalendarView>('month');
  const [prompt, setPrompt] = useState(''); const [message, setMessage] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [createSessionId, setCreateSessionId] = useState(0);
  const [undoSnapshot, setUndoSnapshot] = useState<TimeBlock[] | null>(null);
  const [voiceMessage, setVoiceMessage] = useState('');
  const [blocks, setBlocks] = useState<TimeBlock[]>(() => loadJSON(blocksStorageKey(accountKey), DEFAULT_BLOCKS));
  useEffect(() => { saveJSON(blocksStorageKey(accountKey), blocks); }, [accountKey, blocks]);
  const step = view === 'month' ? 1 : view === 'quarter' ? 3 : 12;
  const shiftMonth = (amount: number) => setMonth((previous) => new Date(previous.getFullYear(), previous.getMonth() + amount * step, 1));
  const quarterStart = Math.floor(month.getMonth() / 3) * 3;
  const visibleMonths = view === 'month'
    ? [month]
    : view === 'quarter'
      ? Array.from({ length: 3 }, (_, index) => new Date(month.getFullYear(), quarterStart + index, 1))
      : Array.from({ length: 12 }, (_, index) => new Date(month.getFullYear(), index, 1));
  const heading = view === 'month'
    ? `${month.getFullYear()}년 ${MONTHS[month.getMonth()]}`
    : view === 'quarter'
      ? `${month.getFullYear()}년 ${Math.floor(month.getMonth() / 3) + 1}분기`
      : `${month.getFullYear()}년 연력`;
  const addNaturalEntry = (event: FormEvent) => {
    event.preventDefault(); const parsed = parseNaturalEntry(prompt, today);
    if (!parsed) { setMessage('시간 두 개를 포함해 적어주세요. 예: 오늘 19:00~22:00 공부'); return; }
    if (parsed.some((entry) => hasOverlap(blocks, entry.date, entry.start, entry.end))) {
      setMessage('이미 등록된 시간과 겹쳐서 추가하지 못했어요.');
      return;
    }
    setUndoSnapshot(null);
    const baseId = Date.now();
    const newEntries: TimeBlock[] = parsed.map((entry, index) => ({ ...entry, id: baseId + index }));
    setBlocks((previous) => [...previous, ...newEntries]);
    setPrompt('');
    setMessage(
      parsed.length > 1
        ? `${parsed[0].label} ${formatHour(parsed[0].start)}–자정을 넘어 ${formatHour(parsed[1].end)}까지 기록을 추가했어요.`
        : `${parsed[0].label} ${formatHour(parsed[0].start)}–${formatHour(parsed[0].end)} 기록을 추가했어요.`,
    );
  };
  const editingBlock = blocks.find((block) => block.id === editingId) ?? null;
  const updateBlock = (id: number, segments: Omit<TimeBlock, 'id'>[]) => {
    setUndoSnapshot(null);
    const baseId = Date.now();
    setBlocks((previous) => [
      ...previous.filter((block) => block.id !== id),
      ...segments.map((segment, index) => ({ ...segment, id: index === 0 ? id : baseId + index })),
    ]);
    setEditingId(null);
  };
  const deleteBlock = (id: number) => {
    setUndoSnapshot(null);
    setBlocks((previous) => previous.filter((block) => block.id !== id));
    setEditingId(null);
  };
  const openCreate = () => { setCreateSessionId((previous) => previous + 1); setCreating(true); };
  const createBlock = (block: Omit<TimeBlock, 'id'>) => {
    setUndoSnapshot(null);
    setBlocks((previous) => [...previous, { ...block, id: Date.now() }]);
    setCreating(false);
  };
  const applyVoiceSchedule = (result: ScheduleVoiceResult) => {
    if (result.segments.length === 0) {
      setVoiceMessage('인식된 시간 기록이 없어요. 다시 말씀해주세요.');
      return;
    }
    const baseId = Date.now();
    const date = isoDate(today);
    const newBlocks: TimeBlock[] = [];
    let skipped = 0;
    result.segments.forEach((segment, index) => {
      const start = timeValueToHour(segment.start);
      const end = timeValueToHour(segment.end);
      if (hasOverlap(blocks, date, start, end) || hasOverlap(newBlocks, date, start, end)) {
        skipped += 1;
        return;
      }
      newBlocks.push({ id: baseId + index, date, start, end, type: segment.type, label: segment.label });
    });
    if (newBlocks.length === 0) {
      setVoiceMessage('이미 등록된 시간과 겹쳐서 추가하지 못했어요.');
      return;
    }
    setUndoSnapshot(blocks);
    setBlocks((previous) => [...previous, ...newBlocks]);
    setVoiceMessage(
      skipped > 0
        ? `${newBlocks.length}개 기록을 추가했어요. (겹치는 ${skipped}개는 건너뛰었어요)`
        : `${newBlocks.length}개 기록을 추가했어요.`,
    );
  };
  const { status: voiceStatus, errorMessage: voiceError, start: startVoiceRaw, stop: stopVoice } = useVoiceScheduleCapture(applyVoiceSchedule);
  const startVoice = () => { setVoiceMessage(''); startVoiceRaw(); };
  const undoVoiceSchedule = () => {
    if (!undoSnapshot) return;
    setBlocks(undoSnapshot);
    setUndoSnapshot(null);
    setVoiceMessage('방금 추가한 기록을 취소했어요.');
  };
  return (
    <section className="calendar-shell" aria-labelledby="calendar-heading">
      <div className="calendar-toolbar">
        <div><span className="eyebrow">TIME MARKER</span><h1 id="calendar-heading">{heading}</h1></div>
        <div className="calendar-actions">
          <div className="view-switch" role="group" aria-label="달력 보기 방식">
            {([['month', '월력'], ['quarter', '분기력'], ['year', '연력']] as const).map(([value, label]) => <Button key={value} size="sm" variant={view === value ? 'secondary' : 'ghost'} onClick={() => setView(value)} aria-pressed={view === value}>{label}</Button>)}
          </div>
          <div className="calendar-controls"><Button variant="outline" size="icon" aria-label="이전 기간" onClick={() => shiftMonth(-1)}><ChevronLeft /></Button><Button variant="outline" onClick={() => setMonth(new Date(2026, 8, 3))}>오늘</Button><Button variant="outline" size="icon" aria-label="다음 기간" onClick={() => shiftMonth(1)}><ChevronRight /></Button></div>
        </div>
        <div className="calendar-legend" aria-label="시간 기록 범례"><span><i className="legend-dot sleep" />수면</span><span><i className="legend-dot study" />공부</span><span><i className="legend-dot rest" />휴식</span><Button size="icon" variant="outline" aria-label="새 시간 기록 추가" onClick={openCreate}><Plus aria-hidden="true" /></Button></div>
      </div>
      {view === 'month' ? <TimeMonthGrid month={month} blocks={blocks} today={today} variant="month" onBlockClick={setEditingId} /> : view === 'quarter' ? (
        <div className={`multi-calendar multi-calendar--${view}`}>
          {visibleMonths.map((visibleMonth) => <section className="mini-month" key={`${visibleMonth.getFullYear()}-${visibleMonth.getMonth()}`}><h2>{MONTHS[visibleMonth.getMonth()]}</h2><TimeMonthGrid month={visibleMonth} blocks={blocks} today={today} variant={view} onBlockClick={setEditingId} /></section>)}
        </div>
      ) : <YearMatrix year={month.getFullYear()} blocks={blocks} today={today} />}
      <form className="command-bar" onSubmit={addNaturalEntry}><div className="command-icon"><Sparkles aria-hidden="true" /></div><label htmlFor="natural-entry" className="sr-only">자연어로 시간 기록 추가</label><input id="natural-entry" value={prompt} onChange={(event) => { setPrompt(event.target.value); setMessage(''); }} placeholder="예: 오늘 03:00부터 08:00까지 잤어" /><span className="command-hint">자연어로 기록</span><Button type="submit" size="icon" aria-label="시간 기록 추가"><Send /></Button><output className="command-message" aria-live="polite">{message}</output></form>
      <TimeBlockEditDialog block={editingBlock} blocks={blocks} onOpenChange={(open) => !open && setEditingId(null)} onSave={updateBlock} onDelete={deleteBlock} />
      <TimeBlockCreateDialog open={creating} sessionId={createSessionId} defaultDate={isoDate(today)} blocks={blocks} onOpenChange={setCreating} onCreate={createBlock} />
      {(voiceStatus === 'recording' || voiceStatus === 'processing' || voiceError || voiceMessage) && (
        <div className="voice-fab-status" role="status" aria-live="polite">
          {voiceStatus === 'recording' && '오늘 한 일을 말해주세요. 다 되면 버튼을 다시 눌러 정지하세요.'}
          {voiceStatus === 'processing' && '인식 중...'}
          {voiceStatus !== 'recording' && voiceStatus !== 'processing' && voiceError && <span className="text-danger">{voiceError}</span>}
          {voiceStatus !== 'recording' && voiceStatus !== 'processing' && !voiceError && voiceMessage && (
            <span className="flex items-center gap-2">
              {voiceMessage}
              {undoSnapshot && <button type="button" className="underline underline-offset-2" onClick={undoVoiceSchedule}>실행 취소</button>}
            </span>
          )}
        </div>
      )}
      <button
        type="button"
        className={`voice-fab ${voiceStatus === 'recording' ? 'recording' : ''}`}
        aria-label={voiceStatus === 'recording' ? '녹음 중지' : '음성으로 오늘 기록하기'}
        disabled={voiceStatus === 'processing'}
        onClick={voiceStatus === 'recording' ? stopVoice : startVoice}
      >
        {voiceStatus === 'recording' ? <Square aria-hidden="true" /> : <Mic aria-hidden="true" />}
      </button>
    </section>
  );
}

type DayUsage = {
  date: string;
  sleepMinutes: number;
  mealMinutes: number;
  restMinutes: number;
  studyMinutes: number;
  studyStartMinutes: number | null;
};
const MEAL_KEYWORDS = /식사|밥|점심|아침|저녁|브런치|meal/i;

function buildDayUsage(blocks: TimeBlock[]): DayUsage[] {
  const byDate = new Map<string, TimeBlock[]>();
  blocks.forEach((block) => {
    const list = byDate.get(block.date) ?? [];
    list.push(block);
    byDate.set(block.date, list);
  });
  return Array.from(byDate.entries())
    .map(([date, dayBlocks]) => {
      let sleepMinutes = 0;
      let mealMinutes = 0;
      let restMinutes = 0;
      let studyMinutes = 0;
      let studyStart: number | null = null;
      dayBlocks.forEach((block) => {
        const minutes = (block.end - block.start) * 60;
        if (block.type === 'sleep') sleepMinutes += minutes;
        else if (block.type === 'study') {
          studyMinutes += minutes;
          if (studyStart === null || block.start < studyStart) studyStart = block.start;
        } else if (MEAL_KEYWORDS.test(block.label)) mealMinutes += minutes;
        else restMinutes += minutes;
      });
      return {
        date,
        sleepMinutes,
        mealMinutes,
        restMinutes,
        studyMinutes,
        studyStartMinutes: studyStart === null ? null : Math.round(studyStart * 60),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

type InsightCategory = 'sleep' | 'meal' | 'rest' | 'study' | 'schedule';
type Insight = { category: InsightCategory; observation: string; suggestion: string };
type OptimizeResult = { insights: Insight[]; plan: string[]; expectedGainMinutes: number };

const INSIGHT_CATEGORY_META: Record<InsightCategory, { label: string; icon: LucideIcon; color: string; tint: string }> = {
  sleep: { label: '수면', icon: Moon, color: '#5b6b93', tint: 'rgba(91,107,147,.14)' },
  meal: { label: '식사', icon: Coffee, color: '#b8791f', tint: 'rgba(217,164,65,.18)' },
  rest: { label: '휴식', icon: Wind, color: '#6b7280', tint: 'rgba(107,114,128,.14)' },
  study: { label: '공부', icon: Target, color: '#3f7a56', tint: 'rgba(85,145,105,.16)' },
  schedule: { label: '일정', icon: Clock3, color: '#6d28d9', tint: 'rgba(124,58,237,.14)' },
};

const addDays = (date: Date, amount: number) => { const next = new Date(date); next.setDate(next.getDate() + amount); return next; };
const addMonths = (date: Date, amount: number) => { const next = new Date(date); next.setMonth(next.getMonth() + amount); return next; };
const startOfWeekMonday = (date: Date) => { const day = date.getDay(); return addDays(date, day === 0 ? -6 : 1 - day); };
const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const endOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0);
const startOfQuarter = (date: Date) => new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
const endOfQuarter = (date: Date) => new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3 + 3, 0);
const formatShortDateKo = (iso: string) => { const [year, month, day] = iso.split('-').map(Number); return `${String(year).slice(2)}.${month}.${day}`; };

type RangeSelection = { start: string; end: string; label: string };
type RangePreset = { key: string; buttonLabel: string; selection: RangeSelection };

function buildRangePresets(today: Date): RangePreset[] {
  const monday = startOfWeekMonday(today);
  return [
    { key: 'week', buttonLabel: '이번 주', selection: { start: isoDate(monday), end: isoDate(addDays(monday, 6)), label: '이번 주의 분석' } },
    { key: 'month', buttonLabel: '이번 달', selection: { start: isoDate(startOfMonth(today)), end: isoDate(endOfMonth(today)), label: '이번 달의 분석' } },
    { key: 'quarter', buttonLabel: '이번 분기', selection: { start: isoDate(startOfQuarter(today)), end: isoDate(endOfQuarter(today)), label: '이번 분기의 분석' } },
    { key: 'last7', buttonLabel: '최근 7일', selection: { start: isoDate(addDays(today, -6)), end: isoDate(today), label: '7일 간의 분석' } },
    { key: 'last30', buttonLabel: '최근 한 달', selection: { start: isoDate(addMonths(today, -1)), end: isoDate(today), label: '한 달 간의 분석' } },
    { key: 'last90', buttonLabel: '최근 3개월', selection: { start: isoDate(addMonths(today, -3)), end: isoDate(today), label: '3개월 간의 분석' } },
  ];
}

type PersistedAnalysis = { result: OptimizeResult; rangeLabel: string };

function AnalysisTab({ accountKey }: { accountKey: string }) {
  const [blocks] = useState<TimeBlock[]>(() => loadJSON(blocksStorageKey(accountKey), DEFAULT_BLOCKS));
  const today = useMemo(() => new Date(2026, 8, 3), []);
  const rangePresets = useMemo(() => buildRangePresets(today), [today]);

  const [rangeKey, setRangeKey] = useState('all');
  const [customRange, setCustomRange] = useState<RangeSelection | null>(null);
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [customStartInput, setCustomStartInput] = useState('');
  const [customEndInput, setCustomEndInput] = useState('');
  const [customError, setCustomError] = useState('');

  const activeSelection: RangeSelection | null = useMemo(() => {
    if (rangeKey === 'custom') return customRange;
    return rangePresets.find((preset) => preset.key === rangeKey)?.selection ?? null;
  }, [rangeKey, customRange, rangePresets]);

  const openCustomDialog = () => {
    setCustomStartInput(customRange?.start ?? isoDate(addDays(today, -6)));
    setCustomEndInput(customRange?.end ?? isoDate(today));
    setCustomError('');
    setCustomDialogOpen(true);
  };
  const applyCustomRange = (event: FormEvent) => {
    event.preventDefault();
    if (!customStartInput || !customEndInput) { setCustomError('시작과 종료 날짜를 모두 선택해주세요.'); return; }
    if (customEndInput < customStartInput) { setCustomError('종료 날짜는 시작 날짜보다 늦어야 해요.'); return; }
    setCustomRange({
      start: customStartInput,
      end: customEndInput,
      label: `${formatShortDateKo(customStartInput)}부터 ${formatShortDateKo(customEndInput)}까지의 분석`,
    });
    setRangeKey('custom');
    setCustomDialogOpen(false);
  };

  const filteredBlocks = useMemo(() => {
    if (!activeSelection) return blocks;
    return blocks.filter((block) => block.date >= activeSelection.start && block.date <= activeSelection.end);
  }, [blocks, activeSelection]);
  const days = useMemo(() => buildDayUsage(filteredBlocks), [filteredBlocks]);
  const hasNoDataInRange = activeSelection !== null && days.length === 0;
  const summary = useMemo(() => {
    const startDays = days.filter((day) => day.studyStartMinutes !== null);
    return {
      sleepMinutes: average(days.filter((day) => day.sleepMinutes > 0).map((day) => day.sleepMinutes)),
      mealMinutes: average(days.filter((day) => day.mealMinutes > 0).map((day) => day.mealMinutes)),
      restMinutes: average(days.filter((day) => day.restMinutes > 0).map((day) => day.restMinutes)),
      studyMinutes: average(days.filter((day) => day.studyMinutes > 0).map((day) => day.studyMinutes)),
      studyStartMinutes: startDays.length ? average(startDays.map((day) => day.studyStartMinutes as number)) : null,
      dayCount: days.length,
    };
  }, [days]);

  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState<PersistedAnalysis | null>(() => loadJSON(analysisStorageKey(accountKey), null));
  useEffect(() => { saveJSON(analysisStorageKey(accountKey), analysis); }, [accountKey, analysis]);

  const requestOptimization = async () => {
    setStatus('loading');
    setError('');
    try {
      const response = await fetch('/api/analysis/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary, days }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '분석 요청에 실패했어요.');
      setAnalysis({ result: data as OptimizeResult, rangeLabel: activeSelection ? activeSelection.label : '전체 기간의 분석' });
      setStatus('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : '분석 요청에 실패했어요.');
      setStatus('error');
    }
  };

  const stats: { key: string; label: string; value: string; empty: boolean; icon: LucideIcon; color: string; tint: string }[] = [
    { key: 'sleep', label: '평균 수면 시간', value: summary.sleepMinutes > 0 ? formatMinutesKo(summary.sleepMinutes) : '기록 없음', empty: summary.sleepMinutes <= 0, icon: Moon, color: '#5b6b93', tint: 'rgba(91,107,147,.14)' },
    { key: 'meal', label: '평균 식사 시간', value: summary.mealMinutes > 0 ? formatMinutesKo(summary.mealMinutes) : '기록 없음', empty: summary.mealMinutes <= 0, icon: Utensils, color: '#b8791f', tint: 'rgba(217,164,65,.18)' },
    { key: 'rest', label: '평균 휴식 시간', value: summary.restMinutes > 0 ? formatMinutesKo(summary.restMinutes) : '기록 없음', empty: summary.restMinutes <= 0, icon: Coffee, color: '#6b7280', tint: 'rgba(107,114,128,.14)' },
    { key: 'study', label: '평균 공부 시간', value: summary.studyMinutes > 0 ? formatMinutesKo(summary.studyMinutes) : '기록 없음', empty: summary.studyMinutes <= 0, icon: BookOpen, color: '#3f7a56', tint: 'rgba(85,145,105,.16)' },
    { key: 'start', label: '평균 공부 시작 시각', value: summary.studyStartMinutes !== null ? formatClockKo(summary.studyStartMinutes) : '기록 없음', empty: summary.studyStartMinutes === null, icon: Clock3, color: '#6d28d9', tint: 'rgba(124,58,237,.14)' },
    { key: 'days', label: '분석 대상 일수', value: `${summary.dayCount}일`, empty: summary.dayCount === 0, icon: CalendarDays, color: '#8a7a5c', tint: 'rgba(154,142,110,.16)' },
  ];

  return (
    <div className="planner-grid">
      <section className="goal-editor" aria-labelledby="analysis-heading">
        <div className="section-kicker"><Brain aria-hidden="true" /> AI 분석</div>
        <h1 id="analysis-heading">쌓인 기록으로, 다음 계획을 더 똑똑하게.</h1>
        <p className="section-copy">타임 캘린더에 쌓인 수면·식사·휴식·공부 기록을 바탕으로 AI가 공부 시간을 늘릴 수 있는 개선 방안을 제안해요.</p>
        <div className="range-picker" role="group" aria-label="분석 기간 선택">
          <button type="button" className={rangeKey === 'all' ? 'range-chip is-active' : 'range-chip'} onClick={() => setRangeKey('all')}>전체</button>
          {rangePresets.map((preset) => (
            <button
              type="button"
              key={preset.key}
              className={rangeKey === preset.key ? 'range-chip is-active' : 'range-chip'}
              onClick={() => setRangeKey(preset.key)}
            >
              {preset.buttonLabel}
            </button>
          ))}
          <button type="button" className={rangeKey === 'custom' ? 'range-chip is-active' : 'range-chip'} onClick={openCustomDialog}>
            <CalendarRange aria-hidden="true" /> 직접 설정
          </button>
        </div>
        {activeSelection && <p className="range-picker-caption">선택한 기간: {activeSelection.label}</p>}
        <div className="stat-grid">
          {stats.map((stat) => {
            const StatIcon = stat.icon;
            return (
              <div className="stat-tile" key={stat.key} style={{ '--stat-color': stat.color, '--stat-tint': stat.tint } as CSSProperties}>
                <div className="stat-tile-head">
                  <span className="stat-icon"><StatIcon aria-hidden="true" /></span>
                  <span className="stat-label">{stat.label}</span>
                </div>
                <div className={stat.empty ? 'stat-value is-empty' : 'stat-value'}>{stat.value}</div>
              </div>
            );
          })}
        </div>
        {hasNoDataInRange ? (
          <p className="text-caption text-danger">선택한 기간에는 시간 기록이 없어요. 다른 기간을 선택해보세요.</p>
        ) : summary.dayCount < 3 ? (
          <p className="text-caption text-muted-foreground">타임 캘린더에 최소 3일 이상 기록을 남기면 더 정확한 분석을 받을 수 있어요.</p>
        ) : null}
        <div className="form-footer">
          <span className={error ? 'save-note is-visible text-danger' : 'save-note'}>{error}</span>
          <Button type="button" size="lg" className="save-goal" disabled={status === 'loading' || days.length === 0} onClick={requestOptimization}>
            {status === 'loading' ? '분석 중...' : <>{analysis ? '다시 분석 요청하기' : 'AI 최적화 방안 요청하기'} <Sparkles aria-hidden="true" /></>}
          </Button>
        </div>
      </section>
      <Dialog open={customDialogOpen} onOpenChange={setCustomDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>분석 기간 직접 설정</DialogTitle>
            <DialogDescription>시작 날짜와 종료 날짜를 골라 그 기간의 기록만 분석해요.</DialogDescription>
          </DialogHeader>
          <form onSubmit={applyCustomRange} id="custom-range-form">
            <FieldGroup>
              <Field orientation="responsive">
                <FieldLabel htmlFor="range-start">시작 날짜</FieldLabel>
                <Input id="range-start" type="date" value={customStartInput} onChange={(event) => setCustomStartInput(event.target.value)} required />
              </Field>
              <Field orientation="responsive">
                <FieldLabel htmlFor="range-end">종료 날짜</FieldLabel>
                <Input id="range-end" type="date" value={customEndInput} onChange={(event) => setCustomEndInput(event.target.value)} required />
              </Field>
              {customError && <p className="text-caption text-danger">{customError}</p>}
            </FieldGroup>
          </form>
          <DialogFooter>
            <Button type="submit" form="custom-range-form">적용</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <aside className="goal-list" aria-label="AI 제안">
        <div className="goal-list-heading">
          <div><span className="eyebrow">AI SUGGESTIONS</span><h2>{analysis ? analysis.rangeLabel : '제안 & 개선 계획'}</h2></div>
          {analysis && analysis.result.insights.length > 0 && <span className="goal-count">{analysis.result.insights.length}</span>}
        </div>
        {!analysis && status !== 'loading' && <p className="analysis-empty">아직 요청한 분석이 없어요. 왼쪽에서 최적화 방안을 요청해보세요.</p>}
        {status === 'loading' && <p className="analysis-empty">기록을 분석하고 있어요...</p>}
        {analysis && (
          <>
            {analysis.result.expectedGainMinutes > 0 ? (
              <div className="result-badge gain">
                <TrendingUp aria-hidden="true" />
                <span>예상 추가 공부 시간</span>
                <strong>+{formatMinutesKo(analysis.result.expectedGainMinutes)}</strong>
              </div>
            ) : (
              <div className="result-badge steady">
                <Check aria-hidden="true" />
                <span>이미 효율적인 습관을 유지하고 있어요</span>
              </div>
            )}
            {analysis.result.insights.map((insight, index) => {
              const meta = INSIGHT_CATEGORY_META[insight.category] ?? INSIGHT_CATEGORY_META.schedule;
              const CategoryIcon = meta.icon;
              return (
                <article
                  className="insight-card"
                  key={index}
                  style={{ '--cat-color': meta.color, '--cat-tint': meta.tint } as CSSProperties}
                >
                  <div className="insight-card-head">
                    <span className="insight-icon"><CategoryIcon aria-hidden="true" /></span>
                    <span className="insight-tag">{meta.label}</span>
                  </div>
                  <p className="insight-observation">{insight.observation}</p>
                  <p className="insight-suggestion"><ArrowRight aria-hidden="true" />{insight.suggestion}</p>
                </article>
              );
            })}
            {analysis.result.plan.length > 0 && (
              <div className="plan-panel">
                <div className="section-kicker"><ListChecks aria-hidden="true" /> 오늘의 액션 아이템</div>
                <ul className="plan-checklist">
                  {analysis.result.plan.map((item, index) => (
                    <li key={index}><span className="plan-checkbox" aria-hidden="true" />{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

const noopSubscribe = () => () => {};
const getServerAuthSnapshot = () => false;

function AuthButton() {
  const loggedIn = useSyncExternalStore(noopSubscribe, isAuthenticated, getServerAuthSnapshot);
  return loggedIn ? (
    <Button asChild className="quick-add" size="lg" variant="outline"><a href="/auth/logout"><LogOut aria-hidden="true" /> 로그아웃</a></Button>
  ) : (
    <Button asChild className="quick-add" size="lg"><Link href="/login"><LogIn aria-hidden="true" /> 로그인</Link></Button>
  );
}

export default function Home() {
  const accountKey = useSyncExternalStore(noopSubscribe, getAccountKey, getServerAccountKey);
  return <main className="app-shell"><Tabs defaultValue="planner" className="app-tabs"><header className="topbar"><a href="#" className="brand" aria-label="Goalsetter 홈"><span className="brand-mark"><Clock3 aria-hidden="true" /></span><span>Goalsetter</span></a><TabsList className="main-nav" aria-label="주요 메뉴"><TabsTrigger value="planner"><Target aria-hidden="true" />목표 계획</TabsTrigger><TabsTrigger value="calendar"><CalendarDays aria-hidden="true" />타임 캘린더</TabsTrigger><TabsTrigger value="analysis"><Brain aria-hidden="true" />AI 분석</TabsTrigger></TabsList><AuthButton /></header><div className="content-wrap"><TabsContent value="planner"><PlannerTab key={accountKey} accountKey={accountKey} /></TabsContent><TabsContent value="calendar"><CalendarTab key={accountKey} accountKey={accountKey} /></TabsContent><TabsContent value="analysis"><AnalysisTab key={accountKey} accountKey={accountKey} /></TabsContent></div></Tabs></main>;
}