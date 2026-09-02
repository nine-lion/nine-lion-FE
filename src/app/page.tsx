'use client';

import {
  type FormEvent,
  useCallback,
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
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LogIn,
  LogOut,
  Mic,
  Plus,
  Send,
  Sparkles,
  Square,
  Target,
  Trash2,
} from 'lucide-react';
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAccountKey, getServerAccountKey, isAuthenticated } from '@/lib/auth';
import { ApiError } from '@/lib/api/client';
import {
  createGoal,
  createGoalFromVoice,
  deleteGoal as deleteGoalApi,
  fetchHealth,
  listGoals,
  type GoalRead,
  type VoiceGoalResponse,
} from '@/lib/api/goals';
import { createScheduleFromVoice, parseScheduleText, type VoiceScheduleResponse } from '@/lib/api/schedule';
import { loadJSON, saveJSON } from '@/lib/storage';
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';

type BlockType = 'sleep' | 'study' | 'rest';
type TimeBlock = { id: number; date: string; start: number; end: number; type: BlockType; label: string };
const BLOCK_TYPE_LABEL: Record<BlockType, string> = { study: '공부', sleep: '수면', rest: '휴식' };
const KOREAN_DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
const APP_TODAY_ISO = '2026-09-01';
const isoDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const formatHour = (value: number) =>
  `${String(Math.floor(value)).padStart(2, '0')}:${String(Math.round((value - Math.floor(value)) * 60)).padStart(2, '0')}`;
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

type VoiceStatus = 'idle' | 'recording' | 'processing' | 'error';

// Shared MediaRecorder plumbing. `capture` turns the recorded Blob into a
// BE-AI API call (goals/voice or schedule/voice) — no Next.js BFF involved.
function useVoiceRecorder<T>(handlers: {
  capture: (blob: Blob) => Promise<T>;
  onResult: (result: T) => void;
  onError: (message: string) => void;
}) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const start = useCallback(async () => {
    setErrorMessage('');
    if (!navigator.mediaDevices?.getUserMedia) {
      const m = '이 브라우저는 음성 녹음을 지원하지 않아요.';
      setErrorMessage(m);
      setStatus('error');
      handlers.onError(m);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setStatus('processing');
        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          const result = await handlers.capture(blob);
          handlers.onResult(result);
          setStatus('idle');
        } catch (error) {
          const message =
            error instanceof ApiError
              ? error.message
              : error instanceof Error
                ? error.message
                : '음성 처리에 실패했어요.';
          setErrorMessage(message);
          setStatus('error');
          handlers.onError(message);
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setStatus('recording');
    } catch {
      const message = '마이크 권한이 필요해요.';
      setErrorMessage(message);
      setStatus('error');
      handlers.onError(message);
    }
  }, [handlers]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  return { status, errorMessage, start, stop };
}

// Backs the planner's "voice" button — calls nine-lion-BE-AI /goals/voice.
function useGoalVoiceCapture(handlers: {
  onResult: (result: VoiceGoalResponse) => void;
  onError: (message: string) => void;
}) {
  return useVoiceRecorder<VoiceGoalResponse>({
    capture: (blob) => createGoalFromVoice(blob, { referenceDate: APP_TODAY_ISO }),
    onResult: handlers.onResult,
    onError: handlers.onError,
  });
}

// Backs the calendar tab's voice entry points — calls nine-lion-BE-AI /schedule/voice.
function useScheduleVoiceCapture(handlers: {
  onResult: (result: VoiceScheduleResponse) => void;
  onError: (message: string) => void;
}) {
  return useVoiceRecorder<VoiceScheduleResponse>({
    capture: (blob) => createScheduleFromVoice(blob, { referenceDate: APP_TODAY_ISO }),
    onResult: handlers.onResult,
    onError: handlers.onError,
  });
}

type GoalFormValues = { exam: string; date: string; scope: string; target: string };
const emptyGoalForm = (): GoalFormValues => ({ exam: '', date: '', scope: '', target: '' });

function ConnectionBanner() {
  const [health, setHealth] = useState<Awaited<ReturnType<typeof fetchHealth>>>(null);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      const result = await fetchHealth();
      if (active) setHealth(result);
    };
    void poll();
    const id = window.setInterval(poll, 30_000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  if (!health) {
    return <p className="text-caption text-muted-foreground">백엔드 연결을 확인하는 중...</p>;
  }
  if (!health.openai_configured) {
    return (
      <p className="text-caption text-warning-foreground" role="status">
        {`백엔드(v${health.version}) 연결됨 — OPENAI_API_KEY 미설정. 음성 인식이 동작하지 않습니다.`}
      </p>
    );
  }
  return (
    <p className="text-caption text-muted-foreground" role="status">
      {`백엔드 v${health.version} · STT=${health.stt.model}, 추출=${health.extractor.model}`}
    </p>
  );
}

