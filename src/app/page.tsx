'use client';

import { FormEvent, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, LogIn, LogOut, Send, Sparkles, Target, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { getAccountKey, getServerAccountKey, isAuthenticated } from '@/lib/auth';
import { loadJSON, saveJSON } from '@/lib/storage';

type Goal = { id: number; exam: string; date: string; scope: string; target: string };
type TimeBlock = { id: number; date: string; start: number; end: number; type: 'sleep' | 'study'; label: string };
const KOREAN_DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const hourValue = (hour: string, minute: string) => Number(hour) + Number(minute || 0) / 60;
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

function parseNaturalEntry(text: string, fallback: Date): Omit<TimeBlock, 'id'> | null {
  const matches = [...text.matchAll(/(\d{1,2})(?::(\d{2}))?/g)];
  if (matches.length < 2) return null;
  const start = hourValue(matches[0][1], matches[0][2] ?? '0');
  const end = hourValue(matches[1][1], matches[1][2] ?? '0');
  if (start > 24 || end > 24 || start === end) return null;
  const entryDate = new Date(fallback);
  if (/어제|yesterday/i.test(text)) entryDate.setDate(entryDate.getDate() - 1);
  if (/내일|tomorrow/i.test(text)) entryDate.setDate(entryDate.getDate() + 1);
  const type = /수면|잠|잤|sleep/i.test(text) ? 'sleep' : 'study';
  return { date: isoDate(entryDate), start, end: end < start ? 24 : end, type, label: type === 'sleep' ? '수면' : '공부' };
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
  return (
    <div className="planner-grid">
      <section className="goal-editor" aria-labelledby="goal-form-heading">
        <div className="section-kicker"><Target aria-hidden="true" /> 새 목표</div>
        <h1 id="goal-form-heading">시험일까지, 할 일을 선명하게.</h1>
        <p className="section-copy">시험과 범위를 적으면 실행 가능한 공부 목표의 시작점이 만들어집니다.</p>
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
          const days = Math.max(0, Math.ceil((new Date(`${goal.date}T00:00:00`).getTime() - new Date('2026-09-01T00:00:00').getTime()) / 86400000));
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
    if (endHour <= startHour) { setError('종료 시간은 시작 시간보다 늦어야 해요.'); return; }
    onSave(block.id, { start: startHour, end: endHour, type, label: label.trim() || (type === 'sleep' ? '수면' : '공부') });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>시간 기록 조절</DialogTitle>
        <DialogDescription>{`${block.date.replaceAll('-', '. ')} 기록을 5분 단위로 조절할 수 있어요.`}</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} id="time-block-form">
        <FieldGroup>
          <Field orientation="responsive">
            <FieldLabel htmlFor="block-start">시작</FieldLabel>
            <Input id="block-start" type="time" step={300} value={start} onChange={(event) => setStart(event.target.value)} required />
          </Field>
          <Field orientation="responsive">
            <FieldLabel htmlFor="block-end">종료</FieldLabel>
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
        {block && <TimeBlockEditForm key={block.id} block={block} onSave={onSave} onDelete={onDelete} />}
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
const blocksStorageKey = (accountKey: string) => `goalsetter:${accountKey}:blocks`;

function CalendarTab({ accountKey }: { accountKey: string }) {
  const today = useMemo(() => new Date(2026, 8, 1), []);
  const [month, setMonth] = useState(new Date(2026, 8, 1));
  const [view, setView] = useState<CalendarView>('month');
  const [prompt, setPrompt] = useState(''); const [message, setMessage] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
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
    setBlocks((previous) => [...previous, { ...parsed, id: Date.now() }]); setPrompt(''); setMessage(`${parsed.label} ${formatHour(parsed.start)}–${formatHour(parsed.end)} 기록을 추가했어요.`);
  };
  const editingBlock = blocks.find((block) => block.id === editingId) ?? null;
  const updateBlock = (id: number, patch: Omit<TimeBlock, 'id' | 'date'>) => {
    setBlocks((previous) => previous.map((block) => (block.id === id ? { ...block, ...patch } : block)));
    setEditingId(null);
  };
  const deleteBlock = (id: number) => {
    setBlocks((previous) => previous.filter((block) => block.id !== id));
    setEditingId(null);
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
        <div className="calendar-legend" aria-label="시간 기록 범례"><span><i className="legend-dot sleep" />수면</span><span><i className="legend-dot study" />공부</span></div>
      </div>
      {view === 'month' ? <TimeMonthGrid month={month} blocks={blocks} today={today} variant="month" onBlockClick={setEditingId} /> : view === 'quarter' ? (
        <div className={`multi-calendar multi-calendar--${view}`}>
          {visibleMonths.map((visibleMonth) => <section className="mini-month" key={`${visibleMonth.getFullYear()}-${visibleMonth.getMonth()}`}><h2>{MONTHS[visibleMonth.getMonth()]}</h2><TimeMonthGrid month={visibleMonth} blocks={blocks} today={today} variant={view} onBlockClick={setEditingId} /></section>)}
        </div>
      ) : <YearMatrix year={month.getFullYear()} blocks={blocks} today={today} />}
      <form className="command-bar" onSubmit={addNaturalEntry}><div className="command-icon"><Sparkles aria-hidden="true" /></div><label htmlFor="natural-entry" className="sr-only">자연어로 시간 기록 추가</label><input id="natural-entry" value={prompt} onChange={(event) => { setPrompt(event.target.value); setMessage(''); }} placeholder="예: 오늘 03:00부터 08:00까지 잤어" /><span className="command-hint">자연어로 기록</span><Button type="submit" size="icon" aria-label="시간 기록 추가"><Send /></Button><output className="command-message" aria-live="polite">{message}</output></form>
      <TimeBlockEditDialog block={editingBlock} onOpenChange={(open) => !open && setEditingId(null)} onSave={updateBlock} onDelete={deleteBlock} />
    </section>
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
  return <main className="app-shell"><Tabs defaultValue="planner" className="app-tabs"><header className="topbar"><a href="#" className="brand" aria-label="Goalsetter 홈"><span className="brand-mark"><Clock3 aria-hidden="true" /></span><span>Goalsetter</span></a><TabsList className="main-nav" aria-label="주요 메뉴"><TabsTrigger value="planner"><Target aria-hidden="true" />목표 계획</TabsTrigger><TabsTrigger value="calendar"><CalendarDays aria-hidden="true" />타임 캘린더</TabsTrigger></TabsList><AuthButton /></header><div className="content-wrap"><TabsContent value="planner"><PlannerTab key={accountKey} accountKey={accountKey} /></TabsContent><TabsContent value="calendar"><CalendarTab key={accountKey} accountKey={accountKey} /></TabsContent></div></Tabs></main>;
}