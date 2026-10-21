// Which chat opens when the app starts (founder, 2026-10-20): a new one on a fresh start or after a long time away;
// the same one after moving between screens or a reload.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AWAY_MS,
  forgetOpenChat,
  HIDDEN_AT_KEY,
  LEGACY_KEY,
  noteHidden,
  noteVisible,
  OPEN_CHAT_KEY,
  readOpenChat,
  rememberOpenChat,
} from "../lib/chat/open-chat.ts";

function fakeStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => void data.set(key, String(value)),
    removeItem: (key) => void data.delete(key),
  };
}
const ME = "11111111-1111-4111-8111-111111111111";
const SOMEONE_ELSE = "22222222-2222-4222-8222-222222222222";
const CHAT = "33333333-3333-4333-8333-333333333333";
const NOW = Date.UTC(2026, 9, 20, 9, 0);

test("a fresh start (nothing kept for this visit) opens a new chat, even if an old copy sits in localStorage", () => {
  const session = fakeStore();
  const local = fakeStore({ [LEGACY_KEY]: CHAT });
  assert.equal(readOpenChat(session, ME, NOW), null);
  forgetOpenChat(null, local);
  assert.equal(local.getItem(LEGACY_KEY), null, "the old long-lived copy is dropped");
});

test("moving between screens or reloading in the same visit reopens the chat that was open", () => {
  const session = fakeStore();
  rememberOpenChat(session, ME, CHAT);
  assert.equal(readOpenChat(session, ME, NOW), CHAT);
  // Away for a short while (another app, a phone call): still the same chat.
  noteHidden(session, NOW);
  assert.equal(noteVisible(session, NOW + AWAY_MS - 1), false);
  assert.equal(readOpenChat(session, ME, NOW + AWAY_MS), CHAT);
  assert.equal(session.getItem(HIDDEN_AT_KEY), null, "coming back clears the away mark");
});

test("coming back after 30 minutes or more away starts fresh; the chat itself is not touched", () => {
  const session = fakeStore();
  rememberOpenChat(session, ME, CHAT);
  noteHidden(session, NOW);
  assert.equal(noteVisible(session, NOW + AWAY_MS), true, "the chat screen is told to start fresh");
  assert.equal(readOpenChat(session, ME, NOW + AWAY_MS), null);
});

test("a page the phone threw away while hidden, then reloaded on return, also starts fresh after a long time", () => {
  const session = fakeStore();
  rememberOpenChat(session, ME, CHAT);
  noteHidden(session, NOW);
  // No "visible" event: the page simply loads again with its sessionStorage.
  assert.equal(readOpenChat(session, ME, NOW + 2 * AWAY_MS), null);
  assert.equal(session.getItem(HIDDEN_AT_KEY), null);
  assert.equal(session.getItem(OPEN_CHAT_KEY), null);
});

test("a long stretch of use is not mistaken for time away", () => {
  const session = fakeStore();
  rememberOpenChat(session, ME, CHAT);
  noteHidden(session, NOW);
  noteVisible(session, NOW + 60_000);
  assert.equal(readOpenChat(session, ME, NOW + 3 * AWAY_MS), CHAT, "an hour on other screens, never hidden");
});

test("the open chat is never reopened for someone else signing in on this device", () => {
  const session = fakeStore();
  rememberOpenChat(session, ME, CHAT);
  assert.equal(readOpenChat(session, SOMEONE_ELSE, NOW), null);
});

test("a new chat, signing out or deleting forgets it; broken or blocked storage just means a new chat", () => {
  const session = fakeStore();
  rememberOpenChat(session, ME, CHAT);
  rememberOpenChat(session, ME, null);
  assert.equal(readOpenChat(session, ME, NOW), null);
  rememberOpenChat(session, null, CHAT);
  assert.equal(readOpenChat(session, ME, NOW), null, "nothing is kept without knowing whose it is");

  rememberOpenChat(session, ME, CHAT);
  const local = fakeStore({ [LEGACY_KEY]: CHAT });
  forgetOpenChat(session, local);
  assert.deepEqual([readOpenChat(session, ME, NOW), local.getItem(LEGACY_KEY)], [null, null]);

  assert.equal(readOpenChat(fakeStore({ [OPEN_CHAT_KEY]: "{not json" }), ME, NOW), null);
  assert.equal(readOpenChat(null, ME, NOW), null);
  const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.equal(readOpenChat(throwing, ME, NOW), null);
  assert.doesNotThrow(() => rememberOpenChat(throwing, ME, CHAT));
  assert.doesNotThrow(() => noteHidden(throwing, NOW));
  assert.equal(noteVisible(throwing, NOW), false);
  assert.doesNotThrow(() => forgetOpenChat(throwing, throwing));
});

import { settledTurns } from "../lib/chat/reducer.ts";

test("Recents refreshes when an answer ends in any way the server may have saved it, cut off and stopped included", () => {
  const turn = (status, done = null) => ({ status, done });
  const saved = { saved: true, replayed: false };
  assert.equal(settledTurns([]), 0);
  assert.equal(settledTurns([turn("sending"), turn("streaming")]), 0, "still on its way: nothing to refresh yet");
  assert.equal(settledTurns([turn("done", saved)]), 1);
  // Cut off while the phone had the app in the background: the server finishes and saves it, so the list must refresh.
  assert.equal(settledTurns([turn("error")]), 1);
  assert.equal(settledTurns([turn("stopped")]), 1);
  assert.equal(settledTurns([turn("done", { saved: false, replayed: false })]), 0, "a chat that isn't saved has nothing to show");
  assert.equal(settledTurns([turn("done", { saved: true, replayed: true })]), 0, "a replay changes nothing");
  assert.equal(settledTurns([turn("done", saved), turn("error"), turn("streaming")]), 2);
});
