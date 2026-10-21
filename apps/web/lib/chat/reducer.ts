// The state of a conversation as events arrive. Pure, so every state of a turn can be tested without a browser.
// State machine of one turn (DESIGN.md 8.4):  sending -> streaming -> done | error | stopped.
import type { Answer, DonePayload, RedFlag, ServerEvent, Source, StepName, Turn, TurnError } from "./types.ts";

export type ChatState = { conversationId: string; turns: Turn[] };

export type Action =
  | { type: "start"; id: string; text: string }
  | { type: "event"; id: string; event: ServerEvent }
  | { type: "device_flag"; id: string; flag: RedFlag }
  | { type: "fail"; id: string; error: TurnError }
  | { type: "stop"; id: string }
  | { type: "retry"; id: string }
  | { type: "load"; conversationId: string; turns: Turn[] }
  | { type: "reset"; conversationId: string };

export function newTurn(id: string, userText: string): Turn {
  return {
    id,
    userText,
    status: "sending",
    steps: { read: "pending", safety: "pending", medlineplus: "pending", fda: "pending", write: "pending" },
    redFlag: null,
    sources: [],
    sourcesArrived: false,
    fields: {},
    messageId: null,
    done: null,
    error: null,
  };
}

export const initialState = (conversationId: string): ChatState => ({ conversationId, turns: [] });

const LEVEL_RANK = { emergency: 1, ambulance: 2 } as const;

function applyEvent(turn: Turn, event: ServerEvent): Turn {
  switch (event.event) {
    case "meta":
      return { ...turn, status: "streaming", messageId: event.data.message_id };
    case "status": {
      const steps = { ...turn.steps, [event.data.step]: event.data.state } as Record<StepName, Turn["steps"][StepName]>;
      return { ...turn, status: turn.status === "sending" ? "streaming" : turn.status, steps };
    }
    case "red_flag": {
      const incoming: RedFlag = event.data;
      const current = turn.redFlag;
      // The more serious flag wins, and a crisis flag is never replaced by a plain one.
      if (current && (current.crisis || (!incoming.crisis && LEVEL_RANK[current.level] >= LEVEL_RANK[incoming.level]))) return turn;
      return { ...turn, redFlag: incoming };
    }
    case "sources":
      return { ...turn, sources: event.data as Source[], sourcesArrived: true };
    case "field":
      return { ...turn, fields: { ...turn.fields, [event.data.name]: event.data.value } as Partial<Answer> };
    case "done": {
      const done: DonePayload = event.data;
      // Whatever was still "active" has finished; steps never go back.
      const steps = Object.fromEntries(Object.entries(turn.steps).map(([name, state]) => [name, state === "active" ? "done" : state])) as Turn["steps"];
      return { ...turn, status: "done", done, messageId: done.message_id, steps, error: null };
    }
    case "error":
      return {
        ...turn,
        status: "error",
        error: { code: event.data.code, message: event.data.message, retryable: event.data.retryable, extra: {} },
      };
    default:
      return turn;
  }
}

const mapTurn = (state: ChatState, id: string, change: (turn: Turn) => Turn): ChatState => ({
  ...state,
  turns: state.turns.map((turn) => (turn.id === id ? change(turn) : turn)),
});

export function chatReducer(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case "start":
      if (state.turns.some((turn) => turn.id === action.id)) return state;
      return { ...state, turns: [...state.turns, newTurn(action.id, action.text)] };
    case "event":
      return mapTurn(state, action.id, (turn) => applyEvent(turn, action.event));
    case "device_flag":
      return mapTurn(state, action.id, (turn) => (turn.redFlag ? turn : { ...turn, redFlag: action.flag }));
    case "fail":
      return mapTurn(state, action.id, (turn) => (turn.status === "done" ? turn : { ...turn, status: "error", error: action.error }));
    case "stop":
      return mapTurn(state, action.id, (turn) => (turn.status === "sending" || turn.status === "streaming" ? { ...turn, status: "stopped" } : turn));
    case "retry":
      return mapTurn(state, action.id, (turn) => ({ ...newTurn(turn.id, turn.userText), redFlag: turn.redFlag }));
    case "load":
      return { conversationId: action.conversationId, turns: action.turns };
    case "reset":
      return initialState(action.conversationId);
    default:
      return state;
  }
}

export const isBusy = (state: ChatState): boolean => state.turns.some((turn) => turn.status === "sending" || turn.status === "streaming");

/**
 * How many turns have ended in a way that may have created or changed a saved chat: a saved answer, or one cut off or
 * stopped (the server keeps writing and saves it anyway). The chat screen refreshes Recents when this changes, so a chat
 * whose answer was cut while the phone had the app in the background still gets into the list.
 */
export const settledTurns = (turns: Turn[]): number =>
  turns.filter((turn) => (turn.status === "done" && turn.done?.saved && !turn.done.replayed) || turn.status === "error" || turn.status === "stopped").length;

export function stepsToShow(turn: Turn): StepName[] {
  // The FDA step is only shown when a medicine was part of the question.
  return (["read", "safety", "medlineplus", "fda", "write"] as StepName[]).filter((step) => !(step === "fda" && turn.steps.fda === "skipped"));
}
