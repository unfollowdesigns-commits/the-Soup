import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from 'react';
import type {
  LogEntry,
  LogKind,
  PhotoRecipe,
  Recipe,
  Specimen,
  StageId,
  StageState,
} from './types';
import { defaultRecipe, proposeRecipeCode, STAGE_ORDER } from './recipe';
import { applyLook, plainStock, DEFAULT_LOOK, LOOKS, type Look } from './looks';
import { atStrength } from './strength';
import { getMaterial } from './materials';

/* ============================================================
   SESSION STATE
   ============================================================ */

export type Screen = 'enter' | 'import' | 'lab' | 'effects' | 'press' | 'light';

export interface LabState {
  screen: Screen;
  specimen: Specimen | null;
  recipe: PhotoRecipe;
  stack: StageState[];
  log: LogEntry[];
  archive: Recipe[];
  /** material open in the detail reader; null = archive index */
  inspecting: string | null;
  sessionStart: number;
  exportOpen: boolean;
  restoredFrom: string | null;
  /** the look on the bench, kept so one dial can move the whole of it */
  look: { id: string; name: string; plain: PhotoRecipe; full: PhotoRecipe } | null;
  strength: number;
  /** the lab opens plain: one strip of looks and one dial. The rest of
   *  the benches are behind a single door. */
  bench: boolean;
}

const initialStack = (): StageState[] =>
  STAGE_ORDER.map((id) => ({ id, enabled: true }));

const uid = () => Math.random().toString(36).slice(2, 10);

function loadArchive(): Recipe[] {
  try {
    const raw = localStorage.getItem('pml.archive');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Recipe[];
    return Array.isArray(parsed) ? parsed.slice(0, 60) : [];
  } catch {
    return [];
  }
}

function saveArchive(archive: Recipe[]) {
  try {
    localStorage.setItem('pml.archive', JSON.stringify(archive.slice(0, 60)));
  } catch {
    /* the session simply will not persist; the lab still works */
  }
}

export function initialState(): LabState {
  const opening = LOOKS.find((l) => l.id === DEFAULT_LOOK) ?? LOOKS[0];
  return {
    screen: 'enter',
    specimen: null,
    // the bench is never set to "no process": the lab opens on a look so
    // the engine is visibly doing something before anything is touched
    recipe: applyLook(defaultRecipe(), opening),
    stack: initialStack(),
    log: [],
    archive: loadArchive(),
    inspecting: null,
    sessionStart: Date.now(),
    exportOpen: false,
    restoredFrom: null,
    look: opening
      ? { id: opening.id, name: opening.name, plain: plainStock(defaultRecipe(), opening), full: applyLook(defaultRecipe(), opening) }
      : null,
    strength: 1,
    bench: false,
  };
}

/* ============================================================
   ACTIONS
   ============================================================ */

export interface LogSpec {
  kind: LogKind;
  title: string;
  detail: string;
  /** merge into the previous entry when it has the same key (slider drags) */
  coalesce?: string;
}

export type Action =
  | { type: 'screen'; screen: Screen }
  | { type: 'specimen'; specimen: Specimen }
  | { type: 'edit'; mutate: (r: PhotoRecipe) => PhotoRecipe; log?: LogSpec }
  | { type: 'log'; spec: LogSpec }
  | { type: 'inspect'; id: string | null }
  | { type: 'stack:toggle'; id: StageId }
  | { type: 'stack:move'; id: StageId; dir: -1 | 1 }
  | { type: 'stack:remove'; id: StageId }
  | { type: 'stack:restore'; id: StageId }
  | { type: 'archive:add'; name?: string }
  | { type: 'archive:load'; id: string }
  | { type: 'archive:remove'; id: string }
  | { type: 'log:restore'; id: string }
  | { type: 'log:clear' }
  | { type: 'export'; open: boolean }
  | { type: 'look'; look: Look }
  | { type: 'strength'; value: number }
  | { type: 'bench'; open: boolean };

function pushLog(state: LabState, spec: LogSpec, recipe: PhotoRecipe): LogEntry[] {
  const entry: LogEntry = {
    id: uid(),
    at: Date.now(),
    kind: spec.kind,
    title: spec.title,
    detail: spec.detail,
    snapshot: recipe,
  };
  const head = state.log[0];
  if (
    spec.coalesce &&
    head &&
    head.kind === spec.kind &&
    head.title === spec.title &&
    Date.now() - head.at < 4000
  ) {
    return [entry, ...state.log.slice(1)];
  }
  return [entry, ...state.log].slice(0, 200);
}

