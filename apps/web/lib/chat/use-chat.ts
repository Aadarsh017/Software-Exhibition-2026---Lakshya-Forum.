"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { checkRedFlags } from "@hch/shared/redflags";
import { missingConsents, REQUIRED_CONSENTS } from "@hch/shared/consent";
import { createClient } from "@/lib/supabase/client";
import { currentUserId, ensureSession, forgetMember } from "@/lib/supabase/ensure-session";
import { applyAccountSettings, applyTextSize } from "@/lib/onboarding/apply";
import { isLanguage, isTextSize, toHealthRow, type HealthDraft, type Language, type TextSize } from "@/lib/onboarding/settings";
import { friendlyAuthMessage } from "@/lib/auth-messages";
import { historyForServer, turnIdOf, turnsFromRows, type MessageRow } from "./history.ts";
import { browserStore, forgetOpenChat, readOpenChat, rememberOpenChat } from "./open-chat.ts";
import { chatReducer, initialState, isBusy } from "./reducer.ts";
import { ChatRequestError, streamChat } from "./sse.ts";
import type { RedFlag, ServerEvent, Turn, TurnError } from "./types.ts";
import { uuid } from "./uuid.ts";

export const MAX_MESSAGE = 4000;
// client_message_id: a reopened question keeps the id it was sent with, so "Ask again" is a true retry (bug review
// 2026-10-20: it used the row id, and the server counted and saved the question a second time).
const MESSAGE_COLUMNS = "id, client_message_id, role, content, answer, sources, care_level, raised_by_rules, rule_ids, reply_to, created_at";

export type Sheet = { kind: "emergency" | "crisis"; level: "emergency" | "ambulance"; signs: string[]; ruleIds: string[]; turnId: string };
export type Profile = {
  /** What Nox calls the person (Personalization). Never sent to the AI service: the server swaps it for a placeholder. */
  display_name: string | null;
  language: Language;
  text_size: TextSize;
  save_chats: boolean;
  use_profile_in_answers: boolean;
  onboarded_at: string | null;
};

export type SessionState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; guest: boolean; email: string | null };


/**
 * Everything the chat screen needs: a session (guest if needed), the consent gate, the care-band flag,
 * sending a question and reading the stream, stopping, retrying, feedback, and the emergency sheet.
 */
