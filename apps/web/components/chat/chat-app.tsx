"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@/lib/chat/use-chat";
import { displayTitle } from "@/lib/history/group";
import { useConversations } from "@/lib/history/use-conversations";
import { likePattern, type MessageHit } from "@/lib/history/search";
import { shouldShowCareStrip, standingCareLevel } from "@/lib/chat/care";
import { checkInFor, checkInMessage, checkInWhen, type Feeling } from "@/lib/diary/diary";
import { dayStamp, readingReminder } from "@/lib/diary/readings";
import { activeSchedules, DOSE_COLUMNS, doseDay, dueDoses, logAllRows, quietStamp, runningLow, SCHEDULE_COLUMNS, toSchedule, type Dose, type DueDose, type Schedule } from "@/lib/medicines/today";
import { FRESH_START_EVENT } from "@/lib/chat/open-chat";
import { settledTurns } from "@/lib/chat/reducer";
import { presetFrom } from "@/lib/chat/presets";
import { cleanList, LIMITS } from "@/lib/onboarding/settings";
import type { ProfileUpdate } from "@/lib/chat/types";

const READING_QUIET_KEY = "hch-reading-quiet";
// "Not now" on the Today card (DESIGN.md 8.6e): the medicines until the next time of day, "Set times" for a week.
const MEDS_QUIET_KEY = "hch-meds-quiet";
const SETUP_QUIET_KEY = "hch-meds-setup-quiet";
const SETUP_QUIET_DAYS = 7;
import { Onboarding } from "@/components/onboarding/onboarding";
import { Sidebar } from "@/components/history/sidebar";
import { AnswerCard } from "./answer-card";
import { AppHeader } from "./app-header";
import { Composer } from "./composer";
import { EmergencySheet } from "./emergency-sheet";
import { ArrowDownIcon, LockIcon } from "./icons";
import { Modal } from "./modal";
import { SourcesDrawer } from "./sources-drawer";
import { Welcome } from "./welcome";

const RAIL_KEY = "hch-sidebar";
const WAVED_KEY = "hch-checkin-waved";


/**
 * The chat screen (DESIGN.md 8.4), laid out after the founder's reference: a sidebar on the left (hideable on wide
 * screens, a drawer on phones), a slim top bar, and either a centred welcome with the big composer, or the
 * conversation with the composer docked at the bottom.
 */
