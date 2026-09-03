'use client';

import {
  type CSSProperties,
  type Dispatch,
  FormEvent,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  Brain,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Coffee,
  ListChecks,
  LogIn,
  LogOut,
  Mic,
  Moon,
  Paintbrush,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Square,
  Target,
  Trash2,
  TrendingUp,
  Utensils,
  Wind,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { getAccountKey, getServerAccountKey, isAuthenticated } from '@/lib/auth';
import { loadJSON, saveJSON } from '@/lib/storage';
import { formatClockKo, formatMinutesKo } from '@/lib/time';

type Goal = { id: number; exam: string; date: string; scope: string; target: string; color?: string };
type BlockType = 'sleep' | 'study' | 'rest';
type ThemeColor = 'green' | 'purple';
type CategorySource = 'system' | 'goal' | 'custom';
type CalendarCategory = { id: string; name: string; color: string; source: CategorySource; blockType: BlockType; goalId?: number; archived?: boolean };
type TimeBlock = { id: number; date: string; endDate?: string; start: number; end: number; type: BlockType; label: string; goalId?: number; categoryId?: string };
const BLOCK_TYPE_LABEL: Record<BlockType, string> = { study: '공부', sleep: '수면', rest: '휴식' };
const KOREAN_DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const formatHour = (value: number) => `${String(Math.floor(value)).padStart(2, '0')}:${String(Math.round((value - Math.floor(value)) * 60)).padStart(2, '0')}`;
const formatRecordingTime = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

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

const APP_TODAY_ISO = '2026-09-03';

type VoiceStatus = 'idle' | 'recording' | 'processing' | 'error';

function useVoiceCapture<T>(endpoint: string, onResult: (result: T) => void) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef(0);

  const stopRecordingTimer = () => {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  const startRecordingTimer = () => {
    stopRecordingTimer();
    setRecordingSeconds(0);
    recordingStartedAtRef.current = Date.now();
    recordingTimerRef.current = window.setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - recordingStartedAtRef.current) / 1000));
    }, 250);
  };

  const stopVoiceMeter = () => {
    if (meterFrameRef.current !== null) {
      cancelAnimationFrame(meterFrameRef.current);
      meterFrameRef.current = null;
    }
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    setVoiceLevel(0);
  };

  const startVoiceMeter = (stream: MediaStream) => {
    try {
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);

      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      const waveform = new Uint8Array(analyser.fftSize);
      source.connect(analyser);
      audioContextRef.current = audioContext;

      const updateLevel = () => {
        analyser.getByteTimeDomainData(waveform);
        let sumOfSquares = 0;
        for (const sample of waveform) {
          const centered = (sample - 128) / 128;
          sumOfSquares += centered * centered;
        }
        const rms = Math.sqrt(sumOfSquares / waveform.length);
        const normalized = Math.min(1, Math.max(0, (rms - 0.012) * 7.5));
        setVoiceLevel((previous) => previous * 0.55 + normalized * 0.45);
        meterFrameRef.current = requestAnimationFrame(updateLevel);
      };

      void audioContext.resume();
      updateLevel();
    } catch {
      setVoiceLevel(0);
    }
  };

  useEffect(() => () => {
    if (meterFrameRef.current !== null) cancelAnimationFrame(meterFrameRef.current);
    if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current);
    void audioContextRef.current?.close();
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const start = async () => {
    setErrorMessage('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErrorMessage('이 브라우저는 음성 녹음을 지원하지 않아요.');
      setStatus('error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        stopRecordingTimer();
        stopVoiceMeter();
        stream.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        recorderRef.current = null;
        setStatus('processing');
        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          chunksRef.current = [];
          if (blob.size === 0) throw new Error('녹음된 음성이 없어요. 다시 시도해주세요.');
          const body = new FormData();
          const extension = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
          body.append('audio', blob, `recording.${extension}`);
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
      startVoiceMeter(stream);
      startRecordingTimer();
      setStatus('recording');
    } catch (error) {
      stopRecordingTimer();
      stopVoiceMeter();
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      setErrorMessage(error instanceof DOMException && error.name === 'NotAllowedError' ? '마이크 권한이 필요해요.' : '사용할 수 있는 마이크를 찾지 못했어요.');
      setStatus('error');
    }
  };

  const stop = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  return { status, errorMessage, start, stop, voiceLevel, recordingSeconds };
}

type GoalVoiceResult = { exam: string; date: string; scope: string; target: string };
const useVoiceGoalCapture = (onResult: (result: GoalVoiceResult) => void) =>
  useVoiceCapture<GoalVoiceResult>('/api/voice/goal', onResult);

const DEFAULT_GOAL_COLOR = '#145c34';
const DEFAULT_GOALS: Goal[] = [{ id: 1, exam: '일반기계기사 필기', date: '2026-09-26', scope: '재료역학 · 기계열역학 · 기계유체역학 · 기계재료 및 유압기기', target: '기출 7개년 2회독 + 오답노트 완성', color: DEFAULT_GOAL_COLOR }];
const goalsStorageKey = (accountKey: string) => `goalsetter:${accountKey}:goals`;
const THEME_STORAGE_KEY = 'goalsetter:theme';
const SYSTEM_CATEGORIES: CalendarCategory[] = [
  { id: 'system:sleep', name: '수면', color: '#b6bbb4', source: 'system', blockType: 'sleep' },
  { id: 'system:study', name: '공부', color: DEFAULT_GOAL_COLOR, source: 'system', blockType: 'study' },
  { id: 'system:rest', name: '휴식', color: '#d9a441', source: 'system', blockType: 'rest' },
];
const CATEGORY_PALETTE = ['#2563eb', '#db2777', '#0d9488', '#ea580c', '#4f46e5', '#ca8a04', '#0891b2', '#be123c', '#7c3aed', '#65a30d', '#9333ea', '#c2410c'];
const categoriesStorageKey = (accountKey: string) => `goalsetter:${accountKey}:calendar-categories`;

function loadCalendarCategories(accountKey: string) {
  const stored = loadJSON<CalendarCategory[]>(categoriesStorageKey(accountKey), []);
  const storedSystems = new Map(stored.filter((category) => category.source === 'system').map((category) => [category.id, category]));
  const systems = SYSTEM_CATEGORIES.map((category) => ({ ...category, color: storedSystems.get(category.id)?.color ?? category.color }));
  const customs = stored.filter((category) => category.source === 'custom' && category.id && category.name && /^#[0-9a-f]{6}$/i.test(category.color));
  return [...systems, ...customs];
}

function goalCategories(goals: Goal[]): CalendarCategory[] {
  return goals.map((goal) => ({ id: `goal:${goal.id}`, name: goal.exam, color: goal.color ?? DEFAULT_GOAL_COLOR, source: 'goal', blockType: 'study', goalId: goal.id }));
}

function nextCategoryColor(categories: CalendarCategory[]) {
  const used = new Set(categories.map((category) => category.color.toLowerCase()));
  return CATEGORY_PALETTE.find((color) => !used.has(color)) ?? `#${((categories.length * 2654435761) & 0xffffff).toString(16).padStart(6, '0')}`;
}

function PlannerTab({ goals, setGoals }: { goals: Goal[]; setGoals: Dispatch<SetStateAction<Goal[]>> }) {
  const [form, setForm] = useState({ exam: '', date: '', scope: '', target: '' });
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [saved, setSaved] = useState(false);
  const update = (key: keyof typeof form, value: string) => { setSaved(false); setForm((previous) => ({ ...previous, [key]: value })); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.exam || !form.date || !form.scope || !form.target) return;
    setGoals((previous) => [{ id: Date.now(), ...form, color: DEFAULT_GOAL_COLOR }, ...previous]);
    setForm({ exam: '', date: '', scope: '', target: '' }); setSaved(true);
  };
  const saveEditedGoal = (event: FormEvent) => {
    event.preventDefault();
    if (!editingGoal?.exam || !editingGoal.date || !editingGoal.scope || !editingGoal.target) return;
    setGoals((previous) => previous.map((goal) => goal.id === editingGoal.id ? editingGoal : goal));
    setEditingGoal(null);
  };
  const setGoalColor = (id: number, color: string) => {
    setGoals((previous) => previous.map((goal) => goal.id === id ? { ...goal, color } : goal));
  };
  const { status: voiceStatus, errorMessage: voiceError, start: startVoice, stop: stopVoice, voiceLevel: goalVoiceLevel, recordingSeconds: goalRecordingSeconds } = useVoiceGoalCapture((result) => {
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
        <p className="section-copy">시험이나 대회와 준비 범위를 적으면 실행 가능한 목표의 시작점이 만들어집니다.</p>
        <div className="flex items-center gap-3">
          <div className="goal-voice-control">
            <output className="recording-timer goal-recording-timer" aria-label="목표 음성 녹음 시간">{formatRecordingTime(goalRecordingSeconds)}</output>
            <Button
              type="button"
              variant={voiceStatus === 'recording' ? 'destructive' : 'outline'}
              size="sm"
              className="goal-voice-button voice-reactive-button"
              aria-pressed={voiceStatus === 'recording'}
              disabled={voiceStatus === 'processing'}
              onClick={voiceStatus === 'recording' ? stopVoice : startVoice}
              style={{ '--voice-ring-scale': String(1.06 + goalVoiceLevel * 0.42), '--voice-ring-opacity': String(0.32 + goalVoiceLevel * 0.6) } as CSSProperties}
            >
              <span className="voice-level-ring" aria-hidden="true" />
              {voiceStatus === 'recording' ? <><Square aria-hidden="true" /> 녹음 중지</> : voiceStatus === 'processing' ? '인식 중...' : <><Mic aria-hidden="true" /> 음성으로 입력</>}
            </Button>
          </div>
          {voiceStatus === 'recording' && <span className="text-caption text-muted-foreground">시험 또는 대회명, 일정, 범위, 목표를 말해주세요</span>}
          {voiceError && <span className="text-caption text-danger">{voiceError}</span>}
        </div>
        <form onSubmit={submit}>
          <FieldGroup className="goal-fields">
            <Field><FieldLabel htmlFor="exam">시험 또는 대회</FieldLabel><Input id="exam" value={form.exam} onChange={(event) => update('exam', event.target.value)} placeholder="예: 일반기계기사 필기 또는 전국 대회" required /></Field>
            <Field><FieldLabel htmlFor="date">일정</FieldLabel><Input id="date" type="date" value={form.date} onChange={(event) => update('date', event.target.value)} required /></Field>
            <Field className="wide-field"><FieldLabel htmlFor="scope">범위</FieldLabel><Textarea id="scope" value={form.scope} onChange={(event) => update('scope', event.target.value)} placeholder="과목, 단원, 출제 범위를 적어주세요" required /></Field>
            <Field className="wide-field"><FieldLabel htmlFor="target">목표</FieldLabel><Input id="target" value={form.target} onChange={(event) => update('target', event.target.value)} placeholder="예: 기출 7개년 2회독" required /></Field>
          </FieldGroup>
          <div className="form-footer"><span className={saved ? 'save-note is-visible' : 'save-note'}><Check aria-hidden="true" /> 목표가 추가되었어요</span><Button type="submit" size="lg" className="save-goal">목표 만들기 <ArrowRight aria-hidden="true" /></Button></div>
        </form>
      </section>
      <aside className="goal-list" aria-label="내 시험 및 대회 목표">
        <div className="goal-list-heading"><div><span className="eyebrow">MY GOALS</span><h2>다가오는 시험 · 대회</h2></div><span className="goal-count">{goals.length}</span></div>
        {goals.map((goal, index) => {
          const days = Math.max(0, Math.ceil((new Date(`${goal.date}T00:00:00`).getTime() - new Date('2026-09-03T00:00:00').getTime()) / 86400000));
          const color = goal.color ?? DEFAULT_GOAL_COLOR;
          return (
            <article key={goal.id} className={`goal-card ${index === 0 ? 'featured' : ''}`} style={{ '--goal-color': color } as CSSProperties}>
              <div className="goal-card-top">
                <span>D-{days}</span>
                <div className="goal-card-actions">
                  <button type="button" className="goal-edit-button" aria-label={`${goal.exam} 수정`} onClick={() => setEditingGoal({ ...goal })}><Pencil aria-hidden="true" /></button>
                  <label className="goal-color-button" aria-label={`${goal.exam} 색상 선택`} title="카드 색상 선택">
                    <input type="color" value={color} onChange={(event) => setGoalColor(goal.id, event.target.value)} />
                    <Paintbrush aria-hidden="true" style={{ color }} />
                  </label>
                  <CalendarDays aria-hidden="true" />
                </div>
              </div>
              <h3>{goal.exam}</h3>
              <time dateTime={goal.date}>{goal.date.replaceAll('-', '. ')}</time>
              <div className="scope-line"><BookOpen aria-hidden="true" /><p>{goal.scope}</p></div>
              <div className="target-pill"><Target aria-hidden="true" />{goal.target}</div>
            </article>
          );
        })}
      </aside>
      <Dialog open={editingGoal !== null} onOpenChange={(open) => !open && setEditingGoal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>목표 수정</DialogTitle>
            <DialogDescription>시험 정보와 학습 목표를 수정하세요.</DialogDescription>
          </DialogHeader>
          {editingGoal && (
            <form onSubmit={saveEditedGoal} className="grid gap-4">
              <Field><FieldLabel htmlFor="edit-exam">시험 또는 대회</FieldLabel><Input id="edit-exam" value={editingGoal.exam} onChange={(event) => setEditingGoal({ ...editingGoal, exam: event.target.value })} required /></Field>
              <Field><FieldLabel htmlFor="edit-date">일정</FieldLabel><Input id="edit-date" type="date" value={editingGoal.date} onChange={(event) => setEditingGoal({ ...editingGoal, date: event.target.value })} required /></Field>
              <Field><FieldLabel htmlFor="edit-scope">범위</FieldLabel><Textarea id="edit-scope" value={editingGoal.scope} onChange={(event) => setEditingGoal({ ...editingGoal, scope: event.target.value })} required /></Field>
              <Field><FieldLabel htmlFor="edit-target">목표</FieldLabel><Input id="edit-target" value={editingGoal.target} onChange={(event) => setEditingGoal({ ...editingGoal, target: event.target.value })} required /></Field>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setEditingGoal(null)}>취소</Button><Button type="submit">변경 저장</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type CalendarView = 'month' | 'quarter' | 'year';

function oldestGoal(goals: Goal[]) {
  return goals.reduce<Goal | undefined>((oldest, goal) => !oldest || goal.id < oldest.id ? goal : oldest, undefined);
}

function assignLegacyGoalIds(blocks: TimeBlock[], goals: Goal[]) {
  const legacyGoalId = oldestGoal(goals)?.id;
  if (legacyGoalId === undefined) return blocks;
  return blocks.map((block) => block.type === 'study' && block.goalId === undefined ? { ...block, goalId: legacyGoalId } : block);
}

function legacyCategoryId(block: TimeBlock) {
  if (block.goalId !== undefined) return `goal:${block.goalId}`;
  return `system:${block.type}`;
}

function withCategoryIds(blocks: TimeBlock[]) {
  return blocks.map((block) => ({ ...block, categoryId: block.categoryId ?? legacyCategoryId(block) }));
}

function categoryForBlock(block: TimeBlock, categories: CalendarCategory[]) {
  const categoryId = block.categoryId ?? legacyCategoryId(block);
  return categories.find((category) => category.id === categoryId) ?? categories.find((category) => category.id === `system:${block.type}`);
}

function blockColor(block: TimeBlock, categories: CalendarCategory[]) {
  return categoryForBlock(block, categories)?.color ?? DEFAULT_GOAL_COLOR;
}

type ParsedCalendarEvent = Omit<TimeBlock, 'id' | 'goalId' | 'categoryId' | 'endDate'> & { endDate: string; goal?: string | null; category: string; categoryColor?: string | null };

function isParsedTimeBlock(value: unknown): value is ParsedCalendarEvent {
  if (!value || typeof value !== 'object') return false;
  const block = value as Partial<TimeBlock>;
  return typeof block.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(block.date) &&
    typeof block.endDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(block.endDate) &&
    typeof block.start === 'number' &&
    typeof block.end === 'number' &&
    block.start >= 0 &&
    block.start < 24 &&
    block.end >= 0 &&
    block.end < 24 &&
    Date.parse(`${block.endDate}T00:00:00Z`) + block.end * 60 * 60 * 1000 > Date.parse(`${block.date}T00:00:00Z`) + block.start * 60 * 60 * 1000 &&
    (block.type === 'study' || block.type === 'sleep' || block.type === 'rest') &&
    typeof block.label === 'string' &&
    block.label.trim().length > 0 &&
    typeof (value as { category?: unknown }).category === 'string' &&
    (value as { category: string }).category.trim().length > 0 &&
    ((value as { categoryColor?: unknown }).categoryColor == null || /^#[0-9a-f]{6}$/i.test(String((value as { categoryColor?: unknown }).categoryColor)));
}

type TimeBlockSegment = { block: TimeBlock; date: string; start: number; end: number; part: 'whole' | 'start' | 'middle' | 'end' };

function nextIsoDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

function timeBlockEndDate(block: TimeBlock) {
  if (block.endDate && /^\d{4}-\d{2}-\d{2}$/.test(block.endDate)) return block.endDate;
  return block.end < block.start ? nextIsoDate(block.date) : block.date;
}

function withExplicitEndDates(blocks: TimeBlock[]) {
  return blocks.map((block) => ({ ...block, endDate: timeBlockEndDate(block) }));
}

function timeBlockSegments(block: TimeBlock): TimeBlockSegment[] {
  const endDate = timeBlockEndDate(block);
  if (endDate === block.date) return block.end > block.start ? [{ block, date: block.date, start: block.start, end: block.end, part: 'whole' }] : [];
  const segments: TimeBlockSegment[] = [];
  let date = block.date;
  let days = 0;
  while (date <= endDate && days < 367) {
    const isStart = date === block.date;
    const isEnd = date === endDate;
    const start = isStart ? block.start : 0;
    const end = isEnd ? block.end : 24;
    if (end > start) segments.push({ block, date, start, end, part: isStart ? 'start' : isEnd ? 'end' : 'middle' });
    date = nextIsoDate(date);
    days += 1;
  }
  return segments;
}

function timeBlockRange(block: TimeBlock) {
  const endDate = timeBlockEndDate(block);
  return endDate === block.date
    ? `${formatHour(block.start)}–${formatHour(block.end)}`
    : `${block.date} ${formatHour(block.start)}–${endDate} ${formatHour(block.end)}`;
}

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

function TimeMonthGrid({ month, blocks, categories, today, variant, onBlockClick }: { month: Date; blocks: TimeBlock[]; categories: CalendarCategory[]; today: Date; variant: CalendarView; onBlockClick?: (id: number) => void }) {
  const cells = getMonthCells(month);
  return (
    <div className={`calendar-grid calendar-grid--${variant}`} role="grid" aria-label={`${month.getFullYear()}년 ${MONTHS[month.getMonth()]} 시간 기록`}>
      {KOREAN_DAYS.map((day, index) => <div key={day} className={`weekday ${index === 0 ? 'sunday' : ''} ${index === 6 ? 'saturday' : ''}`} role="columnheader">{day}</div>)}
      {cells.map((date) => {
        const dateKey = isoDate(date);
        const outside = date.getMonth() !== month.getMonth();
        const dayBlocks = outside ? [] : blocks.flatMap(timeBlockSegments).filter((segment) => segment.date === dateKey);
        const current = dateKey === isoDate(today);
        return (
          <div key={dateKey} className={`day-cell ${outside ? 'outside' : ''} ${current ? 'current' : ''}`} role="gridcell" aria-label={`${date.getMonth() + 1}월 ${date.getDate()}일`}>
            <div className="day-number"><span>{date.getDate()}</span></div>
            <div className="marker-track">{dayBlocks.map(({ block, start, end, part }) => (
              <button
                key={`${block.id}-${part}`}
                type="button"
                className={`time-block ${block.type} ${part === 'whole' ? '' : `overnight-${part}`}`}
                style={{ left: `${(start / 24) * 100}%`, width: `${((end - start) / 24) * 100}%`, backgroundColor: blockColor(block, categories) }}
                title={`${categoryForBlock(block, categories)?.name ?? BLOCK_TYPE_LABEL[block.type]} · ${block.label} ${timeBlockRange(block)} (클릭해서 조절)`}
                onClick={(event) => { event.stopPropagation(); onBlockClick?.(block.id); }}
              />
            ))}</div>
            {variant === 'month' && dayBlocks.length > 0 && <div className="hours-total">{dayBlocks.filter(({ block }) => block.type === 'study').reduce((sum, segment) => sum + segment.end - segment.start, 0).toFixed(1)}h 공부</div>}
          </div>
        );
      })}
    </div>
  );
}

function YearMatrix({ year, blocks, categories, today }: { year: number; blocks: TimeBlock[]; categories: CalendarCategory[]; today: Date }) {
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
              const dayBlocks = blocks.flatMap(timeBlockSegments).filter((segment) => segment.date === dateKey);
              const current = dateKey === isoDate(today);
              const weekend = date.getDay() === 0 ? 'sunday' : date.getDay() === 6 ? 'saturday' : '';
              return (
                <div key={day} className={`year-day-cell ${weekend} ${current ? 'current' : ''}`} role="gridcell" aria-label={`${monthIndex + 1}월 ${day}일`}>
                  {dayBlocks.map(({ block, start, end, part }) => <div key={`${block.id}-${part}`} className={`year-time-block ${block.type} ${part === 'whole' ? '' : `overnight-${part}`}`} style={{ left: `${(start / 24) * 100}%`, width: `${((end - start) / 24) * 100}%`, backgroundColor: blockColor(block, categories) }} title={`${categoryForBlock(block, categories)?.name ?? BLOCK_TYPE_LABEL[block.type]} · ${block.label} ${timeBlockRange(block)}`} />)}
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
  categories,
  onSave,
  onDelete,
}: {
  block: TimeBlock;
  categories: CalendarCategory[];
  onSave: (id: number, patch: Omit<TimeBlock, 'id'>) => void;
  onDelete: (id: number) => void;
}) {
  const [date, setDate] = useState(block.date);
  const [endDate, setEndDate] = useState(timeBlockEndDate(block));
  const [categoryId, setCategoryId] = useState(block.categoryId ?? legacyCategoryId(block));
  const [label, setLabel] = useState(block.label);
  const [start, setStart] = useState(hourToTimeValue(block.start));
  const [end, setEnd] = useState(hourToTimeValue(block.end));
  const [error, setError] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const startHour = timeValueToHour(start);
    const endHour = timeValueToHour(end);
    if (`${endDate}T${end}` <= `${date}T${start}`) { setError('종료 날짜와 시간은 시작보다 늦어야 해요.'); return; }
    const category = categories.find((candidate) => candidate.id === categoryId);
    if (!category) { setError('카테고리를 선택해주세요.'); return; }
    onSave(block.id, { date, endDate, start: startHour, end: endHour, type: category.blockType, label: label.trim() || category.name, goalId: category.goalId, categoryId: category.id });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>시간 기록 조절</DialogTitle>
        <DialogDescription>시작과 종료 날짜·시간을 하나의 연속된 기록으로 조절할 수 있어요.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} id="time-block-form">
        <FieldGroup>
          <Field orientation="responsive">
            <FieldLabel htmlFor="block-start-date">시작 날짜</FieldLabel>
            <Input id="block-start-date" type="date" value={date} onChange={(event) => { const value = event.target.value; setDate(value); if (endDate < value) setEndDate(value); }} required />
          </Field>
          <Field orientation="responsive">
            <FieldLabel htmlFor="block-start">시작 시간</FieldLabel>
            <Input id="block-start" type="time" step={300} value={start} onChange={(event) => setStart(event.target.value)} required />
          </Field>
          <Field orientation="responsive">
            <FieldLabel htmlFor="block-end-date">종료 날짜</FieldLabel>
            <Input id="block-end-date" type="date" min={date} value={endDate} onChange={(event) => setEndDate(event.target.value)} required />
          </Field>
          <Field orientation="responsive">
            <FieldLabel htmlFor="block-end">종료 시간</FieldLabel>
            <Input id="block-end" type="time" step={300} value={end} onChange={(event) => setEnd(event.target.value)} required />
          </Field>
          <Field orientation="responsive">
            <FieldLabel htmlFor="block-category">카테고리</FieldLabel>
            <select id="block-category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50">
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
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
  categories,
  onOpenChange,
  onSave,
  onDelete,
}: {
  block: TimeBlock | null;
  categories: CalendarCategory[];
  onOpenChange: (open: boolean) => void;
  onSave: (id: number, patch: Omit<TimeBlock, 'id'>) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <Dialog open={block !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {block && <TimeBlockEditForm key={block.id} block={block} categories={categories} onSave={onSave} onDelete={onDelete} />}
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

function TimeBlockCreateForm({
  defaultDate,
  categories,
  onAddCategory,
  onCreate,
}: {
  defaultDate: string;
  categories: CalendarCategory[];
  onAddCategory: (name: string, color: string) => CalendarCategory | null;
  onCreate: (block: Omit<TimeBlock, 'id'>) => void;
}) {
  const [date, setDate] = useState(defaultDate);
  const [endDate, setEndDate] = useState(defaultDate);
  const [categoryId, setCategoryId] = useState(categories.find((category) => category.source === 'goal')?.id ?? categories[0]?.id ?? '');
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState(nextCategoryColor(categories));
  const [label, setLabel] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [error, setError] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const startHour = timeValueToHour(start);
    const endHour = timeValueToHour(end);
    if (`${endDate}T${end}` <= `${date}T${start}`) { setError('종료 날짜와 시간은 시작보다 늦어야 해요.'); return; }
    const category = categories.find((candidate) => candidate.id === categoryId);
    if (!category) { setError('카테고리를 선택해주세요.'); return; }
    onCreate({ date, endDate, start: startHour, end: endHour, type: category.blockType, label: label.trim() || category.name, goalId: category.goalId, categoryId: category.id });
  };

  const addCategory = () => {
    const category = onAddCategory(newCategoryName, newCategoryColor);
    if (!category) { setError('서로 다른 카테고리 이름을 입력해주세요.'); return; }
    setCategoryId(category.id);
    setAddingCategory(false);
    setNewCategoryName('');
    setNewCategoryColor(nextCategoryColor([...categories, category]));
    setError('');
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>시간 기록 추가</DialogTitle>
        <DialogDescription>시작과 종료 날짜·시간을 정해 하나의 연속된 기록을 추가할 수 있어요.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} id="time-block-create-form">
        <FieldGroup>
          <Field orientation="responsive">
            <FieldLabel htmlFor="new-block-date">시작 날짜</FieldLabel>
            <Input id="new-block-date" type="date" value={date} onChange={(event) => { const value = event.target.value; setDate(value); if (endDate < value) setEndDate(value); }} required />
          </Field>
          <Field orientation="responsive">
            <FieldLabel htmlFor="new-block-start">시작 시간</FieldLabel>
            <Input id="new-block-start" type="time" step={300} value={start} onChange={(event) => setStart(event.target.value)} required />
          </Field>
          <Field orientation="responsive">
            <FieldLabel htmlFor="new-block-end-date">종료 날짜</FieldLabel>
            <Input id="new-block-end-date" type="date" min={date} value={endDate} onChange={(event) => setEndDate(event.target.value)} required />
          </Field>
          <Field orientation="responsive">
            <FieldLabel htmlFor="new-block-end">종료 시간</FieldLabel>
            <Input id="new-block-end" type="time" step={300} value={end} onChange={(event) => setEnd(event.target.value)} required />
          </Field>
          <Field orientation="responsive">
            <FieldLabel htmlFor="new-block-category">카테고리</FieldLabel>
            <div className="category-select-stack">
              <select id="new-block-category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50">
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              <Button type="button" size="sm" variant="outline" className="category-add-toggle" onClick={() => setAddingCategory((open) => !open)}><Plus aria-hidden="true" /> 추가하기</Button>
            </div>
          </Field>
          {addingCategory && (
            <div className="category-inline-create">
              <Field><FieldLabel htmlFor="new-category-name">새 카테고리 이름</FieldLabel><Input id="new-category-name" value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="예: 통근" /></Field>
              <Field><FieldLabel htmlFor="new-category-color">색상</FieldLabel><Input id="new-category-color" type="color" value={newCategoryColor} onChange={(event) => setNewCategoryColor(event.target.value)} /></Field>
              <Button type="button" size="sm" onClick={addCategory} disabled={!newCategoryName.trim()}>카테고리 저장</Button>
            </div>
          )}
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
  categories,
  onAddCategory,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  sessionId: number;
  defaultDate: string;
  categories: CalendarCategory[];
  onAddCategory: (name: string, color: string) => CalendarCategory | null;
  onOpenChange: (open: boolean) => void;
  onCreate: (block: Omit<TimeBlock, 'id'>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && <TimeBlockCreateForm key={sessionId} defaultDate={defaultDate} categories={categories} onAddCategory={onAddCategory} onCreate={onCreate} />}
      </DialogContent>
    </Dialog>
  );
}

function CategoryManagerDialog({
  open,
  categories,
  blocks,
  onOpenChange,
  onAdd,
  onRename,
  onColorChange,
  onRemove,
}: {
  open: boolean;
  categories: CalendarCategory[];
  blocks: TimeBlock[];
  onOpenChange: (open: boolean) => void;
  onAdd: (name: string, color: string) => CalendarCategory | null;
  onRename: (id: string, name: string) => void;
  onColorChange: (category: CalendarCategory, color: string) => void;
  onRemove: (category: CalendarCategory) => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(nextCategoryColor(categories));
  const [error, setError] = useState('');
  const add = () => {
    const category = onAdd(name, color);
    if (!category) { setError('이미 사용 중인 이름이거나 올바르지 않은 이름이에요.'); return; }
    setName('');
    setColor(nextCategoryColor([...categories, category]));
    setError('');
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="category-manager-dialog">
        <DialogHeader>
          <DialogTitle>카테고리 관리</DialogTitle>
          <DialogDescription>범례 이름과 색상을 관리합니다. 목표 카테고리의 색상은 목표 계획에도 함께 반영됩니다.</DialogDescription>
        </DialogHeader>
        <div className="category-manager-list">
          {categories.filter((category) => !category.archived).map((category) => {
            const isUsed = blocks.some((block) => (block.categoryId ?? legacyCategoryId(block)) === category.id);
            return (
              <div className="category-manager-row" key={category.id}>
                <input type="color" value={category.color} aria-label={`${category.name} 색상`} onChange={(event) => onColorChange(category, event.target.value)} />
                {category.source === 'custom'
                  ? <Input value={category.name} aria-label={`${category.name} 이름`} onChange={(event) => onRename(category.id, event.target.value)} />
                  : <span className="category-manager-name">{category.name}</span>}
                <span className={`category-source-badge ${category.source}`}>{category.source === 'goal' ? '목표' : category.source === 'system' ? '기본' : '사용자'}</span>
                {category.source === 'custom'
                  ? <Button type="button" size="icon" variant="ghost" aria-label={`${category.name} ${isUsed ? '보관' : '삭제'}`} title={isUsed ? '사용 중인 기록은 유지하고 범례에서 보관' : '카테고리 삭제'} onClick={() => onRemove(category)}><Trash2 aria-hidden="true" /></Button>
                  : <span className="category-lock-note">{category.source === 'goal' ? '이름은 목표 계획에서 변경' : '이름 고정'}</span>}
              </div>
            );
          })}
        </div>
        <div className="category-manager-create">
          <Field><FieldLabel htmlFor="manager-category-name">새 카테고리</FieldLabel><Input id="manager-category-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 통근, 운동" /></Field>
          <Field><FieldLabel htmlFor="manager-category-color">색상</FieldLabel><Input id="manager-category-color" type="color" value={color} onChange={(event) => setColor(event.target.value)} /></Field>
          <Button type="button" onClick={add} disabled={!name.trim()}><Plus aria-hidden="true" /> 추가</Button>
        </div>
        {error && <p className="text-caption text-danger">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}

function CalendarTab({ accountKey, goals, setGoals }: { accountKey: string; goals: Goal[]; setGoals: Dispatch<SetStateAction<Goal[]>> }) {
  const today = useMemo(() => new Date(2026, 8, 3), []);
  const [month, setMonth] = useState(new Date(2026, 8, 3));
  const [view, setView] = useState<CalendarView>('month');
  const [prompt, setPrompt] = useState('');
  const [rawInput, setRawInput] = useState('');
  const [message, setMessage] = useState('입력 대기');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [managingCategories, setManagingCategories] = useState(false);
  const [createSessionId, setCreateSessionId] = useState(0);
  const [storedCategories, setStoredCategories] = useState<CalendarCategory[]>(() => loadCalendarCategories(accountKey));
  const categoryCatalog = useMemo(() => {
    const system = (id: string) => storedCategories.find((category) => category.id === id) ?? SYSTEM_CATEGORIES.find((category) => category.id === id)!;
    const custom = storedCategories.filter((category) => category.source === 'custom');
    return [system('system:sleep'), ...goalCategories(goals), ...custom, system('system:rest'), system('system:study')];
  }, [goals, storedCategories]);
  const activeCategories = useMemo(() => categoryCatalog.filter((category) => !category.archived && (category.id !== 'system:study' || goals.length === 0)), [categoryCatalog, goals.length]);
  const [undoSnapshot, setUndoSnapshot] = useState<{ blocks: TimeBlock[]; categories: CalendarCategory[] } | null>(null);
  const [blocks, setBlocks] = useState<TimeBlock[]>(() => withCategoryIds(assignLegacyGoalIds(withExplicitEndDates(loadJSON(blocksStorageKey(accountKey), DEFAULT_BLOCKS)), goals)));
  useEffect(() => { saveJSON(blocksStorageKey(accountKey), withCategoryIds(assignLegacyGoalIds(withExplicitEndDates(blocks), goals))); }, [accountKey, blocks, goals]);
  useEffect(() => { saveJSON(categoriesStorageKey(accountKey), storedCategories); }, [accountKey, storedCategories]);
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
  const addCustomCategory = (name: string, color: string, blockType: BlockType = 'rest') => {
    const normalizedName = name.trim();
    if (!normalizedName || categoryCatalog.some((category) => !category.archived && category.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase())) return null;
    const category: CalendarCategory = { id: `custom:${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: normalizedName, color: /^#[0-9a-f]{6}$/i.test(color) ? color : nextCategoryColor(categoryCatalog), source: 'custom', blockType };
    setStoredCategories((previous) => [...previous, category]);
    return category;
  };
  const renameCategory = (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed || categoryCatalog.some((category) => category.id !== id && !category.archived && category.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) return;
    setStoredCategories((previous) => previous.map((category) => category.id === id ? { ...category, name } : category));
  };
  const changeCategoryColor = (category: CalendarCategory, color: string) => {
    if (category.source === 'goal' && category.goalId !== undefined) {
      setGoals((previous) => previous.map((goal) => goal.id === category.goalId ? { ...goal, color } : goal));
      return;
    }
    setStoredCategories((previous) => previous.map((candidate) => candidate.id === category.id ? { ...candidate, color } : candidate));
  };
  const removeCategory = (category: CalendarCategory) => {
    const used = blocks.some((block) => (block.categoryId ?? legacyCategoryId(block)) === category.id);
    setStoredCategories((previous) => used
      ? previous.map((candidate) => candidate.id === category.id ? { ...candidate, archived: true } : candidate)
      : previous.filter((candidate) => candidate.id !== category.id));
  };
  const processCalendarInput = async (input: { text?: string; audio?: Blob }) => {
    const sourceText = input.text?.trim();
    if (!sourceText && !input.audio) return;
    const availableBlocks = blocks.map((block) => ({
      id: block.id,
      date: block.date,
      endDate: timeBlockEndDate(block),
      start: block.start,
      end: block.end,
      label: block.label,
      category: categoryForBlock(block, categoryCatalog)?.name ?? BLOCK_TYPE_LABEL[block.type],
    }));
    setIsProcessing(true);
    setMessage(input.audio ? '음성을 텍스트로 바꾸는 중…' : '일정으로 변환하는 중…');
    try {
      let response: Response;
      if (input.audio) {
        const formData = new FormData();
        const extension = input.audio.type.includes('ogg') ? 'ogg' : input.audio.type.includes('mp4') ? 'm4a' : 'webm';
        formData.append('audio', input.audio, `goalsetter-voice.${extension}`);
        formData.append('today', isoDate(today));
        formData.append('goals', JSON.stringify(goals.map((goal) => goal.exam)));
        formData.append('categories', JSON.stringify(activeCategories.map((category) => ({ name: category.name, color: category.color }))));
        formData.append('blocks', JSON.stringify(availableBlocks));
        response = await fetch('/api/calendar-input', { method: 'POST', body: formData });
      } else {
        response = await fetch('/api/calendar-input', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: sourceText, today: isoDate(today), goals: goals.map((goal) => goal.exam), categories: activeCategories.map((category) => ({ name: category.name, color: category.color })), blocks: availableBlocks }),
        });
      }

      const payload = await response.json() as { rawText?: string; events?: unknown[]; deleteBlockIds?: unknown[]; error?: string };
      const resolvedRawText = payload.rawText || sourceText || '';
      if (input.audio && resolvedRawText) setRawInput(resolvedRawText);
      if (!response.ok) throw new Error(payload.error || '입력을 처리하지 못했어요.');

      const parsedEvents = (payload.events ?? []).filter(isParsedTimeBlock);
      const existingIds = new Set(blocks.map((block) => block.id));
      const deleteBlockIds = new Set((payload.deleteBlockIds ?? []).filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && existingIds.has(id)));
      const deletedBlocks = blocks.filter((block) => deleteBlockIds.has(block.id));
      if (parsedEvents.length === 0 && deletedBlocks.length === 0) throw new Error('추가하거나 삭제할 시간 기록을 찾지 못했어요.');

      const idBase = Date.now();
      const lowerRawText = resolvedRawText.toLowerCase();
      const goalsMentionedInInput = goals.filter((goal) => lowerRawText.includes(goal.exam.toLowerCase()));
      const createdCategories: CalendarCategory[] = [];
      const workingCategories = [...categoryCatalog];
      const newBlocks: TimeBlock[] = parsedEvents.map((block, index) => {
        const explicitGoal = block.goal ? goals.find((goal) => goal.exam.toLowerCase() === block.goal?.toLowerCase()) : undefined;
        const labelGoal = goals.find((goal) => block.label.toLowerCase().includes(goal.exam.toLowerCase()));
        const matchedGoal = explicitGoal ?? labelGoal ?? (goalsMentionedInInput.length === 1 ? goalsMentionedInInput[0] : undefined);
        const requestedName = block.category.trim();
        let category = workingCategories.find((candidate) => !candidate.archived && candidate.name.toLocaleLowerCase() === requestedName.toLocaleLowerCase());
        if (!category && matchedGoal && block.type === 'study') category = workingCategories.find((candidate) => candidate.goalId === matchedGoal.id);
        if (!category) {
          category = { id: `custom:${idBase}-${index}`, name: requestedName, color: block.categoryColor ?? nextCategoryColor(workingCategories), source: 'custom', blockType: block.type };
          workingCategories.push(category);
          createdCategories.push(category);
        }
        return { id: idBase + index, date: block.date, endDate: block.endDate, start: block.start, end: block.end, type: category.blockType, label: block.label, goalId: category.goalId, categoryId: category.id };
      });
      setUndoSnapshot({ blocks, categories: storedCategories });
      if (createdCategories.length > 0) setStoredCategories((previous) => [...previous, ...createdCategories]);
      setBlocks((previous) => [...previous.filter((block) => !deleteBlockIds.has(block.id)), ...newBlocks]);
      setPrompt('');
      const categoryNotice = createdCategories.length > 0
        ? ` 새 카테고리 ${createdCategories.map((category) => `'${category.name}'`).join(', ')}도 추가했어요.`
        : '';
      const changes = [];
      if (deletedBlocks.length === 1) changes.push(`'${deletedBlocks[0].label}' 기록을 삭제했어요.`);
      else if (deletedBlocks.length > 1) changes.push(`${deletedBlocks.length}개의 기록을 삭제했어요.`);
      if (newBlocks.length === 1) changes.push(`'${newBlocks[0].label}' 기록을 추가했어요.`);
      else if (newBlocks.length > 1) changes.push(`${newBlocks.length}개의 기록을 추가했어요.`);
      setMessage(`${changes.join(' ')}${categoryNotice}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '입력을 처리하지 못했어요.');
    } finally {
      setIsProcessing(false);
    }
  };

  const addNaturalEntry = (event: FormEvent) => {
    event.preventDefault();
    void processCalendarInput({ text: prompt });
  };

  const stopVoiceMeter = () => {
    if (meterFrameRef.current !== null) cancelAnimationFrame(meterFrameRef.current);
    meterFrameRef.current = null;
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') void audioContextRef.current.close();
    audioContextRef.current = null;
    setVoiceLevel(0);
  };

  const startVoiceMeter = (stream: MediaStream) => {
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      const source = context.createMediaStreamSource(stream);
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      audioContextRef.current = context;
      const samples = new Uint8Array(analyser.fftSize);
      const measure = () => {
        analyser.getByteTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) {
          const amplitude = (sample - 128) / 128;
          energy += amplitude * amplitude;
        }
        const rms = Math.sqrt(energy / samples.length);
        const level = Math.min(1, Math.max(0, (rms - 0.012) * 7.5));
        setVoiceLevel((previous) => previous * 0.58 + level * 0.42);
        meterFrameRef.current = requestAnimationFrame(measure);
      };
      void context.resume();
      measure();
    } catch {
      setVoiceLevel(0);
    }
  };

  const stopRecordingTimer = () => {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  const startRecordingTimer = () => {
    stopRecordingTimer();
    setRecordingSeconds(0);
    recordingStartedAtRef.current = Date.now();
    recordingTimerRef.current = window.setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - recordingStartedAtRef.current) / 1000));
    }, 250);
  };

  useEffect(() => () => {
    if (meterFrameRef.current !== null) cancelAnimationFrame(meterFrameRef.current);
    if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current);
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') void audioContextRef.current.close();
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const toggleRecording = async () => {
    if (isProcessing) return;
    if (isRecording) {
      stopRecordingTimer();
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      setIsRecording(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setMessage('이 브라우저에서는 음성 녹음을 사용할 수 없어요.');
      return;
    }
    setMessage('마이크 연결 중…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      const preferredType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
      audioChunksRef.current = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size > 0) audioChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        stopRecordingTimer();
        stopVoiceMeter();
        stream.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        recorderRef.current = null;
        const audio = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        audioChunksRef.current = [];
        if (audio.size > 0) void processCalendarInput({ audio });
        else setMessage('녹음된 음성이 없어요. 다시 시도해주세요.');
      };
      recorder.start();
      startVoiceMeter(stream);
      startRecordingTimer();
      setRawInput('');
      setMessage('녹음 중 · 버튼을 다시 누르면 완료');
      setIsRecording(true);
    } catch (error) {
      stopRecordingTimer();
      stopVoiceMeter();
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      setMessage(error instanceof DOMException && error.name === 'NotAllowedError' ? '마이크 권한을 허용해주세요.' : '마이크를 시작하지 못했어요.');
    }
  };
  const editingBlock = blocks.find((block) => block.id === editingId) ?? null;
  const updateBlock = (id: number, patch: Omit<TimeBlock, 'id'>) => {
    setUndoSnapshot(null);
    setBlocks((previous) => previous.map((block) => (block.id === id ? { ...block, ...patch } : block)));
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
  const undoVoiceSchedule = () => {
    if (!undoSnapshot) return;
    setBlocks(undoSnapshot.blocks);
    setStoredCategories(undoSnapshot.categories);
    setUndoSnapshot(null);
    setMessage('방금 변경한 기록을 되돌렸어요.');
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
        <div className="calendar-legend" aria-label="시간 기록 범례">
          <div className="legend-items">
            {activeCategories.map((category) => <span key={category.id}><i className="legend-dot" style={{ backgroundColor: category.color }} />{category.name}</span>)}
          </div>
          <div className="legend-actions">
            <Button size="icon" variant="outline" aria-label="카테고리 관리" title="카테고리 관리" onClick={() => setManagingCategories(true)}>M</Button>
            <Button size="icon" variant="outline" aria-label="새 시간 기록 추가" onClick={openCreate}><Plus aria-hidden="true" /></Button>
          </div>
        </div>
      </div>
      {view === 'month' ? <TimeMonthGrid month={month} blocks={blocks} categories={categoryCatalog} today={today} variant="month" onBlockClick={setEditingId} /> : view === 'quarter' ? (
        <div className={`multi-calendar multi-calendar--${view}`}>
          {visibleMonths.map((visibleMonth) => <section className="mini-month" key={`${visibleMonth.getFullYear()}-${visibleMonth.getMonth()}`}><h2>{MONTHS[visibleMonth.getMonth()]}</h2><TimeMonthGrid month={visibleMonth} blocks={blocks} categories={categoryCatalog} today={today} variant={view} onBlockClick={setEditingId} /></section>)}
        </div>
      ) : <YearMatrix year={month.getFullYear()} blocks={blocks} categories={categoryCatalog} today={today} />}
      <aside className={`raw-input-panel ${isRecording ? 'is-recording' : ''}`} aria-label="변환 전 원문">
        <div className="raw-input-heading">
          <span>RAW INPUT</span>
          <div className="raw-input-meta">
            <output aria-live="polite">{message}</output>
            {undoSnapshot && <button type="button" onClick={undoVoiceSchedule}>실행 취소</button>}
          </div>
        </div>
        <p>{rawInput || '음성 인식 결과가 변환 전에 여기에 표시됩니다.'}</p>
      </aside>
      <form className="command-bar" onSubmit={addNaturalEntry}>
        <div className="command-icon"><Sparkles aria-hidden="true" /></div>
        <label htmlFor="natural-entry" className="sr-only">자연어로 시간 기록 추가</label>
        <input id="natural-entry" value={prompt} onChange={(event) => { setPrompt(event.target.value); setMessage('입력 중'); }} placeholder="예: 오늘 03:00부터 08:00까지 잤어" disabled={isProcessing || isRecording} />
        <output className="recording-timer command-recording-timer" aria-label="캘린더 음성 녹음 시간">{formatRecordingTime(recordingSeconds)}</output>
        <Button type="button" size="icon" variant={isRecording ? 'destructive' : 'outline'} className="mic-button voice-reactive-button" aria-label={isRecording ? '음성 녹음 완료' : '음성으로 입력'} aria-pressed={isRecording} onClick={toggleRecording} disabled={isProcessing} style={{ '--voice-ring-scale': String(1.08 + voiceLevel * 0.72), '--voice-ring-opacity': String(0.32 + voiceLevel * 0.6) } as CSSProperties}>
          <span className="voice-level-ring" aria-hidden="true" />
          {isRecording ? <Square aria-hidden="true" /> : <Mic aria-hidden="true" />}
        </Button>
        <Button type="submit" size="icon" aria-label="시간 기록 추가" disabled={isProcessing || isRecording || !prompt.trim()}><Send /></Button>
      </form>
      <TimeBlockEditDialog block={editingBlock} categories={categoryCatalog.filter((category) => !category.archived || category.id === editingBlock?.categoryId)} onOpenChange={(open) => !open && setEditingId(null)} onSave={updateBlock} onDelete={deleteBlock} />
      <TimeBlockCreateDialog open={creating} sessionId={createSessionId} defaultDate={isoDate(today)} categories={activeCategories} onAddCategory={addCustomCategory} onOpenChange={setCreating} onCreate={createBlock} />
      <CategoryManagerDialog open={managingCategories} categories={activeCategories} blocks={blocks} onOpenChange={setManagingCategories} onAdd={addCustomCategory} onRename={renameCategory} onColorChange={changeCategoryColor} onRemove={removeCategory} />
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
const analysisStorageKey = (accountKey: string) => `goalsetter:${accountKey}:analysis`;

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
const getClientReadySnapshot = () => true;
const getServerReadySnapshot = () => false;

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
  const clientReady = useSyncExternalStore(noopSubscribe, getClientReadySnapshot, getServerReadySnapshot);
  if (!clientReady) return null;
  return <GoalsetterApp key={accountKey} accountKey={accountKey} />;
}

function GoalsetterApp({ accountKey }: { accountKey: string }) {
  const [goals, setGoals] = useState<Goal[]>(() => loadJSON(goalsStorageKey(accountKey), DEFAULT_GOALS));
  const [theme, setTheme] = useState<ThemeColor>(() => loadJSON(THEME_STORAGE_KEY, 'green'));
  useEffect(() => { saveJSON(goalsStorageKey(accountKey), goals); }, [accountKey, goals]);
  useEffect(() => { saveJSON(THEME_STORAGE_KEY, theme); }, [theme]);
  const toggleTheme = () => setTheme((current) => (current === 'green' ? 'purple' : 'green'));

  return (
    <main className="app-shell" data-theme={theme}>
      <Tabs defaultValue="planner" className="app-tabs">
        <header className="topbar">
          <div className="brand">
            <button
              type="button"
              className="brand-mark"
              onClick={toggleTheme}
              aria-label={`테마를 ${theme === 'green' ? '보라색' : '녹색'}으로 변경`}
              aria-pressed={theme === 'purple'}
              title="테마 색상 전환"
            >
              <Clock3 aria-hidden="true" />
            </button>
            <a href="#" className="brand-name" aria-label="Goalsetter 홈">Goalsetter</a>
          </div>
          <TabsList className="main-nav" aria-label="주요 메뉴">
            <TabsTrigger value="planner"><Target aria-hidden="true" />목표 계획</TabsTrigger>
            <TabsTrigger value="calendar"><CalendarDays aria-hidden="true" />타임 캘린더</TabsTrigger>
            <TabsTrigger value="analysis"><Brain aria-hidden="true" />AI 분석</TabsTrigger>
          </TabsList>
          <AuthButton />
        </header>
        <div className="content-wrap">
          <TabsContent value="planner"><PlannerTab goals={goals} setGoals={setGoals} /></TabsContent>
          <TabsContent value="calendar"><CalendarTab accountKey={accountKey} goals={goals} setGoals={setGoals} /></TabsContent>
          <TabsContent value="analysis"><AnalysisTab key={accountKey} accountKey={accountKey} /></TabsContent>
        </div>
      </Tabs>
    </main>
  );
}
