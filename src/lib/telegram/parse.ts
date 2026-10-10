/**
 * Telegram bot message → workout or command. Pure.
 *
 * «30» → the first favourite exercise; «30 приседания» / «приседания 30» / «squats 30»;
 * «планка 60» / «планка 1:30» (seconds); «бег 5.2» / «бег 5,2 26:30» (km → metres, optional time);
 * «жим 10 24кг» / «жим 10 24» (reps + kg for exercises with a kettlebell);
 * «/start <code>», «/today@Bot», «сегодня», «помощь». Anything else → `null` (the bot answers with /help).
 *
 * Values are not range-checked here: `createWorkoutForUser` validates them like any other input.
 */
import { EXERCISES, EXERCISE_IDS, getExercise, resolveFavoriteExercises, type ExerciseType } from '../exercises';
import { parseDurationInput } from '../workout-input';

export type ParsedWorkout = { exerciseType: ExerciseType; value: number; loadKg?: number; durationSeconds?: number };
export type ParsedCommand = { command: string; arg?: string };
export type ParsedMessage = ParsedWorkout | ParsedCommand;

export function isParsedCommand(parsed: ParsedMessage): parsed is ParsedCommand {
  return 'command' in parsed;
}

/** Extra names besides the catalog labels: each alias is a list of word prefixes (same word count as the phrase). */
const EXTRA_ALIASES: Partial<Record<ExerciseType, string[]>> = {
  pushups: ['отжим', 'push', 'pushup'],
  pullups: ['подтяг', 'pull', 'pullup'],
  crunches: ['скручив', 'пресс', 'crunch'],
  squats: ['присед', 'squat'],
  plank: ['планк', 'plank'],
  dips: ['брус', 'dip', 'отжим на брус'],
  hanging_leg_raises: ['подъем ног', 'ноги в вис', 'leg raise'],
  muscle_ups: ['выход', 'выход сил', 'muscle', 'muscleup'],
  lunges: ['выпад', 'lunge'],
  burpees: ['берпи', 'burpee'],
  jump_rope: ['скакалк', 'rope', 'jump rope'],
  wall_sit: ['стульчик', 'wall sit'],
  kettlebell_press: ['жим', 'жим гир', 'press'],
  kettlebell_jerk: ['толч', 'толч гир', 'jerk'],
  kettlebell_swing: ['мах', 'мах гир', 'swing'],
  run: ['бег', 'пробеж', 'run'],
  bike: ['велосипед', 'вело', 'bike', 'cycl'],
  row: ['гребл', 'row'],
};

const COMMAND_WORDS: Record<string, string> = {
  сегодня: 'today',
  итог: 'today',
  итоги: 'today',
  today: 'today',
  помощь: 'help',
  справка: 'help',
  help: 'help',
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

const ALIASES: Array<{ exerciseType: ExerciseType; words: string[] }> = EXERCISE_IDS.flatMap((id) => {
  const names = [EXERCISES[id].label.ru, EXERCISES[id].label.en, ...(EXTRA_ALIASES[id] ?? [])];
  return names.map((name) => ({ exerciseType: id, words: normalize(name).split(' ') }));
});

function matchExercise(words: string[]): ExerciseType | null {
  let best: { exerciseType: ExerciseType; score: number } | null = null;
  for (const alias of ALIASES) {
    if (alias.words.length !== words.length) continue;
    if (!alias.words.every((stem, i) => words[i].startsWith(stem))) continue;
    const score = alias.words.join('').length;
    if (!best || score > best.score) best = { exerciseType: alias.exerciseType, score };
  }
  return best?.exerciseType ?? null;
}

type Token =
  | { kind: 'int'; value: number }
  | { kind: 'decimal'; value: number }
  | { kind: 'kg'; value: number }
  | { kind: 'km'; value: number }
  | { kind: 'sec'; value: number }
  | { kind: 'time'; value: number }
  | { kind: 'word'; value: string };

const UNIT_GLUE = /(\d)\s+(кг|kg|км|km|сек|с|sec|s)(?=\s|$)/g;
const NUMBER = '\\d+(?:[.,]\\d+)?';

function toNumber(text: string): number {
  return Number(text.replace(',', '.'));
}

function tokenize(text: string): Token[] | null {
  const tokens: Token[] = [];
  for (const part of text.replace(UNIT_GLUE, '$1$2').split(' ')) {
    let m: RegExpExecArray | null;
    if (/^\d+$/.test(part)) tokens.push({ kind: 'int', value: Number(part) });
    else if (new RegExp(`^${NUMBER}$`).test(part)) tokens.push({ kind: 'decimal', value: toNumber(part) });
    else if ((m = new RegExp(`^(${NUMBER})(?:кг|kg)$`).exec(part))) tokens.push({ kind: 'kg', value: toNumber(m[1]) });
    else if ((m = new RegExp(`^(${NUMBER})(?:км|km)$`).exec(part))) tokens.push({ kind: 'km', value: toNumber(m[1]) });
    else if ((m = /^(\d+)(?:сек|с|sec|s)$/.exec(part))) tokens.push({ kind: 'sec', value: Number(m[1]) });
    else if (/^\d+(?::\d+){1,2}$/.test(part)) {
      const parsed = parseDurationInput(part);
      if (!parsed.ok || parsed.value == null) return null;
      tokens.push({ kind: 'time', value: parsed.value });
    } else if (/^[a-zа-я][a-zа-я-]*$/.test(part)) tokens.push({ kind: 'word', value: part });
    else return null;
  }
  return tokens;
}

function parseCommand(text: string): ParsedCommand | null {
  const m = /^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s+(\S.*))?$/i.exec(text.trim());
  if (!m) return null;
  const command = m[1].toLowerCase();
  const arg = m[2]?.trim();
  return arg ? { command, arg } : { command };
}