export function ChatApp() {
  const router = useRouter();
  const chat = useChat();
  const [draft, setDraft] = useState("");
  const [drawer, setDrawer] = useState<{ turnId: string; focusId: string | null } | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const stick = useRef(true);
  const scroller = useRef<HTMLDivElement>(null);
  const composerFocus = useRef(0);
  const [focusTick, setFocusTick] = useState(0);
  // A question of Nox's the person chose to answer (shown above the message box until sent).
  const [answering, setAnswering] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const conversations = useConversations(chat.supabase, chat.session.phase === "ready");
  // Sidebar search inside messages (DESIGN.md 8.5): your own messages and Nox's saved answers; the database only returns your own.
  const searchMessages = useCallback(
    async (query: string): Promise<MessageHit[] | null> => {
      const { data, error } = await chat.supabase
        .from("messages")
        .select("conversation_id, content")
        .ilike("content", likePattern(query))
        .order("created_at", { ascending: false })
        .limit(60);
      return error ? null : ((data ?? []) as MessageHit[]);
    },
    [chat.supabase],
  );
  // Check-ins (DESIGN.md 8.6c): what was logged lately, chats waved away, and a message waiting for its chat to open.
  const [recentLogs, setRecentLogs] = useState<{ logged_at: string; conversation_id: string | null; bp_systolic?: number | null; glucose_mgdl?: number | null }[]>([]);
  // The daily reading reminder (DESIGN.md 8.6d): what the person tracks, and "Not today".
  const [conditions, setConditions] = useState<string[]>([]);
  const [readingQuiet, setReadingQuiet] = useState<string | null>(null);
  // Medicines today (DESIGN.md 8.6e): the regular medicines, their times, today's ticks, and what was ticked on this visit.
  const [medicines, setMedicines] = useState<string[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [doses, setDoses] = useState<Dose[]>([]);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [medsQuiet, setMedsQuiet] = useState<string | null>(null);
  const [setupQuiet, setSetupQuiet] = useState(false);
  const [medsError, setMedsError] = useState<string | null>(null);
  const [waved, setWaved] = useState<Set<string>>(new Set());
  const [pendingSend, setPendingSend] = useState<{ conversationId: string; text: string } | null>(null);
  // The emergency card's contact, for "Call <name>" in the emergency sheet (accounts only).
  const [contact, setContact] = useState<{ name: string; phone: string } | null>(null);

  const { turns } = chat.state;
  const levels = turns.map((turn) => turn.fields.care_level);
  const guest = chat.session.phase === "ready" ? chat.session.guest : true;
  const lastTurn = turns[turns.length - 1];
  // First visit: consent, then two optional steps.
  const onboardingDue = chat.session.phase === "ready" && !chat.restoring && chat.profile !== null && (chat.needsConsent || chat.profile.onboarded_at === null);

  // The sidebar remembers being hidden on this device.
  useEffect(() => {
    try {
      if (localStorage.getItem(RAIL_KEY) === "hidden") setRailOpen(false);
    } catch {
      // ignore
    }
  }, []);
  const setRail = (open: boolean) => {
    setRailOpen(open);
    try {
      localStorage.setItem(RAIL_KEY, open ? "shown" : "hidden");
    } catch {
      // ignore
    }
  };

  const member = chat.session.phase === "ready" && !chat.session.guest;
  useEffect(() => {
    try {
      setWaved(new Set(JSON.parse(localStorage.getItem(WAVED_KEY) ?? "[]") as string[]));
    } catch {
      // ignore
    }
  }, []);
  useEffect(() => {
    if (!member) return;
    const since = new Date(Date.now() - 5 * 86_400_000).toISOString();
    void chat.supabase
      .from("health_log")
      .select("logged_at, conversation_id, bp_systolic, glucose_mgdl")
      .gte("logged_at", since)
      .then(({ data }) => setRecentLogs((data ?? []) as typeof recentLogs));
  }, [member, chat.supabase]);
  useEffect(() => {
    if (!member) return;
    void chat.supabase
      .from("health_profile")
      .select("emergency_contact_name, emergency_contact_phone, conditions, medicines")
      .maybeSingle()
      .then(({ data }) => {
        const row = data as { emergency_contact_name: string | null; emergency_contact_phone: string | null; conditions: string[] | null; medicines: string[] | null } | null;
        if (row?.emergency_contact_name && row.emergency_contact_phone) setContact({ name: row.emergency_contact_name, phone: row.emergency_contact_phone });
        setConditions(Array.isArray(row?.conditions) ? row.conditions : []);
        setMedicines(Array.isArray(row?.medicines) ? row.medicines : []);
      });
    void loadSchedules();
    void chat.supabase
      .from("dose_log")
      .select(DOSE_COLUMNS)
      .eq("taken_on", doseDay())
      .then(({ data }) => setDoses((data ?? []) as Dose[]));
    try {
      setReadingQuiet(localStorage.getItem(READING_QUIET_KEY));
      setMedsQuiet(localStorage.getItem(MEDS_QUIET_KEY));
      const at = Number(localStorage.getItem(SETUP_QUIET_KEY));
      setSetupQuiet(Boolean(at) && Date.now() - at < SETUP_QUIET_DAYS * 86_400_000);
    } catch {
      // ignore: the reminders simply show
    }
  }, [member, chat.supabase]); // eslint-disable-line react-hooks/exhaustive-deps
  // The check-in's message is sent once its chat is on screen (opening a chat is not instant).
  useEffect(() => {
    if (!pendingSend || chat.restoring || chat.busy || chat.state.conversationId !== pendingSend.conversationId) return;
    chat.send(pendingSend.text);
    setPendingSend(null);
  }, [pendingSend, chat.restoring, chat.busy, chat.state.conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the newest words in view while an answer is written, unless the person has scrolled up to read. The page
  // itself never scrolls (DESIGN.md 8.3): only this content area does.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      stick.current = el.scrollHeight - (el.scrollTop + el.clientHeight) < 140;
      setAtBottom(stick.current);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [onboardingDue]);
  useEffect(() => {
    const el = scroller.current;
    if (el && turns.length > 0 && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, [turns, lastTurn?.fields, lastTurn?.status]);

  // Recents (founder, 2026-10-20: "the chat I was in earlier was not shown in Recents"). Refreshed when an answer ends
  // (saved, cut off or stopped: the server saves it either way), when a new chat starts, and when the app comes back
  // to the front (an answer may have finished on the server while the phone had Hale paused).
  const settled = settledTurns(turns);
  const reloadList = conversations.reload;
  useEffect(() => {
    if (settled > 0) void reloadList();
  }, [settled, reloadList]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void reloadList();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reloadList]);

  const jump = useCallback(() => {
    stick.current = true;
    const el = scroller.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  function sendDraft() {
    if (chat.send(draft)) {
      setDraft("");
      setAnswering(null);
      stick.current = true;
    }
  }
  // Save one profile addition Nox proposed (DESIGN.md 8.6f): read the list, add the item if it's new, write it back.
  async function saveToProfile(update: ProfileUpdate): Promise<string | null> {
    if (!chat.userId) return "Please wait a moment and try again.";
    const { data, error } = await chat.supabase.from("health_profile").select("conditions, allergies, medicines").maybeSingle();
    if (error) return "We couldn't save that. Please try again.";
    const current = ((data as Record<string, unknown> | null)?.[update.list] as string[] | undefined) ?? [];
    if (current.some((item) => item.toLowerCase() === update.item.toLowerCase())) return null;
    const next = cleanList([...current, update.item], LIMITS[update.list]);
    const saved = await chat.supabase.from("health_profile").upsert({ user_id: chat.userId, [update.list]: next }, { onConflict: "user_id" });
    return saved.error ? "We couldn't save that. Please try again." : null;
  }
  function answer(question: string) {
    setAnswering(question);
    composerFocus.current += 1;
    setFocusTick(composerFocus.current);
  }
  function pickTopic(text: string) {
    setDraft(text);
    composerFocus.current += 1;
    setFocusTick(composerFocus.current);
  }
  // A question another screen asked us to start with (`/app?ask=readings`): into the message box, never sent for the
  // person, and the address is cleaned so a reload doesn't fill it again.
  useEffect(() => {
    const text = presetFrom(window.location.search);
    if (!text) return;
    pickTopic(text);
    const params = new URLSearchParams(window.location.search);
    params.delete("ask");
    const rest = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function startNewChat() {
    chat.newChat();
    void conversations.reload(); // the chat being left shows in Recents, even if its last answer never finished here
    setDraft("");
    setAnswering(null);
    setDrawer(null);
    setDrawerOpen(false);
  }
  // Back after a long time away (lib/chat/open-chat.ts): a new chat, the same as a fresh start, unless something would
  // be lost (a typed message, an answer still arriving, the emergency sheet). The earlier chat stays in History.
  const freshStart = useRef(() => {});
  freshStart.current = () => {
    if (draft.trim() || answering || chat.busy || chat.sheet) chat.keepOpenChat();
    else if (chat.state.turns.length) startNewChat();
  };
  useEffect(() => {
    const onFresh = () => freshStart.current();
    window.addEventListener(FRESH_START_EVENT, onFresh);
    return () => window.removeEventListener(FRESH_START_EVENT, onFresh);
  }, []);
  async function openChat(id: string): Promise<boolean> {
    setOpenError(null);
    const failure = await chat.openConversation(id);
    if (failure) {
      setOpenError(failure);
      return false;
    }
    setDraft("");
    setDrawer(null);
    setDrawerOpen(false);
    stick.current = true;
    return true;
  }
  function waveAway(id: string) {
    setWaved((current) => {
      const next = new Set(current).add(id);
      try {
        localStorage.setItem(WAVED_KEY, JSON.stringify([...next].slice(-50)));
      } catch {
        // ignore
      }
      return next;
    });
  }
  async function checkInOn(id: string, title: string, feeling: Feeling) {
    waveAway(id);
    if (member) {
      const { data } = await chat.supabase.from("health_log").insert({ feeling, symptom: title.slice(0, 60), conversation_id: id }).select("logged_at, conversation_id");
      if (data) setRecentLogs((current) => [...current, ...(data as { logged_at: string; conversation_id: string | null }[])]);
    }
    // Only when the chat opened: a queued update must never be sent later, out of the blue (bug review 2026-10-20).
    if (await openChat(id)) setPendingSend({ conversationId: id, text: checkInMessage(feeling) });
  }

  // Pills left change with each tick (the database counts them), so the times are read again after one.
  async function loadSchedules() {
    const { data } = await chat.supabase.from("medicine_schedule").select(SCHEDULE_COLUMNS).limit(50);
    if (data) setSchedules((data as Record<string, unknown>[]).map(toSchedule).filter((row): row is Schedule => row !== null));
  }
  // A tick, or its undo, on the Today card. Shown at once; put back if the database says no.
  async function toggleDose(dose: DueDose) {
    const tick: Dose = { schedule_id: dose.scheduleId, slot: dose.slot, taken_on: doseDay() };
    const same = (row: Dose) => row.schedule_id === tick.schedule_id && row.slot === tick.slot && row.taken_on === tick.taken_on;
    setTouched((current) => new Set(current).add(dose.key));
    setMedsError(null);
    setDoses((current) => (dose.taken ? current.filter((row) => !same(row)) : [...current, tick]));
    const { error } = dose.taken
      ? await chat.supabase.from("dose_log").delete().match(tick)
      : await chat.supabase.from("dose_log").upsert(tick, { onConflict: "schedule_id,slot,taken_on", ignoreDuplicates: true });
    if (error) {
      setDoses((current) => (dose.taken ? [...current, tick] : current.filter((row) => !same(row))));
      setMedsError("We couldn't save that tick. Please try again.");
      return;
    }
    void loadSchedules();
  }
  async function logAll(due: DueDose[]) {
    const rows = logAllRows(due);
    if (!rows.length) return;
    setTouched((current) => new Set([...current, ...due.map((dose) => dose.key)]));
    setMedsError(null);
    setDoses((current) => [...current, ...rows]);
    const { error } = await chat.supabase.from("dose_log").upsert(rows, { onConflict: "schedule_id,slot,taken_on", ignoreDuplicates: true });
    if (error) {
      setDoses((current) => current.filter((row) => !rows.some((tick) => tick.schedule_id === row.schedule_id && tick.slot === row.slot && tick.taken_on === row.taken_on)));
      setMedsError("We couldn't save those ticks. Please try again.");
      return;
    }
    void loadSchedules();
  }
  function quietToday(reading: boolean, meds: boolean, setup: boolean) {
    const now = new Date();
    try {
      if (reading) localStorage.setItem(READING_QUIET_KEY, dayStamp(now));
      if (meds) localStorage.setItem(MEDS_QUIET_KEY, quietStamp(now));
      if (setup) localStorage.setItem(SETUP_QUIET_KEY, String(now.getTime()));
    } catch {
      // ignore
    }
    if (reading) setReadingQuiet(dayStamp(now));
    if (meds) setMedsQuiet(quietStamp(now));
    if (setup) setSetupQuiet(true);
  }

  async function signOut() {
    await chat.signOut();
    router.replace("/");
    router.refresh();
  }

  const drawerTurn = drawer ? turns.find((turn) => turn.id === drawer.turnId) : undefined;
  const current = conversations.items.find((item) => item.id === chat.state.conversationId) ?? null;
  const announce = lastTurn?.status === "done" && lastTurn.fields.headline ? `Answer ready. ${lastTurn.fields.headline}` : "";
  const ready = chat.session.phase === "ready" && !chat.restoring;

  if (onboardingDue && chat.profile) {
    return (
      <Onboarding
        guest={guest}
        needsConsent={chat.needsConsent}
        settingsMode={false}
        profile={chat.profile}
        onAcceptConsents={chat.acceptConsents}
        onSaveSettings={chat.saveSettings}
        onLoadHealth={chat.loadHealth}
        onSaveHealth={chat.saveHealth}
        onFinish={chat.finishOnboarding}
        onClose={() => undefined}
        applyTextSize={chat.applyTextSize}
      />
    );
  }

  const sidebar = (hide: () => void, hideLabel: string, variant: "rail" | "drawer" = "rail") => (
    <Sidebar
      items={conversations.items}
      loading={conversations.loading}
      error={conversations.error ?? openError}
      currentId={current?.id ?? null}
      savingOff={!chat.saving}
      onOpen={openChat}
      onNewChat={startNewChat}
      onRename={conversations.rename}
      onDelete={async (id) => {
        const failure = await conversations.remove(id);
        if (!failure && id === chat.state.conversationId) startNewChat();
        return failure;
      }}
      account={chat.session.phase === "ready" ? { guest: chat.session.guest, email: chat.session.email, name: chat.profile?.display_name ?? null } : null}
      onSignOut={signOut}
      onHide={hide}
      hideLabel={hideLabel}
      variant={variant}
      onSearchMessages={searchMessages}
    />
  );

  const composer = (
    <Composer
      value={draft}
      onChange={setDraft}
      onSend={sendDraft}
      // The turn that is actually answering: a retried earlier question can be the busy one (bug review 2026-10-20).
      onStop={() => {
        const answeringNow = [...turns].reverse().find((turn) => turn.status === "sending" || turn.status === "streaming") ?? lastTurn;
        if (answeringNow) chat.stop(answeringNow.id);
      }}
      busy={chat.busy}
      disabled={chat.session.phase !== "ready" || chat.needsConsent || chat.profile === null}
      autoFocus={focusTick > 0}
      replyTo={answering}
      onClearReply={() => setAnswering(null)}
      key={focusTick}
    />
  );

  return (
    <div className="screen-h flex overflow-hidden">
      {railOpen ? (
        <aside className="rail hidden lg:flex" aria-label="Sidebar">
          {sidebar(() => setRail(false), "Hide the sidebar")}
        </aside>
      ) : null}

      <div className="screen-h flex min-h-0 min-w-0 flex-1 flex-col">
        <AppHeader
          sidebarOpen={railOpen}
          title={current ? displayTitle(current.title) : ""}
          onNewChat={startNewChat}
          onOpenSidebar={() => {
            // Wide screens bring the sidebar back; phones open it as a drawer.
            if (window.matchMedia("(min-width: 1024px)").matches) setRail(true);
            else setDrawerOpen(true);
          }}
        />

        <div className="relative min-h-0 flex-1">
        <div ref={scroller} className="app-scroll h-full">
        <main id="main" className="flex min-h-full flex-col">
          {chat.session.phase === "ready" && !chat.saving ? (
            <div className="chat-col w-full">
              <p className="save-off" role="note">
                <LockIcon />
                <span>
                  Not saved. This chat disappears when you leave. <Link href="/app/settings">Settings</Link>
                </span>
              </p>
            </div>
          ) : null}

          {!ready && chat.session.phase !== "error" ? (
            <div className="chat-col grid w-full gap-4 py-16" aria-busy="true" aria-label="Getting things ready">
              <div className="skeleton mx-auto h-9 w-2/3" />
              <div className="skeleton h-16 w-full" style={{ borderRadius: 28 }} />
            </div>
          ) : null}

          {chat.session.phase === "error" ? (
            <div className="chat-col w-full py-6">
              <div className="error-card" role="alert">
                <p className="m-0 font-bold">We couldn&apos;t get things ready</p>
                <p className="mt-1 mb-0">{chat.session.message}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href="/login?next=/app" className="btn btn-primary">
                    Log in with email
                  </Link>
                  <Link href="/emergency" className="btn">
                    Emergency numbers
                  </Link>
                </div>
              </div>
            </div>
          ) : null}

          {ready && turns.length === 0 ? (
            <Welcome
              composer={composer}
              onPick={pickTopic}
              guest={guest}
              name={chat.profile?.display_name}
              checkIn={(() => {
                const due = checkInFor(conversations.items, recentLogs, new Date(), waved);
                if (!due) return null;
                const title = displayTitle(due.title);
                return { title, when: checkInWhen(due.updated_at), onFeel: (feeling: Feeling) => void checkInOn(due.id, title, feeling), onDismiss: () => waveAway(due.id) };
              })()}
              today={(() => {
                if (!member) return null;
                const now = new Date();
                const reading = readingReminder(conditions, recentLogs, now, readingQuiet);
                const active = activeSchedules(schedules, medicines);
                const due = dueDoses(schedules, medicines, doses, now);
                // The open doses, and those ticked on this visit (so a row never vanishes under a finger).
                const listed = medsQuiet === quietStamp(now) ? [] : due.filter((dose) => !dose.taken || touched.has(dose.key));
                const open = listed.filter((dose) => !dose.taken);
                const setup = medicines.length > 0 && active.length === 0 && !setupQuiet;
                if (!reading && !listed.length && !setup) return null;
                return {
                  doses: listed,
                  open: open.length,
                  reading,
                  setup,
                  low: runningLow(active),
                  missed: open.some((dose) => dose.earlier),
                  error: medsError,
                  onToggle: (dose: DueDose) => void toggleDose(dose),
                  onLogAll: () => void logAll(open),
                  onDismiss: () => quietToday(reading !== null, listed.length > 0, setup),
                };
              })()}
            />
          ) : null}

          {turns.length > 0 ? (
            <div className="chat-col grid w-full grid-cols-1 gap-9 pt-6 pb-8">
              <h1 className="sr-only">Your conversation</h1>
              {turns.map((turn, index) => (
                <div key={turn.id} className="grid min-w-0 grid-cols-1 gap-5">
                  <div className="bubble-user">{turn.userText}</div>
                  <AnswerCard
                    turn={turn}
                    careBand={chat.careBand}
                    showCare={shouldShowCareStrip(turn.fields.care_level, standingCareLevel(levels, index))}
                    standingLevel={standingCareLevel(levels, index)}
                    guest={guest}
                    busy={chat.busy}
                    onAnswer={answer}
                    onSaveToProfile={member ? saveToProfile : undefined}
                    onOpenSources={(focusId) => setDrawer({ turnId: turn.id, focusId })}
                    onRetry={() => chat.retry(turn.id)}
                    onFeedback={chat.sendFeedback}
                    onShowEmergency={() => (turn.redFlag ? chat.openSheetFor(turn) : router.push("/emergency"))}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </main>
        </div>

        {!atBottom && turns.length > 0 ? (
          <button type="button" className="icon-btn jump" onClick={jump} aria-label="Jump to latest" title="Jump to latest">
            <ArrowDownIcon />
          </button>
        ) : null}
        </div>

        {turns.length > 0 ? (
          <div className="composer-wrap">
            <div className="chat-col">{composer}</div>
          </div>
        ) : null}

        <p className="sr-only" role="status" aria-live="polite">
          {announce}
        </p>
      </div>

      <Modal open={drawerOpen} onClose={() => setDrawerOpen(false)} className="drawer-left" labelledBy="sidebar-drawer-title" closeOnBackdrop>
        <h2 id="sidebar-drawer-title" className="sr-only">
          Sidebar
        </h2>
        {sidebar(() => setDrawerOpen(false), "Close the sidebar", "drawer")}
      </Modal>

      <EmergencySheet sheet={chat.sheet} onClose={chat.closeSheet} contact={contact} />
      <SourcesDrawer
        open={drawer !== null && drawerTurn !== undefined}
        onClose={() => setDrawer(null)}
        sources={drawerTurn?.sources ?? []}
        fields={drawerTurn?.fields ?? {}}
        focusId={drawer?.focusId ?? null}
      />
    </div>
  );
}
