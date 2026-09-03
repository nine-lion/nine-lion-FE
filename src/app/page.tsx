'use client';

import { type CSSProperties, type Dispatch, FormEvent, type SetStateAction, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, LogIn, LogOut, Mic, Paintbrush, Pencil, Plus, Send, Sparkles, Square, Target, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { getAccountKey, getServerAccountKey, isAuthenticated } from '@/lib/auth';
import { loadJSON, saveJSON } from '@/lib/storage';

type Goal = { id: number; exam: string; date: string; scope: string; target: string; color?: string };
type BlockType = 'sleep' | 'study' | 'rest';
type ThemeColor = 'green' | 'purple';
type TimeBlock = { id: number; date: string; endDate?: string; start: number; end: number; type: BlockType; label: string; goalId?: number };
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

const APP_TODAY_ISO = '2026-09-01';

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
    const AudioContextConstructor = window.AudioContext;
    const audioContext = new AudioContextConstructor();
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

    updateLevel();
  };

  useEffect(() => () => {
    if (meterFrameRef.current !== null) cancelAnimationFrame(meterFrameRef.current);
    if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current);
    void audioContextRef.current?.close();
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const start = async () => {
    setErrorMessage('');
    if (!navigator.mediaDevices?.getUserMedia) {
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
      startVoiceMeter(stream);
      startRecordingTimer();
      setStatus('recording');
    } catch {
      stopRecordingTimer();
      stopVoiceMeter();
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      setErrorMessage('마이크 권한이 필요해요.');
      setStatus('error');
    }
  };

  const stop = () => { recorderRef.current?.stop(); };

  return { status, errorMessage, start, stop, voiceLevel, recordingSeconds };
}

type GoalVoiceResult = { exam: string; date: string; scope: string; target: string };
const useVoiceGoalCapture = (onResult: (result: GoalVoiceResult) => void) =>
  useVoiceCapture<GoalVoiceResult>('/api/voice/goal', onResult);

