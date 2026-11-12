import { describe, expect, it } from 'vitest';
import {
  addDays,
  attention,
  completeTask,
  createTask,
  daysUntil,
  deadlineLabel,
  derivedState,
} from './engine';
import { parseCapture } from './capture';
import { makeSampleTasks } from './samples';
import { exportCSV, exportJSON, importTasks } from './transfer';
import type { Task } from './types';

const DAY = '2026-03-10';

function make(title: string, patch: Partial<Task> = {}): Task {
  return createTask({ title, nextAction: 'Do the first physical step.', ...patch }, DAY);
}

describe('local calendar engine', () => {
  it('uses local calendar boundaries rather than UTC timestamps', () => {
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(daysUntil('2026-03-11', DAY)).toBe(1);
    expect(daysUntil('2026-03-09', DAY)).toBe(-1);
  });

  it('creates an inbox item without a next action and labels absent deadlines calmly', () => {
    const task = createTask({ title: 'Collect thoughts' }, DAY);
    expect(task.state).toBe('inbox');
    expect(task.reviewDate).toBe('2026-03-17');
    expect(deadlineLabel(task, DAY)).toBe('No deadline');
  });

  it('blocks incomplete and missing prerequisites, then releases completed work', () => {
    const prerequisite = make('Get measurements');
    const dependent = make('Order replacement part', { dependencies: [prerequisite.id] });
    expect(derivedState(dependent, [prerequisite, dependent], DAY)).toBe('blocked');

    const done = { ...prerequisite, state: 'done' as const, completedAt: `${DAY}T12:00:00` };
    expect(derivedState(dependent, [done, dependent], DAY)).toBe('ready');
    expect(derivedState({ ...dependent, dependencies: ['missing'] }, [dependent], DAY)).toBe('blocked');
  });

  it('completes a recurrence once and schedules its next instance after completion', () => {
    const recurring = make('Inspect van tyres', {
      repeatDays: 14,
      deadline: '2026-03-12',
      startDate: '2026-03-11',
      reviewDate: '2026-03-11',
      dependencies: ['old-completed-prerequisite'],
      checklist: [{ id: 'check-tyres', text: 'Check tread', done: true }],
    });
    const completed = completeTask([recurring], recurring.id, DAY);
    expect(completed).toHaveLength(2);
    expect(completed[0].state).toBe('done');
    expect(completed[0].history.at(-1)?.text).toBe('Completed task.');
    expect(completed[1]).toMatchObject({
      state: 'ready',
      deadline: '2026-03-24',
      startDate: '2026-03-24',
      reviewDate: '2026-03-24',
      dependencies: [],
      completedAt: null,
    });
    expect(completed[1].checklist[0].done).toBe(false);
    expect(completeTask(completed, recurring.id, DAY)).toHaveLength(2);
  });
});

describe('attention', () => {
  it('caps recommendations while commitments overflow independently of filters', () => {
    const tasks = Array.from({ length: 7 }, (_, index) =>
      make(`Commitment ${index + 1}`, {
        deadline: DAY,
        context: index === 0 ? 'home' : 'computer',
        estimate: 20,
      }),
    );
    const result = attention(tasks, { now: DAY, context: 'home', minutes: 5 });
    expect(result.items).toHaveLength(0); // no action is short enough for this filter
    expect(result.items.length).toBeLessThanOrEqual(5);
    expect(result.commitments).toHaveLength(7);
    expect(result.commitments.map((task) => task.id)).toEqual([...result.commitments].map((task) => task.id).sort());
  });

  it('keeps a due review and a sustained undated task where possible without false urgency', () => {
    const dueReview = make('Review a parked supplier choice', { reviewDate: DAY });
    const importantUndated = make('Clear garage shelf', { pattern: 'sustained', deadline: null });
    const urgent = Array.from({ length: 5 }, (_, index) =>
      make(`Urgent ${index}`, { deadline: DAY, reviewDate: '2026-03-20' }),
    );
    const result = attention([...urgent, dueReview, importantUndated], { now: DAY });
    expect(result.items.some((item) => item.task.id === dueReview.id && item.kind === 'review')).toBe(true);
    const garage = result.items.find((item) => item.task.id === importantUndated.id);
    expect(garage?.reason.toLowerCase()).not.toContain('due');
  });

  it('only offers waiting work as a due follow-up and blocked work as review', () => {
    const waiting = make('Permit response', {
      state: 'waiting',
      waitingFor: 'Mara',
      reviewDate: DAY,
      nextAction: '',
    });
    const blocked = make('Publish page', { state: 'blocked', reviewDate: DAY, dependencies: ['missing'] });
    const result = attention([waiting, blocked], { now: DAY });
    expect(result.items.map((item) => item.kind)).toEqual(expect.arrayContaining(['followup', 'review']));
    expect(result.items.some((item) => item.kind === 'action')).toBe(false);
  });
});