export function useChat() {
  const supabase = useMemo(() => createClient(), []);
  const [state, dispatch] = useReducer(chatReducer, undefined, () => initialState(uuid()));
  const [session, setSession] = useState<SessionState>({ phase: "loading" });
  const [needsConsent, setNeedsConsent] = useState(false);
  const [careBand, setCareBand] = useState(true);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const conversationRef = useRef(state.conversationId);
  conversationRef.current = state.conversationId;
  const turnsRef = useRef<Turn[]>(state.turns);
  turnsRef.current = state.turns;
  const controllers = useRef(new Map<string, AbortController>());
  const sheetShown = useRef(new Set<string>());
  // Turns whose calm crisis sheet has been shown: a crisis noticed after an emergency sheet still gets its own.
  const crisisShown = useRef(new Set<string>());
  const guestRef = useRef(true);
  // Who the open chat belongs to (lib/chat/open-chat.ts), so it is never reopened for someone else on this device.
  const userRef = useRef<string | null>(null);
  // The person already chose (New chat, opened a chat, or sent something) while the saved chat was still loading:
  // the restore must not overwrite that choice (bug review 2026-10-20).
  const chosenRef = useRef(false);
  const remember = useCallback((chatId: string | null) => rememberOpenChat(browserStore("session"), userRef.current, chatId), []);
  const languageRef = useRef<Language>("en");
  // "Save my chats" (Settings). When off, nothing is stored and the browser sends recent turns itself.
  const saveRef = useRef(true);

  // ---- Session, consent, flag, saved conversation -----------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { session: current, error } = await ensureSession(supabase);
      if (!current) {
        if (!cancelled) {
          setSession({ phase: "error", message: error ? friendlyAuthMessage(error, "guest") : "We couldn't start a session." });
          setRestoring(false);
        }
        return;
      }
      const user = current.user;
      guestRef.current = user.is_anonymous ?? false;
      if (cancelled) return;
      setSession({ phase: "ready", guest: user.is_anonymous ?? false, email: user.email ?? null });

      setUserId(user.id);
      userRef.current = user.id;
      // A new chat on every fresh start; the chat open in this visit comes back after moving between screens or a
      // reload (lib/chat/open-chat.ts). The old long-lived copy (localStorage, before 2026-10-20) is dropped.
      forgetOpenChat(null, browserStore("local"));
      const saved = readOpenChat(browserStore("session"), user.id, Date.now());
      const [consents, flag, profileRow, rows] = await Promise.all([
        supabase.from("consents").select("doc_type, version"),
        supabase.from("feature_flags").select("value").eq("key", "care_level_display").maybeSingle(),
        supabase.from("profiles").select("display_name, language, text_size, save_chats, use_profile_in_answers, onboarded_at").eq("id", user.id).maybeSingle(),
        saved
          ? supabase
              .from("messages")
              .select(MESSAGE_COLUMNS)
              .eq("conversation_id", saved)
              .order("created_at", { ascending: true })
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (cancelled) return;
      setNeedsConsent(consents.error ? false : missingConsents(consents.data ?? []).length > 0);
      if (flag.data && flag.data.value === false) setCareBand(false);
      if (profileRow.data) {
        const row = profileRow.data;
        const loaded: Profile = {
          display_name: typeof row.display_name === "string" && row.display_name.trim() ? row.display_name : null,
          language: isLanguage(row.language) ? row.language : "en",
          text_size: isTextSize(row.text_size) ? row.text_size : "m",
          save_chats: row.save_chats !== false,
          use_profile_in_answers: row.use_profile_in_answers !== false,
          onboarded_at: row.onboarded_at ?? null,
        };
        languageRef.current = loaded.language;
        saveRef.current = loaded.save_chats;
        setProfile(loaded);
        applyAccountSettings(loaded.text_size);
      } else {
        // The profile couldn't be read (a brief network error): the chat works with the defaults instead of a dead
        // message box, and the first-run steps aren't shown on a guess. Saving is still decided by the server from the
        // real setting (bug review 2026-10-20).
        setProfile({ display_name: null, language: "en", text_size: "m", save_chats: true, use_profile_in_answers: true, onboarded_at: "unknown" });
      }
      if (profileRow.data?.save_chats === false) remember(null);
      else if (saved && rows.data && rows.data.length && !chosenRef.current) {
        dispatch({ type: "load", conversationId: saved, turns: turnsFromRows(rows.data as MessageRow[]) });
      }
      setRestoring(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, remember]);

  // ---- The emergency sheet ------------------------------------------------------------------------
  const openSheet = useCallback((turnId: string, flag: RedFlag) => {
    // A later flag can turn it into a crisis (the server's model noticed self-harm after the device raised an
    // emergency): the calm crisis sheet replaces the red one, once (bug review 2026-10-20).
    const upgrade = flag.crisis && !crisisShown.current.has(turnId);
    if (sheetShown.current.has(turnId) && !upgrade) return;
    sheetShown.current.add(turnId);
    if (flag.crisis) crisisShown.current.add(turnId);
    setSheet({ kind: flag.crisis ? "crisis" : "emergency", level: flag.level, signs: flag.signs, ruleIds: flag.rule_ids, turnId });
  }, []);
  const closeSheet = useCallback(() => setSheet(null), []);

  // ---- Sending ------------------------------------------------------------------------------------
  const accessToken = useCallback(
    async (forceRefresh = false): Promise<string | null> => {
      if (forceRefresh) {
        const { data } = await supabase.auth.refreshSession();
        if (data.session) return data.session.access_token;
      }
      const { session: current } = await ensureSession(supabase);
      return current?.access_token ?? null;
    },
    [supabase],
  );

  const run = useCallback(
    async (id: string, text: string) => {
      const controller = new AbortController();
      controllers.current.set(id, controller);
      let finished = false;
      const onEvent = (event: ServerEvent) => {
        if (event.event === "done" || event.event === "error") finished = true;
        if (event.event === "red_flag") openSheet(id, { ...event.data });
        if (event.event === "meta" && event.data.conversation_id) remember(event.data.conversation_id);
        dispatch({ type: "event", id, event });
      };
      const fail = (error: TurnError) => {
        if (error.code === "consent_required") setNeedsConsent(true);
        dispatch({ type: "fail", id, error });
      };
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const token = await accessToken(attempt > 0);
          if (!token) {
            fail({ code: "unauthenticated", message: "", retryable: true, extra: {} });
            return;
          }
          try {
            await streamChat({
              url: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/chat`,
              headers: { Authorization: `Bearer ${token}`, apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "" },
              body: saveRef.current
                ? {
                    client_message_id: id,
                    conversation_id: conversationRef.current,
                    message: text,
                    client: { ui_lang: languageRef.current },
                    options: { save: true },
                  }
                : {
                    client_message_id: id,
                    conversation_id: null,
                    message: text,
                    history: historyForServer(turnsRef.current, id),
                    client: { ui_lang: languageRef.current },
                    options: { save: false },
                  },
              signal: controller.signal,
              onEvent,
            });
            if (!finished) fail({ code: "network", message: "", retryable: true, extra: {} }); // the connection closed early
            return;
          } catch (error) {
            if (controller.signal.aborted) return;
            if (error instanceof ChatRequestError) {
              if (error.turnError.code === "unauthenticated" && attempt === 0) continue; // refresh the session once
              fail(error.turnError);
              return;
            }
            fail({ code: "internal", message: "", retryable: true, extra: {} });
            return;
          }
        }
      } finally {
        controllers.current.delete(id);
      }
    },
    [accessToken, openSheet, remember],
  );

  const send = useCallback(
    (raw: string): boolean => {
      const text = raw.trim();
      if (!text || text.length > MAX_MESSAGE || isBusy({ conversationId: conversationRef.current, turns: turnsRef.current })) return false;
      chosenRef.current = true;
      const id = uuid();
      dispatch({ type: "start", id, text });
      // The on-device check comes first: no network call, so it cannot be slow or fail (DESIGN.md 8.4).
      const local = checkRedFlags(text);
      if (local.level) {
        const flag: RedFlag = { level: local.level, rule_ids: local.matches.map((m) => m.id), crisis: local.crisis, signs: local.matches.map((m) => m.sign), source: "device" };
        dispatch({ type: "device_flag", id, flag });
        openSheet(id, flag);
      }
      void run(id, text);
      return true;
    },
    [openSheet, run],
  );

  const retry = useCallback(
    (id: string) => {
      const turn = turnsRef.current.find((item) => item.id === id);
      if (!turn || isBusy({ conversationId: conversationRef.current, turns: turnsRef.current })) return;
      dispatch({ type: "retry", id });
      void run(id, turn.userText);
    },
    [run],
  );

  const stop = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    dispatch({ type: "stop", id });
  }, []);

  const newChat = useCallback(() => {
    chosenRef.current = true;
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();
    sheetShown.current.clear();
    crisisShown.current.clear();
    setSheet(null);
    remember(null);
    dispatch({ type: "reset", conversationId: uuid() });
  }, [remember]);

  // ---- Opening a saved chat ----------------------------------------------------------------------------
  const openConversation = useCallback(
    async (conversationId: string): Promise<string | null> => {
      const { data, error } = await supabase
        .from("messages")
        .select(MESSAGE_COLUMNS)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (error) return "We couldn't open that chat.";
      chosenRef.current = true;
      for (const controller of controllers.current.values()) controller.abort();
      controllers.current.clear();
      sheetShown.current = new Set((data ?? []).filter((row) => row.role === "user").map((row) => turnIdOf(row as MessageRow)));
      crisisShown.current = new Set(sheetShown.current);
      setSheet(null);
      remember(conversationId);
      dispatch({ type: "load", conversationId, turns: turnsFromRows((data ?? []) as MessageRow[]) });
      return null;
    },
    [supabase, remember],
  );

  // ---- Consent ------------------------------------------------------------------------------------
  const acceptConsents = useCallback(async (): Promise<string | null> => {
    const rows = Object.entries(REQUIRED_CONSENTS).map(([doc_type, version]) => ({ doc_type, version }));
    const { error } = await supabase.from("consents").upsert(rows, { onConflict: "user_id,doc_type,version", ignoreDuplicates: true });
    if (error) return "We couldn't save that. Please try again.";
    setNeedsConsent(false);
    // A question that was refused for lack of consent goes through now.
    const waiting = turnsRef.current.find((turn) => turn.status === "error" && turn.error?.code === "consent_required");
    if (waiting) {
      dispatch({ type: "retry", id: waiting.id });
      void run(waiting.id, waiting.userText);
    }
    return null;
  }, [supabase, run]);

  // ---- Feedback -----------------------------------------------------------------------------------
  const sendFeedback = useCallback(
    async (messageId: string, rating: 1 | -1, reason?: string): Promise<boolean> => {
      const row = { message_id: messageId, rating, reason: reason ?? null };
      const { error } = await supabase.from("feedback").insert(row);
      if (!error) return true;
      if (error.code === "23505") {
        const { error: updateError } = await supabase.from("feedback").update({ rating, reason: row.reason }).eq("message_id", messageId);
        return !updateError;
      }
      return false;
    },
    [supabase],
  );

  // ---- Settings and the optional health profile (onboarding steps 2 and 3) -----------------------------
  const saveSettings = useCallback(
    async (patch: Partial<Pick<Profile, "display_name" | "language" | "text_size" | "use_profile_in_answers">>): Promise<string | null> => {
      const id = await currentUserId(supabase);
      if (!id) return "We couldn't save that. Please try again.";
      const { data, error } = await supabase.from("profiles").update(patch).eq("id", id).select("id");
      if (error || !data?.length) return "We couldn't save that. Please try again.";
      if (patch.language) languageRef.current = patch.language;
      setProfile((current) => (current ? { ...current, ...patch } : current));
      return null;
    },
    [supabase, userId],
  );

  const loadHealth = useCallback(async (): Promise<HealthDraft | null> => {
    const id = await currentUserId(supabase);
    if (!id || guestRef.current) return null;
    const { data, error } = await supabase
      .from("health_profile")
      .select("age_range, sex_at_birth, pregnancy, conditions, allergies, medicines")
      .eq("user_id", id)
      .maybeSingle();
    // A failed read is not "nothing saved yet": the caller must not save an empty form over real details.
    if (error) throw new Error("health_unavailable");
    return data ? (data as HealthDraft) : null;
  }, [supabase, userId]);

  const saveHealth = useCallback(
    async (draft: HealthDraft): Promise<string | null> => {
      const id = await currentUserId(supabase);
      if (!id) return "We couldn't save that. Please try again.";
      const { error } = await supabase.from("health_profile").upsert({ user_id: id, ...toHealthRow(draft) }, { onConflict: "user_id" });
      return error ? "We couldn't save that. Please try again." : null;
    },
    [supabase, userId],
  );

  const finishOnboarding = useCallback(async (): Promise<string | null> => {
    const now = new Date().toISOString();
    const id = await currentUserId(supabase);
    if (!id) return "We couldn't save that. Please try again.";
    const { data, error } = await supabase.from("profiles").update({ onboarded_at: now }).eq("id", id).select("id");
    if (error || !data?.length) return "We couldn't save that. Please try again.";
    setProfile((current) => (current ? { ...current, onboarded_at: current.onboarded_at ?? now } : current));
    return null;
  }, [supabase, userId]);

  // Back after a long time away with something on screen worth keeping (chat-app.tsx): the open chat stays open, so it
  // is remembered again for this visit. A chat that isn't saved is never remembered.
  const keepOpenChat = useCallback(() => {
    if (saveRef.current && turnsRef.current.length) remember(conversationRef.current);
  }, [remember]);

  const signOut = useCallback(async () => {
    forgetOpenChat(browserStore("session"), browserStore("local"));
    forgetMember();
    await supabase.auth.signOut();
  }, [supabase]);

  return {
    state,
    session,
    restoring,
    needsConsent,
    careBand,
    sheet,
    busy: isBusy(state),
    send,
    stop,
    retry,
    newChat,
    keepOpenChat,
    closeSheet,
    acceptConsents,
    sendFeedback,
    signOut,
    profile,
    saveSettings,
    loadHealth,
    saveHealth,
    finishOnboarding,
    supabase,
    userId,
    openConversation,
    saving: profile ? profile.save_chats : true,
    applyTextSize,
    openSheetFor: (turn: Turn) => {
      if (turn.redFlag) {
        sheetShown.current.delete(turn.id);
        crisisShown.current.delete(turn.id);
        openSheet(turn.id, turn.redFlag);
      }
    },
  };
}