const DEFAULT_GOAL_COLOR = '#145c34';
const DEFAULT_GOALS: Goal[] = [{ id: 1, exam: '일반기계기사 필기', date: '2026-09-26', scope: '재료역학 · 기계열역학 · 기계유체역학 · 기계재료 및 유압기기', target: '기출 7개년 2회독 + 오답노트 완성', color: DEFAULT_GOAL_COLOR }];
const goalsStorageKey = (accountKey: string) => `goalsetter:${accountKey}:goals`;
const THEME_STORAGE_KEY = 'goalsetter:theme';

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
              style={{ '--voice-ring-scale': String(1.02 + goalVoiceLevel * 0.14), '--voice-ring-opacity': String(0.32 + goalVoiceLevel * 0.6) } as CSSProperties}
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
          const days = Math.max(0, Math.ceil((new Date(`${goal.date}T00:00:00`).getTime() - new Date('2026-09-01T00:00:00').getTime()) / 86400000));
          const color = goal.color ?? DEFAULT_GOAL_COLOR;
          return (
            <article key={goal.id} className={`goal-card ${index === 0 ? 'featured' : ''}`} style={{ '--goal-color': color } as React.CSSProperties}>
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

function goalForBlock(block: TimeBlock, goals: Goal[]) {
  if (block.type !== 'study') return undefined;
  return goals.find((goal) => goal.id === block.goalId) ?? oldestGoal(goals);
}

function blockColor(block: TimeBlock, goals: Goal[]) {
  return goalForBlock(block, goals)?.color ?? DEFAULT_GOAL_COLOR;
}

type ParsedCalendarEvent = Omit<TimeBlock, 'id' | 'goalId' | 'endDate'> & { endDate: string; goal?: string | null };

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
    block.label.trim().length > 0;
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

function TimeMonthGrid({ month, blocks, goals, today, variant, onBlockClick }: { month: Date; blocks: TimeBlock[]; goals: Goal[]; today: Date; variant: CalendarView; onBlockClick?: (id: number) => void }) {
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
                style={{ left: `${(start / 24) * 100}%`, width: `${((end - start) / 24) * 100}%`, ...(block.type === 'study' ? { backgroundColor: blockColor(block, goals) } : {}) }}
                title={`${goalForBlock(block, goals)?.exam ? `${goalForBlock(block, goals)?.exam} · ` : ''}${block.label} ${timeBlockRange(block)} (클릭해서 조절)`}
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

function YearMatrix({ year, blocks, goals, today }: { year: number; blocks: TimeBlock[]; goals: Goal[]; today: Date }) {
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
                  {dayBlocks.map(({ block, start, end, part }) => <div key={`${block.id}-${part}`} className={`year-time-block ${block.type} ${part === 'whole' ? '' : `overnight-${part}`}`} style={{ left: `${(start / 24) * 100}%`, width: `${((end - start) / 24) * 100}%`, ...(block.type === 'study' ? { backgroundColor: blockColor(block, goals) } : {}) }} title={`${goalForBlock(block, goals)?.exam ? `${goalForBlock(block, goals)?.exam} · ` : ''}${block.label} ${timeBlockRange(block)}`} />)}
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
  goals,
  onSave,
  onDelete,
}: {
  block: TimeBlock;
  goals: Goal[];
  onSave: (id: number, patch: Omit<TimeBlock, 'id'>) => void;
  onDelete: (id: number) => void;
}) {
  const [date, setDate] = useState(block.date);
  const [endDate, setEndDate] = useState(timeBlockEndDate(block));
  const [type, setType] = useState<TimeBlock['type']>(block.type);
  const [goalId, setGoalId] = useState(String(block.goalId ?? oldestGoal(goals)?.id ?? ''));
  const [label, setLabel] = useState(block.label);
  const [start, setStart] = useState(hourToTimeValue(block.start));
  const [end, setEnd] = useState(hourToTimeValue(block.end));
  const [error, setError] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const startHour = timeValueToHour(start);
    const endHour = timeValueToHour(end);
    if (`${endDate}T${end}` <= `${date}T${start}`) { setError('종료 날짜와 시간은 시작보다 늦어야 해요.'); return; }
    onSave(block.id, { date, endDate, start: startHour, end: endHour, type, label: label.trim() || BLOCK_TYPE_LABEL[type], goalId: type === 'study' && goalId ? Number(goalId) : undefined });
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
          {type === 'study' && goals.length > 0 && (
            <Field orientation="responsive">
              <FieldLabel htmlFor="block-goal">연결된 목표</FieldLabel>
              <select id="block-goal" value={goalId} onChange={(event) => setGoalId(event.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50">
                {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.exam}</option>)}
              </select>
            </Field>
          )}
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
  goals,
  onOpenChange,
  onSave,
  onDelete,
}: {
  block: TimeBlock | null;
  goals: Goal[];
  onOpenChange: (open: boolean) => void;
  onSave: (id: number, patch: Omit<TimeBlock, 'id'>) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <Dialog open={block !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {block && <TimeBlockEditForm key={block.id} block={block} goals={goals} onSave={onSave} onDelete={onDelete} />}
      </DialogContent>
    </Dialog>
  );
}

const DEFAULT_BLOCKS: TimeBlock[] = [
  { id: 1, date: '2026-09-01', start: 1.5, end: 7.5, type: 'sleep', label: '수면' },
  { id: 2, date: '2026-09-01', start: 9, end: 11.5, type: 'study', label: '재료역학', goalId: 1 },
  { id: 3, date: '2026-09-01', start: 14, end: 17, type: 'study', label: '기출 풀이', goalId: 1 },
  { id: 4, date: '2026-09-02', start: 2.5, end: 8, type: 'sleep', label: '수면' },
  { id: 5, date: '2026-09-02', start: 19, end: 22, type: 'study', label: '열역학', goalId: 1 },
  { id: 6, date: '2026-09-03', start: 0, end: 6.5, type: 'sleep', label: '수면' },
];
const blocksStorageKey = (accountKey: string) => `goalsetter:${accountKey}:blocks`;

function TimeBlockCreateForm({
  defaultDate,
  goals,
  onCreate,
}: {
  defaultDate: string;
  goals: Goal[];
  onCreate: (block: Omit<TimeBlock, 'id'>) => void;
}) {
  const [date, setDate] = useState(defaultDate);
  const [endDate, setEndDate] = useState(defaultDate);
  const [type, setType] = useState<TimeBlock['type']>('study');
  const [goalId, setGoalId] = useState(String(goals[0]?.id ?? ''));
  const [label, setLabel] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [error, setError] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const startHour = timeValueToHour(start);
    const endHour = timeValueToHour(end);
    if (`${endDate}T${end}` <= `${date}T${start}`) { setError('종료 날짜와 시간은 시작보다 늦어야 해요.'); return; }
    onCreate({ date, endDate, start: startHour, end: endHour, type, label: label.trim() || BLOCK_TYPE_LABEL[type], goalId: type === 'study' && goalId ? Number(goalId) : undefined });
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
          {type === 'study' && goals.length > 0 && (
            <Field orientation="responsive">
              <FieldLabel htmlFor="new-block-goal">연결된 목표</FieldLabel>
              <select id="new-block-goal" value={goalId} onChange={(event) => setGoalId(event.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50">
                {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.exam}</option>)}
              </select>
            </Field>
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
  goals,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  sessionId: number;
  defaultDate: string;
  goals: Goal[];
  onOpenChange: (open: boolean) => void;
  onCreate: (block: Omit<TimeBlock, 'id'>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && <TimeBlockCreateForm key={sessionId} defaultDate={defaultDate} goals={goals} onCreate={onCreate} />}
      </DialogContent>
    </Dialog>
  );
}

function CalendarTab({ accountKey, goals }: { accountKey: string; goals: Goal[] }) {
  const today = useMemo(() => new Date(2026, 8, 1), []);
  const [month, setMonth] = useState(new Date(2026, 8, 1));
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
  const [createSessionId, setCreateSessionId] = useState(0);
  const [undoSnapshot, setUndoSnapshot] = useState<TimeBlock[] | null>(null);
  const [blocks, setBlocks] = useState<TimeBlock[]>(() => assignLegacyGoalIds(withExplicitEndDates(loadJSON(blocksStorageKey(accountKey), DEFAULT_BLOCKS)), goals));
  useEffect(() => { saveJSON(blocksStorageKey(accountKey), assignLegacyGoalIds(withExplicitEndDates(blocks), goals)); }, [accountKey, blocks, goals]);
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
  const processCalendarInput = async (input: { text?: string; audio?: Blob }) => {
    const sourceText = input.text?.trim();
    if (!sourceText && !input.audio) return;
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
        response = await fetch('/api/calendar-input', { method: 'POST', body: formData });
      } else {
        response = await fetch('/api/calendar-input', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: sourceText, today: isoDate(today), goals: goals.map((goal) => goal.exam) }),
        });
      }

      const payload = await response.json() as { rawText?: string; events?: unknown[]; error?: string };
      const resolvedRawText = payload.rawText || sourceText || '';
      if (input.audio && resolvedRawText) setRawInput(resolvedRawText);
      if (!response.ok) throw new Error(payload.error || '입력을 처리하지 못했어요.');

      const parsedEvents = (payload.events ?? []).filter(isParsedTimeBlock);
      if (parsedEvents.length === 0) throw new Error('추가할 수 있는 시간 기록을 찾지 못했어요.');

      const idBase = Date.now();
      const lowerRawText = resolvedRawText.toLowerCase();
      const goalsMentionedInInput = goals.filter((goal) => lowerRawText.includes(goal.exam.toLowerCase()));
      const newBlocks: TimeBlock[] = parsedEvents.map((block, index) => {
        const explicitGoal = block.goal ? goals.find((goal) => goal.exam.toLowerCase() === block.goal?.toLowerCase()) : undefined;
        const labelGoal = goals.find((goal) => block.label.toLowerCase().includes(goal.exam.toLowerCase()));
        const matchedGoal = explicitGoal ?? labelGoal ?? (goalsMentionedInInput.length === 1 ? goalsMentionedInInput[0] : goals[0]);
        return { id: idBase + index, date: block.date, endDate: block.endDate, start: block.start, end: block.end, type: block.type, label: block.label, goalId: block.type === 'study' ? matchedGoal?.id : undefined };
      });
      setUndoSnapshot(blocks);
      setBlocks((previous) => [...previous, ...newBlocks]);
      setPrompt('');
      setMessage(newBlocks.length === 1 ? `${newBlocks[0].label} 기록을 추가했어요.` : `${newBlocks.length}개의 기록을 추가했어요.`);
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
      setVoiceLevel(0.08);
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
      recorderRef.current?.stop();
      setIsRecording(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setMessage('이 브라우저에서는 음성 녹음을 사용할 수 없어요.');
      return;
    }
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
    setBlocks(undoSnapshot);
    setUndoSnapshot(null);
    setMessage('방금 추가한 기록을 취소했어요.');
  };
  return (
    <section className="calendar-shell" aria-labelledby="calendar-heading">
      <div className="calendar-toolbar">
        <div><span className="eyebrow">TIME MARKER</span><h1 id="calendar-heading">{heading}</h1></div>
        <div className="calendar-actions">
          <div className="view-switch" role="group" aria-label="달력 보기 방식">
            {([['month', '월력'], ['quarter', '분기력'], ['year', '연력']] as const).map(([value, label]) => <Button key={value} size="sm" variant={view === value ? 'secondary' : 'ghost'} onClick={() => setView(value)} aria-pressed={view === value}>{label}</Button>)}
          </div>
          <div className="calendar-controls"><Button variant="outline" size="icon" aria-label="이전 기간" onClick={() => shiftMonth(-1)}><ChevronLeft /></Button><Button variant="outline" onClick={() => setMonth(new Date(2026, 8, 1))}>오늘</Button><Button variant="outline" size="icon" aria-label="다음 기간" onClick={() => shiftMonth(1)}><ChevronRight /></Button></div>
        </div>
        <div className="calendar-legend" aria-label="시간 기록 범례">
          <span><i className="legend-dot sleep" />수면</span>
          {goals.length > 0 ? goals.map((goal) => <span key={goal.id}><i className="legend-dot" style={{ backgroundColor: goal.color ?? DEFAULT_GOAL_COLOR }} />{goal.exam}</span>) : <span><i className="legend-dot study" />공부</span>}
          <span><i className="legend-dot rest" />휴식</span>
          <Button size="icon" variant="outline" aria-label="새 시간 기록 추가" onClick={openCreate}><Plus aria-hidden="true" /></Button>
        </div>
      </div>
      {view === 'month' ? <TimeMonthGrid month={month} blocks={blocks} goals={goals} today={today} variant="month" onBlockClick={setEditingId} /> : view === 'quarter' ? (
        <div className={`multi-calendar multi-calendar--${view}`}>
          {visibleMonths.map((visibleMonth) => <section className="mini-month" key={`${visibleMonth.getFullYear()}-${visibleMonth.getMonth()}`}><h2>{MONTHS[visibleMonth.getMonth()]}</h2><TimeMonthGrid month={visibleMonth} blocks={blocks} goals={goals} today={today} variant={view} onBlockClick={setEditingId} /></section>)}
        </div>
      ) : <YearMatrix year={month.getFullYear()} blocks={blocks} goals={goals} today={today} />}
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
      <TimeBlockEditDialog block={editingBlock} goals={goals} onOpenChange={(open) => !open && setEditingId(null)} onSave={updateBlock} onDelete={deleteBlock} />
      <TimeBlockCreateDialog open={creating} sessionId={createSessionId} defaultDate={isoDate(today)} goals={goals} onOpenChange={setCreating} onCreate={createBlock} />
    </section>
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
  const toggleTheme = () => setTheme((current) => current === 'green' ? 'purple' : 'green');

  return <main className="app-shell" data-theme={theme}><Tabs defaultValue="planner" className="app-tabs"><header className="topbar"><div className="brand"><button type="button" className="brand-mark" onClick={toggleTheme} aria-label={`테마를 ${theme === 'green' ? '보라색' : '녹색'}으로 변경`} aria-pressed={theme === 'purple'} title="테마 색상 전환"><Clock3 aria-hidden="true" /></button><a href="#" className="brand-name" aria-label="Goalsetter 홈">Goalsetter</a></div><TabsList className="main-nav" aria-label="주요 메뉴"><TabsTrigger value="planner"><Target aria-hidden="true" />목표 계획</TabsTrigger><TabsTrigger value="calendar"><CalendarDays aria-hidden="true" />타임 캘린더</TabsTrigger></TabsList><AuthButton /></header><div className="content-wrap"><TabsContent value="planner"><PlannerTab goals={goals} setGoals={setGoals} /></TabsContent><TabsContent value="calendar"><CalendarTab accountKey={accountKey} goals={goals} /></TabsContent></div></Tabs></main>;
}