describe('samples and capture', () => {
  it('makes exact volume scenarios and keeps quiet work free of near commitments', () => {
    expect(makeSampleTasks('few', DAY)).toHaveLength(5);
    expect(makeSampleTasks('fifty', DAY)).toHaveLength(50);
    expect(makeSampleTasks('twohundred', DAY)).toHaveLength(200);
    expect(makeSampleTasks('fivehundred', DAY)).toHaveLength(500);
    const quiet = makeSampleTasks('quiet', DAY);
    expect(attention(quiet, { now: DAY }).commitments).toHaveLength(0);
    expect(quiet.some((task) => task.pattern === 'sustained' && task.deadline === null)).toBe(true);
  });

  it('parses only explicit capture grammar and preserves casual date wording', () => {
    const parsed = parseCapture('Call plumber #home due Friday 20 minutes next: measure washer', DAY);
    expect(parsed).toMatchObject({
      title: 'Call plumber',
      context: 'home',
      deadline: '2026-03-13',
      estimate: 20,
      nextAction: 'measure washer',
    });
    expect(parsed).not.toHaveProperty('area');
    // The word "important" is no longer a hidden flag: it stays in the title.
    expect(parseCapture('Important call to the bank', DAY).title).toBe('Important call to the bank');
    const casual = parseCapture('Call plumber tomorrow when free', DAY);
    expect(casual.deadline).toBeNull();
    expect(casual.title).toBe('Call plumber tomorrow when free');
    expect(parseCapture('Await reply waiting for Mara', DAY)).toMatchObject({
      state: 'waiting',
      waitingFor: 'Mara',
      title: 'Await reply',
    });
  });
});

describe('portable transfer', () => {
  it('imports JSON additively with fresh IDs and remapped internal prerequisites', () => {
    const first = make('Draft quote');
    const second = make('Send quote', { dependencies: [first.id] });
    const existing = [make('Existing')];
    const imported = importTasks(exportJSON([first, second]), 'json', existing);
    expect(imported).toHaveLength(2);
    expect(imported.map((task) => task.id)).not.toEqual([first.id, second.id]);
    expect(imported[1].dependencies).toEqual([imported[0].id]);
    expect(existing).toHaveLength(1);
  });

  it('round-trips CSV commas, newlines, and formula-looking strings safely', () => {
    const source = make('=SUM(A1:A2)', { notes: 'first line\nsecond, line' });
    const csv = exportCSV([source]);
    expect(csv).toContain("'=SUM(A1:A2)");
    const imported = importTasks(csv, 'csv', []);
    expect(imported[0]).toMatchObject({ title: '=SUM(A1:A2)', notes: 'first line\nsecond, line' });
    expect(imported[0].checklist).toEqual([]);
    expect(imported[0].history).toEqual([]);
  });

  it('rejects invalid imports atomically instead of dropping bad dependencies', () => {
    const source = make('Bad prerequisite', { dependencies: ['not-present'] });
    expect(() => importTasks(exportJSON([source]), 'json', [])).toThrow(/unknown dependency/i);
    const left = make('Cycle left', { id: 'cycle-left', dependencies: ['cycle-right'] });
    const right = make('Cycle right', { id: 'cycle-right', dependencies: ['cycle-left'] });
    expect(() => importTasks(exportJSON([left, right]), 'json', [])).toThrow(/cycle/i);
    const csv = exportCSV([make('CSV validation')]).replace(',ready,', ',not-a-state,');
    expect(() => importTasks(csv, 'csv', [])).toThrow(/unsupported value/i);
    expect(() => importTasks('{"version":1,"tasks":[]}', 'json', [])).not.toThrow();
  });
});