/** Value tokens of one workout for the exercise's unit, or `null` when they do not fit it. */
function readValue(exerciseType: ExerciseType, numbers: Token[]): ParsedWorkout | null {
  const exercise = getExercise(exerciseType);
  const of = (kind: Token['kind']) => numbers.filter((t) => t.kind === kind) as Array<{ kind: string; value: number }>;
  const only = (...kinds: Array<Token['kind']>) => numbers.every((t) => kinds.includes(t.kind));

  if (exercise.unit === 'distance') {
    if (!only('int', 'decimal', 'km', 'time')) return null;
    const distance = numbers.filter((t) => t.kind !== 'time') as Array<{ value: number }>;
    const times = of('time');
    if (distance.length !== 1 || times.length > 1) return null;
    const out: ParsedWorkout = { exerciseType, value: Math.round(distance[0].value * 1000) };
    if (times.length) out.durationSeconds = times[0].value;
    return out;
  }

  if (exercise.unit === 'seconds') {
    if (numbers.length !== 1 || !only('int', 'sec', 'time')) return null;
    return { exerciseType, value: (numbers[0] as { value: number }).value };
  }

  if (exercise.load) {
    if (!only('int', 'decimal', 'kg')) return null;
    const ints = of('int');
    const explicitKg = [...of('kg'), ...of('decimal')];
    if (!ints.length || ints.length > 2 || explicitKg.length > 1 || ints.length + explicitKg.length > 2) return null;
    const out: ParsedWorkout = { exerciseType, value: ints[0].value };
    const kg = explicitKg[0]?.value ?? ints[1]?.value;
    if (kg !== undefined) out.loadKg = kg;
    return out;
  }

  if (numbers.length !== 1 || numbers[0].kind !== 'int') return null;
  return { exerciseType, value: numbers[0].value };
}

export function parseWorkoutMessage(text: string, favorites: readonly string[]): ParsedMessage | null {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return null;
  if (raw.startsWith('/')) return parseCommand(raw);

  const normalized = normalize(raw);
  const commandWord = COMMAND_WORDS[normalized];
  if (commandWord) return { command: commandWord };

  const tokens = tokenize(normalized);
  if (!tokens) return null;
  const words = tokens.filter((t) => t.kind === 'word').map((t) => t.value as string);
  const numbers = tokens.filter((t) => t.kind !== 'word');
  if (!numbers.length) return null;

  const exerciseType = words.length ? matchExercise(words) : resolveFavoriteExercises(favorites)[0];
  if (!exerciseType) return null;
  return readValue(exerciseType, numbers);
}