export function reducer(state: LabState, action: Action): LabState {
  switch (action.type) {
    case 'screen':
      return { ...state, screen: action.screen };

    case 'specimen': {
      // a live camera keeps the lamp on until it is told not to
      state.specimen?.stream?.getTracks().forEach((t) => t.stop());
      const log = pushLog(
        state,
        {
          kind: 'specimen',
          title: 'Specimen Loaded',
          detail: `${action.specimen.name} · ${action.specimen.width} × ${action.specimen.height}`,
        },
        state.recipe,
      );
      return { ...state, specimen: action.specimen, screen: 'lab', log };
    }

    case 'edit': {
      const recipe = action.mutate(state.recipe);
      if (recipe === state.recipe) return state;
      return {
        ...state,
        recipe,
        restoredFrom: null,
        log: action.log ? pushLog(state, action.log, recipe) : state.log,
      };
    }

    case 'log':
      return { ...state, log: pushLog(state, action.spec, state.recipe) };

    case 'inspect':
      return { ...state, inspecting: action.id };

    case 'stack:toggle':
      return {
        ...state,
        stack: state.stack.map((s) =>
          s.id === action.id ? { ...s, enabled: !s.enabled } : s,
        ),
      };

    case 'stack:move': {
      const i = state.stack.findIndex((s) => s.id === action.id);
      const j = i + action.dir;
      if (i < 0 || j < 0 || j >= state.stack.length) return state;
      const stack = state.stack.slice();
      [stack[i], stack[j]] = [stack[j], stack[i]];
      return { ...state, stack };
    }

    case 'stack:remove':
      return { ...state, stack: state.stack.filter((s) => s.id !== action.id) };

    case 'stack:restore': {
      if (state.stack.some((s) => s.id === action.id)) return state;
      const stack = [...state.stack, { id: action.id, enabled: true }];
      stack.sort((a, b) => STAGE_ORDER.indexOf(a.id) - STAGE_ORDER.indexOf(b.id));
      return { ...state, stack };
    }

    case 'archive:add': {
      const code = action.name ?? proposeRecipeCode(state.recipe, state.archive.length + 1);
      const rec: Recipe = {
        id: uid(),
        name: getMaterial(state.recipe.material).name,
        code,
        createdAt: Date.now(),
        materialId: state.recipe.material,
        recipe: structuredClone(state.recipe),
      };
      const archive = [rec, ...state.archive];
      saveArchive(archive);
      return {
        ...state,
        archive,
        log: pushLog(state, { kind: 'archive', title: 'Recipe Archived', detail: code }, state.recipe),
      };
    }

    case 'archive:load': {
      const rec = state.archive.find((r) => r.id === action.id);
      if (!rec) return state;
      return {
        ...state,
        recipe: structuredClone(rec.recipe),
        restoredFrom: rec.code,
        log: pushLog(
          state,
          { kind: 'archive', title: 'Recipe Loaded', detail: rec.code },
          rec.recipe,
        ),
      };
    }

    case 'archive:remove': {
      const archive = state.archive.filter((r) => r.id !== action.id);
      saveArchive(archive);
      return { ...state, archive };
    }

    case 'log:restore': {
      const entry = state.log.find((e) => e.id === action.id);
      if (!entry) return state;
      return {
        ...state,
        recipe: structuredClone(entry.snapshot),
        restoredFrom: `${entry.title} · ${timeOf(entry.at)}`,
      };
    }

    case 'log:clear':
      return { ...state, log: [] };

    case 'export':
      return { ...state, exportOpen: action.open };

    case 'look': {
      const plain = plainStock(state.recipe, action.look);
      const full = applyLook(state.recipe, action.look);
      const recipe = atStrength(plain, full, state.strength);
      return {
        ...state,
        recipe,
        restoredFrom: null,
        look: { id: action.look.id, name: action.look.name, plain, full },
        log: pushLog(
          state,
          { kind: 'material', title: action.look.name, detail: getMaterial(full.material).name },
          recipe,
        ),
      };
    }

    case 'strength': {
      if (!state.look) return state;
      const value = Math.max(0, Math.min(1, action.value));
      return {
        ...state,
        strength: value,
        recipe: atStrength(state.look.plain, state.look.full, value),
        restoredFrom: null,
      };
    }

    case 'bench':
      return { ...state, bench: action.open };
  }
}

export const timeOf = (t: number) =>
  new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export const timeOfSec = (t: number) =>
  new Date(t).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/* ============================================================
   CONTEXT
   ============================================================ */

const StateCtx = createContext<LabState | null>(null);
const DispatchCtx = createContext<Dispatch<Action> | null>(null);

export function LabProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  );
}

export function useLab(): LabState {
  const s = useContext(StateCtx);
  if (!s) throw new Error('useLab must be used inside <LabProvider>');
  return s;
}

export function useDispatch(): Dispatch<Action> {
  const d = useContext(DispatchCtx);
  if (!d) throw new Error('useDispatch must be used inside <LabProvider>');
  return d;
}

/* ------------------------------------------------------------
   useEdit — the single way the UI touches the recipe.
   `commit` writes an entry to the experiment log; live drags do not.
   ------------------------------------------------------------ */
export function useEdit() {
  const dispatch = useDispatch();
  const pending = useRef<LogSpec | null>(null);

  const edit = useCallback(
    (mutate: (r: PhotoRecipe) => PhotoRecipe, log?: LogSpec) => {
      dispatch({ type: 'edit', mutate, log });
    },
    [dispatch],
  );

  /** live value change during a drag — no log entry yet */
  const draft = useCallback(
    (mutate: (r: PhotoRecipe) => PhotoRecipe, log: LogSpec) => {
      pending.current = log;
      dispatch({ type: 'edit', mutate });
    },
    [dispatch],
  );

  /** pointer released — write the log entry once */
  const commit = useCallback(() => {
    const spec = pending.current;
    if (!spec) return;
    pending.current = null;
    dispatch({ type: 'log', spec });
  }, [dispatch]);

  return useMemo(() => ({ edit, draft, commit }), [edit, draft, commit]);
}

export function useStage(id: StageId): boolean {
  const { stack } = useLab();
  return stack.find((s) => s.id === id)?.enabled ?? false;
}