const GOALS_QUERY_KEY = ['goals', 'list', 50] as const;

function PlannerTab({ accountKey }: { accountKey: string }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<GoalFormValues>(emptyGoalForm());
  const [saved, setSaved] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [voiceHint, setVoiceHint] = useState<{ kind: 'info' | 'warning'; message: string } | null>(null);
  const goalsQuery = useQuery({
    queryKey: GOALS_QUERY_KEY,
    queryFn: () => listGoals({ limit: 50 }),
    enabled: typeof window !== 'undefined',
  });
  const goals: GoalRead[] = goalsQuery.data ?? [];

  const update = (key: keyof GoalFormValues, value: string) => {
    setSaved(false);
    setVoiceHint(null);
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const createGoalMutation = useMutation({
    mutationFn: createGoal,
    onSuccess: (created) => {
      queryClient.setQueryData<GoalRead[]>(GOALS_QUERY_KEY, (previous) => [created, ...(previous ?? [])]);
    },
  });

  const deleteGoalMutation = useMutation({
    mutationFn: deleteGoalApi,
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: GOALS_QUERY_KEY });
      const previous = queryClient.getQueryData<GoalRead[]>(GOALS_QUERY_KEY);
      queryClient.setQueryData<GoalRead[]>(GOALS_QUERY_KEY, (current) => (current ?? []).filter((goal) => goal.id !== id));
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(GOALS_QUERY_KEY, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: GOALS_QUERY_KEY });
    },
  });

  const refreshGoals = () => queryClient.invalidateQueries({ queryKey: GOALS_QUERY_KEY });

  // The effect deps intentionally include accountKey so a logout/login
  // switch triggers a refetch — `refreshGoals` is stable from react-query.
  useEffect(() => {
    void refreshGoals();
  }, [accountKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleVoiceResult = useCallback(
    async (result: VoiceGoalResponse) => {
      const nextForm: GoalFormValues = {
        exam: result.draft.exam ?? '',
        date: result.draft.date ?? '',
        scope: result.draft.scope ?? '',
        target: result.draft.target ?? '',
      };
      setForm(nextForm);
      setSaved(false);
      if (result.saved && result.goal) {
        queryClient.setQueryData<GoalRead[]>(GOALS_QUERY_KEY, (previous) => [result.goal!, ...(previous ?? [])]);
        setVoiceHint({
          kind: 'info',
          message: `음성으로 인식한 목표를 저장했어요. (신뢰도 ${(result.draft.confidence * 100).toFixed(0)}%)`,
        });
        return;
      }
      if (result.draft.missing_fields.length > 0) {
        setVoiceHint({
          kind: 'warning',
          message: `${result.draft.missing_labels.join(', ')} 항목이 음성에서 인식되지 않았어요. 직접 입력해주세요.`,
        });
      } else if (result.draft.needs_confirmation) {
        setVoiceHint({
          kind: 'warning',
          message: `신뢰도가 낮아 확인이 필요해요. (${(result.draft.confidence * 100).toFixed(0)}%)`,
        });
      } else if (result.draft.provider.startsWith('heuristic')) {
        setVoiceHint({
          kind: 'info',
          message: 'AI 추출에 실패해 규칙 기반으로 채웠어요. 내용을 확인해주세요.',
        });
      } else {
        setVoiceHint(null);
      }
    },
    [queryClient],
  );

  const handleVoiceError = useCallback((message: string) => {
    setVoiceHint({ kind: 'warning', message });
  }, []);

  const { status: voiceStatus, errorMessage: voiceError, start: startVoice, stop: stopVoice } =
    useGoalVoiceCapture({ onResult: handleVoiceResult, onError: handleVoiceError });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    setSubmitError(null);
    if (!form.exam || !form.date || !form.scope || !form.target) {
      setSubmitError('4개 항목을 모두 채워주세요.');
      return;
    }
    try {
      const created = await createGoalMutation.mutateAsync({ ...form, source: 'manual' });
      setForm(emptyGoalForm());
      setVoiceHint(null);
      setSaved(true);
      void created;
    } catch (error) {
      setSubmitError(error instanceof ApiError ? error.message : '목표 저장에 실패했어요.');
    }
  };

  const removeGoal = (id: string) => deleteGoalMutation.mutate(id);

  return (
    <div className="planner-grid">
      <section className="goal-editor" aria-labelledby="goal-form-heading">
        <div className="section-kicker">
          <Target aria-hidden="true" /> 새 목표
        </div>
        <h1 id="goal-form-heading">시험일까지, 할 일을 선명하게.</h1>
        <p className="section-copy">
          시험명·시험일·범위·목표를 한 번에 말하면 자동으로 정리돼요. 빠진 항목만 직접 채워 저장하세요.
        </p>
        <div className="voice-input-bar flex items-center gap-3">
          <Button
            type="button"
            variant={voiceStatus === 'recording' ? 'destructive' : 'outline'}
            size="sm"
            disabled={voiceStatus === 'processing'}
            onClick={voiceStatus === 'recording' ? stopVoice : startVoice}
          >
            {voiceStatus === 'recording' ? (
              <>
                <Square aria-hidden="true" /> 녹음 중지
              </>
            ) : voiceStatus === 'processing' ? (
              '인식 중...'
            ) : (
              <>
                <Mic aria-hidden="true" /> 음성으로 입력
              </>
            )}
          </Button>
          {voiceStatus === 'recording' && (
            <span className="text-caption text-muted-foreground">
              시험명, 시험일, 범위, 목표를 말해주세요
            </span>
          )}
          {voiceError && <span className="text-caption text-danger">{voiceError}</span>}
        </div>
        {voiceHint && (
          <p
            className={
              voiceHint.kind === 'warning' ? 'text-caption text-warning-foreground' : 'text-caption text-muted-foreground'
            }
            role="status"
            aria-live="polite"
          >
            {voiceHint.message}
          </p>
        )}
        <form onSubmit={submit}>
          <FieldGroup className="goal-fields">
            <Field>
              <FieldLabel htmlFor="exam">내가 칠 시험</FieldLabel>
              <Input
                id="exam"
                value={form.exam}
                onChange={(event) => update('exam', event.target.value)}
                placeholder="예: 일반기계기사 필기"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="date">시험일</FieldLabel>
              <Input
                id="date"
                type="date"
                value={form.date}
                onChange={(event) => update('date', event.target.value)}
                required
              />
            </Field>
            <Field className="wide-field">
              <FieldLabel htmlFor="scope">범위</FieldLabel>
              <Textarea
                id="scope"
                value={form.scope}
                onChange={(event) => update('scope', event.target.value)}
                placeholder="과목, 단원, 출제 범위를 적어주세요"
                required
              />
            </Field>
            <Field className="wide-field">
              <FieldLabel htmlFor="target">목표</FieldLabel>
              <Input
                id="target"
                value={form.target}
                onChange={(event) => update('target', event.target.value)}
                placeholder="예: 기출 7개년 2회독"
                required
              />
            </Field>
          </FieldGroup>
          {submitError && (
            <p className="text-caption text-danger" role="alert">
              {submitError}
            </p>
          )}
          <div className="form-footer">
            <span className={saved ? 'save-note is-visible' : 'save-note'}>
              <Check aria-hidden="true" /> 목표가 추가되었어요
            </span>
            <Button type="submit" size="lg" className="save-goal" disabled={createGoalMutation.isPending}>
              {createGoalMutation.isPending ? '저장 중...' : (
                <>
                  목표 만들기 <ArrowRight aria-hidden="true" />
                </>
              )}
            </Button>
          </div>
        </form>
      </section>
      <aside className="goal-list" aria-label="내 시험 목표">
        <div className="goal-list-heading">
          <div>
            <span className="eyebrow">MY GOALS</span>
            <h2>다가오는 시험</h2>
          </div>
          <span className="goal-count">{goals.length}</span>
        </div>
        {goalsQuery.isPending && <p className="text-caption text-muted-foreground">목표를 불러오는 중...</p>}
        {goalsQuery.isError && (
          <p className="text-caption text-danger">
            {(goalsQuery.error instanceof ApiError
              ? goalsQuery.error.message
              : '목표 목록을 불러오지 못했어요.')}
            {' '}
            <button type="button" className="underline underline-offset-2" onClick={() => void refreshGoals()}>
              다시 시도
            </button>
          </p>
        )}
        {!goalsQuery.isPending && !goalsQuery.isError && goals.length === 0 && (
          <p className="text-caption text-muted-foreground">
            아직 등록된 목표가 없어요. 음성으로 한 번에 등록하거나 위 폼에서 직접 추가하세요.
          </p>
        )}
        {goals.map((goal, index) => (
          <article key={goal.id} className={`goal-card ${index === 0 ? 'featured' : ''}`}>
            <div className="goal-card-top">
              <span>D-{Math.max(0, goal.d_day)}</span>
              <div className="flex items-center gap-2">
                {goal.source === 'voice' && (
                  <span className="text-caption text-muted-foreground inline-flex items-center gap-1" title="음성으로 등록됨">
                    <Mic aria-hidden="true" /> 음성
                  </span>
                )}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`${goal.exam} 목표 삭제`}
                  disabled={deleteGoalMutation.isPending && deleteGoalMutation.variables === goal.id}
                  onClick={() => removeGoal(goal.id)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </div>
            <h3>{goal.exam}</h3>
            <time dateTime={goal.date}>{goal.date.replaceAll('-', '. ')}</time>
            <div className="scope-line">
              <BookOpen aria-hidden="true" />
              <p>{goal.scope}</p>
            </div>
            <div className="target-pill">
              <Target aria-hidden="true" />
              {goal.target}
            </div>
          </article>
        ))}
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

function TimeMonthGrid({
  month,
  blocks,
  today,
  variant,
  onBlockClick,
}: {
  month: Date;
  blocks: TimeBlock[];
  today: Date;
  variant: CalendarView;
  onBlockClick?: (id: number) => void;
}) {
  const cells = getMonthCells(month);
  return (
    <div
      className={`calendar-grid calendar-grid--${variant}`}
      role="grid"
      aria-label={`${month.getFullYear()}년 ${MONTHS[month.getMonth()]} 시간 기록`}
    >
      {KOREAN_DAYS.map((day, index) => (
        <div
          key={day}
          className={`weekday ${index === 0 ? 'sunday' : ''} ${index === 6 ? 'saturday' : ''}`}
          role="columnheader"
        >
          {day}
        </div>
      ))}
      {cells.map((date) => {
        const dateKey = isoDate(date);
        const outside = date.getMonth() !== month.getMonth();
        const dayBlocks = outside ? [] : blocks.filter((block) => block.date === dateKey);
        const current = dateKey === isoDate(today);
        return (
          <div
            key={dateKey}
            className={`day-cell ${outside ? 'outside' : ''} ${current ? 'current' : ''}`}
            role="gridcell"
            aria-label={`${date.getMonth() + 1}월 ${date.getDate()}일`}
          >
            <div className="day-number">
              <span>{date.getDate()}</span>
            </div>
            <div className="marker-track">
              {dayBlocks.map((block) => (
                <button
                  key={block.id}
                  type="button"
                  className={`time-block ${block.type}`}
                  style={{
                    left: `${(block.start / 24) * 100}%`,
                    width: `${((block.end - block.start) / 24) * 100}%`,
                  }}
                  title={`${block.label} ${formatHour(block.start)}–${formatHour(block.end)} (클릭해서 조절)`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onBlockClick?.(block.id);
                  }}
                />
              ))}
            </div>
            {variant === 'month' && dayBlocks.length > 0 && (
              <div className="hours-total">
                {dayBlocks
                  .filter((block) => block.type === 'study')
                  .reduce((sum, block) => sum + block.end - block.start, 0)
                  .toFixed(1)}
                h 공부
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function YearMatrix({
  year,
  blocks,
  today,
}: {
  year: number;
  blocks: TimeBlock[];
  today: Date;
}) {
  const days = Array.from({ length: 31 }, (_, index) => index + 1);
  return (
    <div className="year-matrix-wrap">
      <div className="year-matrix" role="grid" aria-label={`${year}년 연간 시간 기록`}>
        <div className="year-corner" role="columnheader">
          월
        </div>
        {days.map((day) => (
          <div key={`heading-${day}`} className="year-day-heading" role="columnheader">
            {day}
          </div>
        ))}
        {MONTHS.map((_, monthIndex) => (
          <div className="year-row" key={monthIndex} role="row">
            <div className="year-month-label" role="rowheader">
              {monthIndex + 1}
            </div>
            {days.map((day) => {
              const date = new Date(year, monthIndex, day);
              const valid = date.getMonth() === monthIndex;
              if (!valid)
                return (
                  <div key={day} className="year-day-cell invalid" aria-hidden="true" />
                );
              const dateKey = isoDate(date);
              const dayBlocks = blocks.filter((block) => block.date === dateKey);
              const current = dateKey === isoDate(today);
              const weekend = date.getDay() === 0 ? 'sunday' : date.getDay() === 6 ? 'saturday' : '';
              return (
                <div
                  key={day}
                  className={`year-day-cell ${weekend} ${current ? 'current' : ''}`}
                  role="gridcell"
                  aria-label={`${monthIndex + 1}월 ${day}일`}
                >
                  {dayBlocks.map((block) => (
                    <div
                      key={block.id}
                      className={`year-time-block ${block.type}`}
                      style={{
                        left: `${(block.start / 24) * 100}%`,
                        width: `${((block.end - block.start) / 24) * 100}%`,
                      }}
                      title={`${block.label} ${formatHour(block.start)}–${formatHour(block.end)}`}
                    />
                  ))}
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
  onSave,
  onDelete,
}: {
  block: TimeBlock;
  onSave: (id: number, patch: Omit<TimeBlock, 'id' | 'date'>) => void;
  onDelete: (id: number) => void;
}) {
  const [type, setType] = useState<TimeBlock['type']>(block.type);
  const [label, setLabel] = useState(block.label);
  const [start, setStart] = useState(hourToTimeValue(block.start));
  const [end, setEnd] = useState(hourToTimeValue(block.end));
  const [error, setError] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const startHour = timeValueToHour(start);
    const endHour = timeValueToHour(end);
    if (endHour <= startHour) {
      setError('종료 시간은 시작 시간보다 늦어야 해요.');
      return;
    }
    onSave(block.id, {
      start: startHour,
      end: endHour,
      type,
      label: label.trim() || BLOCK_TYPE_LABEL[type],
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>시간 기록 조절</DialogTitle>
        <DialogDescription>
          {`${block.date.replaceAll('-', '. ')} 기록을 5분 단위로 조절할 수 있어요.`}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} id="time-block-form">
        <FieldGroup>
          <Field orientation="responsive">
            <FieldLabel htmlFor="block-start">시작</FieldLabel>
            <Input
              id="block-start"
              type="time"
              step={300}
              value={start}
              onChange={(event) => setStart(event.target.value)}
              required
            />
          </Field>
          <Field orientation="responsive">
            <FieldLabel htmlFor="block-end">종료</FieldLabel>
            <Input
              id="block-end"
              type="time"
              step={300}
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              required
            />
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
            <Input
              id="block-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="예: 재료역학"
            />
          </Field>
          {error && <p className="text-caption text-danger">{error}</p>}
        </FieldGroup>
      </form>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onDelete(block.id)}>
          <Trash2 aria-hidden="true" /> 삭제
        </Button>
        <Button type="submit" form="time-block-form">
          저장
        </Button>
      </DialogFooter>
    </>
  );
}

function TimeBlockEditDialog({
  block,
  onOpenChange,
  onSave,
  onDelete,
}: {
  block: TimeBlock | null;
  onOpenChange: (open: boolean) => void;
  onSave: (id: number, patch: Omit<TimeBlock, 'id' | 'date'>) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <Dialog open={block !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {block && (
          <TimeBlockEditForm
            key={block.id}
            block={block}
            onSave={onSave}
            onDelete={onDelete}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

const DEFAULT_BLOCKS: TimeBlock[] = [
  { id: 1, date: '2026-09-01', start: 1.5, end: 7.5, type: 'sleep', label: '수면' },
  { id: 2, date: '2026-09-01', start: 9, end: 11.5, type: 'study', label: '재료역학' },
  { id: 3, date: '2026-09-01', start: 14, end: 17, type: 'study', label: '기출 풀이' },
  { id: 4, date: '2026-09-02', start: 2.5, end: 8, type: 'sleep', label: '수면' },
  { id: 5, date: '2026-09-02', start: 19, end: 22, type: 'study', label: '열역학' },
  { id: 6, date: '2026-09-03', start: 0, end: 6.5, type: 'sleep', label: '수면' },
];

function TimeBlockCreateForm({
  defaultDate,
  onCreate,
}: {
  defaultDate: string;
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
    if (endHour <= startHour) {
      setError('종료 시간은 시작 시간보다 늦어야 해요.');
      return;
    }
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
            <Input
              id="new-block-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </Field>
          <Field orientation="responsive">
            <FieldLabel htmlFor="new-block-start">시작</FieldLabel>
            <Input
              id="new-block-start"
              type="time"
              step={300}
              value={start}
              onChange={(event) => setStart(event.target.value)}
              required
            />
          </Field>
          <Field orientation="responsive">
            <FieldLabel htmlFor="new-block-end">종료</FieldLabel>
            <Input
              id="new-block-end"
              type="time"
              step={300}
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              required
            />
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
            <Input
              id="new-block-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="예: 재료역학"
            />
          </Field>
          {error && <p className="text-caption text-danger">{error}</p>}
        </FieldGroup>
      </form>
      <DialogFooter>
        <Button type="submit" form="time-block-create-form">
          추가
        </Button>
      </DialogFooter>
    </>
  );
}

function TimeBlockCreateDialog({
  open,
  sessionId,
  defaultDate,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  sessionId: number;
  defaultDate: string;
  onOpenChange: (open: boolean) => void;
  onCreate: (block: Omit<TimeBlock, 'id'>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <TimeBlockCreateForm
            key={sessionId}
            defaultDate={defaultDate}
            onCreate={onCreate}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type WeeklyStudyPoint = { key: string; label: string; hours: number; isToday: boolean };

// Sunday-start week, matching the calendar grid's own weekday header order.
function useWeekStudyHours(blocks: TimeBlock[], today: Date): WeeklyStudyPoint[] {
  return useMemo(() => {
    const sunday = new Date(today);
    sunday.setDate(today.getDate() - today.getDay());
    const todayKey = isoDate(today);
    return KOREAN_DAYS.map((label, index) => {
      const date = new Date(sunday);
      date.setDate(sunday.getDate() + index);
      const key = isoDate(date);
      const hours = blocks
        .filter((block) => block.date === key && block.type === 'study')
        .reduce((sum, block) => sum + (block.end - block.start), 0);
      return { key, label, hours: Math.round(hours * 10) / 10, isToday: key === todayKey };
    });
  }, [blocks, today]);
}

function WeeklyChartTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as WeeklyStudyPoint | undefined;
  if (!point) return null;
  return (
    <div className="weekly-chart-tooltip">
      <strong>{point.hours.toFixed(1)}h</strong>
      <span>{`${point.label}요일 · ${point.key.slice(5).replace('-', '.')}`}</span>
    </div>
  );
}

function WeeklyStudyChart({ data }: { data: WeeklyStudyPoint[] }) {
  const total = data.reduce((sum, point) => sum + point.hours, 0);
  return (
    <section className="weekly-chart" aria-label="이번 주 공부 시간">
      <div className="weekly-chart-header">
        <div>
          <span className="eyebrow">THIS WEEK</span>
          <h2>이번 주 공부 시간</h2>
        </div>
        <span className="weekly-chart-total">{total.toFixed(1)}h</span>
      </div>
      <ResponsiveContainer width="100%" height={132}>
        <BarChart data={data} margin={{ top: 22, right: 6, left: 6, bottom: 0 }} barCategoryGap="30%">
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11, fontWeight: 700 }}
          />
          <RechartsTooltip cursor={{ fill: 'var(--accent)' }} content={WeeklyChartTooltip} />
          <Bar dataKey="hours" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false}>
            {data.map((point) => (
              <Cell key={point.key} fill={point.isToday ? '#7c3aed' : '#c4b5fd'} />
            ))}
            <LabelList
              dataKey="hours"
              position="top"
              formatter={(value) => (typeof value === 'number' && value > 0 ? `${value}h` : '')}
              style={{ fill: 'var(--muted-foreground)', fontSize: 11, fontWeight: 700 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}

function CalendarTab({ accountKey }: { accountKey: string }) {
  const today = useMemo(() => new Date(2026, 8, 1), []);
  const [month, setMonth] = useState(new Date(2026, 8, 1));
  const [view, setView] = useState<CalendarView>('month');
  const [prompt, setPrompt] = useState('');
  const [message, setMessage] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [createSessionId, setCreateSessionId] = useState(0);
  const [undoSnapshot, setUndoSnapshot] = useState<TimeBlock[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const blocksStorageKey = `goalsetter:${accountKey}:blocks`;
  const [blocks, setBlocks] = useState<TimeBlock[]>(() =>
    loadJSON(blocksStorageKey, DEFAULT_BLOCKS),
  );
  useEffect(() => {
    saveJSON(blocksStorageKey, blocks);
  }, [blocksStorageKey, blocks]);
  const step = view === 'month' ? 1 : view === 'quarter' ? 3 : 12;
  const shiftMonth = (amount: number) =>
    setMonth((previous) => new Date(previous.getFullYear(), previous.getMonth() + amount * step, 1));
  const quarterStart = Math.floor(month.getMonth() / 3) * 3;
  const visibleMonths =
    view === 'month'
      ? [month]
      : view === 'quarter'
        ? Array.from({ length: 3 }, (_, index) => new Date(month.getFullYear(), quarterStart + index, 1))
        : Array.from({ length: 12 }, (_, index) => new Date(month.getFullYear(), index, 1));
  const heading =
    view === 'month'
      ? `${month.getFullYear()}년 ${MONTHS[month.getMonth()]}`
      : view === 'quarter'
        ? `${month.getFullYear()}년 ${Math.floor(month.getMonth() / 3) + 1}분기`
        : `${month.getFullYear()}년 연력`;
  const addNaturalEntry = async (event: FormEvent) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!text) {
      setMessage('오늘 한 일을 적거나 별 아이콘으로 말해주세요.');
      return;
    }
    setSubmitting(true);
    setMessage('');
    try {
      const result = await parseScheduleText(text, isoDate(today));
      if (result.segments.length === 0) {
        setMessage('시간 기록으로 인식하지 못했어요. 다른 표현으로 다시 적어주세요.');
        return;
      }
      const baseId = Date.now();
      const newBlocks: TimeBlock[] = result.segments.map((segment, index) => ({
        id: baseId + index,
        date: result.date,
        start: timeValueToHour(segment.start),
        end: timeValueToHour(segment.end),
        type: segment.type,
        label: segment.label,
      }));
      setUndoSnapshot(blocks);
      setBlocks((previous) => [...previous, ...newBlocks]);
      setPrompt('');
      setMessage(`${newBlocks.length}개 기록을 추가했어요.`);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : '기록 추가에 실패했어요.');
    } finally {
      setSubmitting(false);
    }
  };
  const editingBlock = blocks.find((block) => block.id === editingId) ?? null;
  const updateBlock = (id: number, patch: Omit<TimeBlock, 'id' | 'date'>) => {
    setUndoSnapshot(null);
    setBlocks((previous) => previous.map((block) => (block.id === id ? { ...block, ...patch } : block)));
    setEditingId(null);
  };
  const deleteBlock = (id: number) => {
    setUndoSnapshot(null);
    setBlocks((previous) => previous.filter((block) => block.id !== id));
    setEditingId(null);
  };
  const openCreate = () => {
    setCreateSessionId((previous) => previous + 1);
    setCreating(true);
  };
  const createBlock = (block: Omit<TimeBlock, 'id'>) => {
    setUndoSnapshot(null);
    setBlocks((previous) => [...previous, { ...block, id: Date.now() }]);
    setCreating(false);
  };

  const applyVoiceTranscript = useCallback((result: VoiceScheduleResponse) => {
    setPrompt(result.transcript);
    setMessage(
      result.transcript
        ? '음성 인식 결과예요. 확인하고 전송을 눌러주세요.'
        : '음성에서 문장을 인식하지 못했어요.',
    );
  }, []);
  // Error text is already surfaced via the hook's own errorMessage
  // (rendered as voiceError below), so onError here is a no-op.
  const { status: voiceStatus, errorMessage: voiceError, start: startVoiceRaw, stop: stopVoice } =
    useScheduleVoiceCapture({ onResult: applyVoiceTranscript, onError: () => {} });
  const startVoice = () => {
    setMessage('');
    startVoiceRaw();
  };
  const weekData = useWeekStudyHours(blocks, today);
  const undoLastEntry = () => {
    if (!undoSnapshot) return;
    setBlocks(undoSnapshot);
    setUndoSnapshot(null);
    setMessage('방금 추가한 기록을 취소했어요.');
  };
  return (
    <section className="calendar-shell" aria-labelledby="calendar-heading">
      <div className="calendar-toolbar">
        <div>
          <span className="eyebrow">TIME MARKER</span>
          <h1 id="calendar-heading">{heading}</h1>
        </div>
        <div className="calendar-actions">
          <div className="view-switch" role="group" aria-label="달력 보기 방식">
            {(
              [
                ['month', '월력'],
                ['quarter', '분기력'],
                ['year', '연력'],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={view === value ? 'secondary' : 'ghost'}
                onClick={() => setView(value)}
                aria-pressed={view === value}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="calendar-controls">
            <Button variant="outline" size="icon" aria-label="이전 기간" onClick={() => shiftMonth(-1)}>
              <ChevronLeft />
            </Button>
            <Button variant="outline" onClick={() => setMonth(new Date(2026, 8, 1))}>
              오늘
            </Button>
            <Button variant="outline" size="icon" aria-label="다음 기간" onClick={() => shiftMonth(1)}>
              <ChevronRight />
            </Button>
          </div>
        </div>
        <div className="calendar-legend" aria-label="시간 기록 범례">
          <span>
            <i className="legend-dot sleep" />
            수면
          </span>
          <span>
            <i className="legend-dot study" />
            공부
          </span>
          <span>
            <i className="legend-dot rest" />
            휴식
          </span>
          <Button size="icon" variant="outline" aria-label="새 시간 기록 추가" onClick={openCreate}>
            <Plus aria-hidden="true" />
          </Button>
        </div>
      </div>
      <WeeklyStudyChart data={weekData} />
      {view === 'month' ? (
        <TimeMonthGrid month={month} blocks={blocks} today={today} variant="month" onBlockClick={setEditingId} />
      ) : view === 'quarter' ? (
        <div className={`multi-calendar multi-calendar--${view}`}>
          {visibleMonths.map((visibleMonth) => (
            <section className="mini-month" key={`${visibleMonth.getFullYear()}-${visibleMonth.getMonth()}`}>
              <h2>{MONTHS[visibleMonth.getMonth()]}</h2>
              <TimeMonthGrid
                month={visibleMonth}
                blocks={blocks}
                today={today}
                variant={view}
                onBlockClick={setEditingId}
              />
            </section>
          ))}
        </div>
      ) : (
        <YearMatrix year={month.getFullYear()} blocks={blocks} today={today} />
      )}
      <form className="command-bar" onSubmit={(event) => void addNaturalEntry(event)}>
        <button
          type="button"
          className={`command-icon ${voiceStatus === 'recording' ? 'recording' : ''}`}
          aria-label={voiceStatus === 'recording' ? '녹음 중지' : '음성으로 기록 추가'}
          disabled={voiceStatus === 'processing' || submitting}
          onClick={voiceStatus === 'recording' ? stopVoice : startVoice}
        >
          {voiceStatus === 'recording' ? <Square aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
        </button>
        <label htmlFor="natural-entry" className="sr-only">
          자연어로 시간 기록 추가
        </label>
        <input
          id="natural-entry"
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
            setMessage('');
          }}
          placeholder={
            voiceStatus === 'recording'
              ? '녹음 중이에요. 오늘 한 일을 말해주세요...'
              : voiceStatus === 'processing'
                ? '인식 중...'
                : '예: 오늘 03:00부터 08:00까지 잤어'
          }
          disabled={voiceStatus === 'recording' || voiceStatus === 'processing'}
        />
        <span className="command-hint">
          {voiceStatus === 'recording' || voiceStatus === 'processing'
            ? '음성 인식 · 다 말하면 별 아이콘을 다시 눌러주세요'
            : '자연어로 기록 · 별 아이콘으로 음성 입력, 전송을 눌러야 반영돼요'}
        </span>
        <Button
          type="submit"
          size="icon"
          aria-label="시간 기록 추가"
          disabled={voiceStatus === 'recording' || voiceStatus === 'processing' || submitting || !prompt.trim()}
        >
          <Send />
        </Button>
        <output className="command-message" aria-live="polite">
          {submitting ? (
            '기록을 추가하는 중...'
          ) : message ? (
            <span className="flex items-center gap-2">
              {message}
              {undoSnapshot && (
                <button type="button" className="underline underline-offset-2" onClick={undoLastEntry}>
                  실행 취소
                </button>
              )}
            </span>
          ) : null}
        </output>
      </form>
      <TimeBlockEditDialog
        block={editingBlock}
        onOpenChange={(open) => !open && setEditingId(null)}
        onSave={updateBlock}
        onDelete={deleteBlock}
      />
      <TimeBlockCreateDialog
        open={creating}
        sessionId={createSessionId}
        defaultDate={isoDate(today)}
        onOpenChange={setCreating}
        onCreate={createBlock}
      />
      {(voiceStatus === 'recording' || voiceStatus === 'processing' || voiceError) && (
        <div className="voice-fab-status" role="status" aria-live="polite">
          {voiceStatus === 'recording' && '오늘 한 일을 말해주세요. 다 되면 버튼을 다시 눌러 정지하세요.'}
          {voiceStatus === 'processing' && '인식 중...'}
          {voiceStatus !== 'recording' && voiceStatus !== 'processing' && voiceError && (
            <span className="text-danger">{voiceError}</span>
          )}
        </div>
      )}
      <button
        type="button"
        className={`voice-fab ${voiceStatus === 'recording' ? 'recording' : ''}`}
        aria-label={voiceStatus === 'recording' ? '녹음 중지' : '음성으로 오늘 기록하기'}
        disabled={voiceStatus === 'processing' || submitting}
        onClick={voiceStatus === 'recording' ? stopVoice : startVoice}
      >
        {voiceStatus === 'recording' ? <Square aria-hidden="true" /> : <Mic aria-hidden="true" />}
      </button>
    </section>
  );
}

const noopSubscribe = () => () => {};
const getServerAuthSnapshot = () => false;

function AuthButton() {
  const loggedIn = useSyncExternalStore(noopSubscribe, isAuthenticated, getServerAuthSnapshot);
  return loggedIn ? (
    <Button asChild className="quick-add" size="lg" variant="outline">
      <a href="/auth/logout">
        <LogOut aria-hidden="true" /> 로그아웃
      </a>
    </Button>
  ) : (
    <Button asChild className="quick-add" size="lg">
      <Link href="/login">
        <LogIn aria-hidden="true" /> 로그인
      </Link>
    </Button>
  );
}

export default function Home() {
  const accountKey = useSyncExternalStore(noopSubscribe, getAccountKey, getServerAccountKey);
  return (
    <main className="app-shell">
      <Tabs defaultValue="planner" className="app-tabs">
        <header className="topbar">
          <a href="#" className="brand" aria-label="Goalsetter 홈">
            <span className="brand-mark">
              <Clock3 aria-hidden="true" />
            </span>
            <span>Goalsetter</span>
          </a>
          <TabsList className="main-nav" aria-label="주요 메뉴">
            <TabsTrigger value="planner">
              <Target aria-hidden="true" />
              목표 계획
            </TabsTrigger>
            <TabsTrigger value="calendar">
              <CalendarDays aria-hidden="true" />
              타임 캘린더
            </TabsTrigger>
          </TabsList>
          <AuthButton />
        </header>
        <div className="content-wrap">
          <TabsContent value="planner">
            <div className="mb-4">
              <ConnectionBanner />
            </div>
            <PlannerTab key={accountKey} accountKey={accountKey} />
          </TabsContent>
          <TabsContent value="calendar">
            <CalendarTab key={accountKey} accountKey={accountKey} />
          </TabsContent>
        </div>
      </Tabs>
    </main>
  );
}
