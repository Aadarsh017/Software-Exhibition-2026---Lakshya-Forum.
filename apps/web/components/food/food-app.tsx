"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "@/lib/account/use-account";
import {
  dayFrom,
  dayLabel,
  draftFrom,
  isMeal,
  LIMITS,
  localDay,
  mealLabel,
  mealSummary,
  MEALS,
  PORTIONS,
  shiftDay,
  SUGGESTIONS,
  toFoodRow,
  type FoodDraft,
  type FoodRow,
  type Meal,
  type Portion,
} from "@/lib/food/food";
import { AppShell } from "@/components/app/app-shell";
import { ChoiceGroup } from "@/components/onboarding/choice-group";
import { TagInput } from "@/components/onboarding/tag-input";
import { EditorScreen } from "@/components/personalization/editors";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MarginNote } from "@/components/ui/margin-note";
import { Toggle } from "@/components/ui/toggle";
import { BookmarkIcon, BowlIcon, ChevronRightIcon, DropIcon } from "@/components/chat/icons";

const COLUMNS = "id, day, meal, items, portion, outside, note";
const href = (day: string, meal?: Meal) => `/app/thali?day=${day}${meal ? `&meal=${meal}` : ""}`;

/**
 * Thali (DESIGN.md 8.6g): what you ate, a day at a time. Water glasses, then one row per meal; each meal opens its own
 * screen. Nox reads the last three days when it matters. Accounts only.
 */
export function FoodApp() {
  const router = useRouter();
  const params = useSearchParams();
  const day = dayFrom(params.get("day"));
  const mealParam = params.get("meal");
  const meal = isMeal(mealParam) ? mealParam : null;
  const { supabase, state } = useAccount();
  const ready = state.phase === "ready" ? state : null;
  const [meals, setMeals] = useState<FoodRow[] | null>(null);
  const [water, setWater] = useState(0);
  const [loadedDay, setLoadedDay] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const waterSaving = useRef(false);
  const waterWanted = useRef<number | null>(null);
  const waterSaved = useRef<number>(0);

  const load = useCallback(
    async (which: string) => {
      const [food, drink] = await Promise.all([
        supabase.from("food_log").select(COLUMNS).eq("day", which),
        supabase.from("water_log").select("glasses").eq("day", which).maybeSingle(),
      ]);
      setMeals((food.data ?? []) as FoodRow[]);
      setWater(Number((drink.data as { glasses: number } | null)?.glasses ?? 0));
      waterSaved.current = Number((drink.data as { glasses: number } | null)?.glasses ?? 0);
      setLoadedDay(which);
      setStatus(food.error || drink.error ? "We couldn't load this day. Please try again." : null);
    },
    [supabase],
  );

  useEffect(() => {
    if (ready && !ready.guest && loadedDay !== day) void load(day);
  }, [ready?.userId, ready?.guest, day, loadedDay, load]); // eslint-disable-line react-hooks/exhaustive-deps

  // Quick taps: the screen moves at once, and the saves go one at a time with only the latest count written, so the
  // database always ends on what the screen shows (bug review 2026-10-20: parallel saves could land out of order).
  async function setGlasses(next: number) {
    if (!ready || ready.guest) return;
    const glasses = Math.max(0, Math.min(LIMITS.water, next));
    setWater(glasses);
    waterWanted.current = glasses;
    if (waterSaving.current) return;
    waterSaving.current = true;
    while (waterWanted.current !== null) {
      const target = waterWanted.current;
      waterWanted.current = null;
      const { error } = await supabase.from("water_log").upsert({ user_id: ready.userId, day, glasses: target, updated_at: new Date().toISOString() }, { onConflict: "user_id,day" });
      if (error) {
        waterWanted.current = null;
        setWater(waterSaved.current);
        setStatus("We couldn't save that. Please try again.");
        break;
      }
      waterSaved.current = target;
    }
    waterSaving.current = false;
  }

  if (!ready || (!ready.guest && (meals === null || loadedDay !== day))) {
    return (
      <AppShell title="Thali">
        <main id="main" className="m-auto grid w-full max-w-[640px] grid-cols-1 gap-3 px-4 py-5" aria-busy="true">
          <div className="skeleton h-16 w-full" />
          <div className="skeleton h-16 w-full" />
          <div className="skeleton h-16 w-full" />
        </main>
      </AppShell>
    );
  }

  if (ready.guest) {
    return (
      <AppShell title="Thali">
        <main id="main" className="m-auto grid w-full max-w-[640px] grid-cols-1 gap-4 px-4 py-5">
          <h1 className="sr-only">Thali</h1>
          <section className="diary-hero grid gap-3">
            <p className="m-0 font-display text-[1.375rem] leading-tight font-extrabold">Keep a note of what you eat</p>
            <p className="m-0">Breakfast, lunch, snacks, dinner and water, a day at a time. Nox uses it when your stomach or sugar is the question. It&apos;s kept in your account.</p>
            <Link href="/login?next=/app/thali" className="btn btn-primary w-full">
              <BookmarkIcon /> Save my chats to start
            </Link>
          </section>
        </main>
      </AppShell>
    );
  }

  const byMeal = new Map((meals ?? []).map((row) => [row.meal, row]));

  // ---- One meal ---------------------------------------------------------------------------------------------------------
  if (meal) {
    const existing = byMeal.get(meal) ?? null;
    return (
      <AppShell title={mealLabel(meal)} back={{ onClick: () => router.push(href(day)), label: "Back to Thali" }}>
        <main id="main" className="flex min-h-full flex-col">
          <h1 className="sr-only">
            {mealLabel(meal)}, {dayLabel(day)}
          </h1>
          <MealForm
            key={`${day}-${meal}`}
            meal={meal}
            day={day}
            existing={existing}
            onSave={async (draft) => {
              const checked = toFoodRow(draft, day, meal);
              if (!checked.ok) return checked.error;
              const { data, error } = await supabase
                .from("food_log")
                .upsert({ user_id: ready.userId, ...checked.row, updated_at: new Date().toISOString() }, { onConflict: "user_id,day,meal" })
                .select(COLUMNS);
              if (error) return /too many/i.test(error.message) ? "Your Thali is full. Remove some old meals first." : "We couldn't save that. Please try again.";
              const saved = ((data ?? []) as FoodRow[])[0];
              if (saved) setMeals((current) => [...(current ?? []).filter((row) => row.meal !== meal), saved]);
              router.push(href(day));
              return null;
            }}
            onClear={
              existing
                ? async () => {
                    const { error } = await supabase.from("food_log").delete().eq("id", existing.id);
                    if (error) return "We couldn't clear it. Please try again.";
                    setMeals((current) => (current ?? []).filter((row) => row.id !== existing.id));
                    router.push(href(day));
                    return null;
                  }
                : undefined
            }
          />
        </main>
      </AppShell>
    );
  }

  // ---- The day ----------------------------------------------------------------------------------------------------------
  const today = localDay();
  return (
    <AppShell title="Thali">
      <main id="main" className="flex w-full flex-1 flex-col">
        <h1 className="sr-only">Thali, {dayLabel(day)}</h1>
        <div className="mx-auto w-full max-w-[640px] px-4 pt-3 sm:px-6">
          <MarginNote>What you ate today. Nox looks at it when it matters.</MarginNote>
        </div>
        <div className="m-auto grid w-full max-w-[640px] grid-cols-1 gap-3.5 px-4 pt-4 pb-6 sm:px-6">
          <nav className="flex items-center justify-between gap-2" aria-label="Choose a day">
            <Link href={href(shiftDay(day, -1))} className="icon-btn" aria-label="The day before" title="The day before">
              <span aria-hidden="true" className="text-[1.25rem] leading-none font-bold">
                ‹
              </span>
            </Link>
            <p className="m-0 font-display text-[1.25rem] font-extrabold" aria-live="polite">
              {dayLabel(day)}
            </p>
            {day < today ? (
              <Link href={href(shiftDay(day, 1))} className="icon-btn" aria-label="The day after" title="The day after">
                <span aria-hidden="true" className="text-[1.25rem] leading-none font-bold">
                  ›
                </span>
              </Link>
            ) : (
              <span className="h-[44px] w-[44px]" aria-hidden="true" />
            )}
          </nav>

          <section className="row-card water-card" style={{ cursor: "default" }} aria-label="Water">
            <span className="tile" data-tone="sky" aria-hidden="true">
              <DropIcon />
            </span>
            <span className="min-w-0 flex-1">
              <span className="row-title block">Water</span>
              <span className="row-sub block" role="status">
                {water === 1 ? "1 glass" : `${water} glasses`}
              </span>
            </span>
            <button type="button" className="water-step" onClick={() => void setGlasses(water - 1)} disabled={water <= 0} aria-label="One glass less">
              −
            </button>
            <button type="button" className="water-step" onClick={() => void setGlasses(water + 1)} disabled={water >= LIMITS.water} aria-label="One more glass">
              +
            </button>
          </section>

          <section className="grid grid-cols-1 gap-2.5" aria-label="Meals">
            {MEALS.map((item) => {
              const summary = mealSummary(byMeal.get(item.value));
              return (
                <Link key={item.value} href={href(day, item.value)} className="row-card">
                  <span className="tile" data-tone={item.tone} aria-hidden="true">
                    <BowlIcon />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="row-title block">{item.label}</span>
                    <span className="row-sub block truncate">{summary ?? "Add what you had"}</span>
                  </span>
                  <ChevronRightIcon />
                </Link>
              );
            })}
          </section>
          {status ? (
            <p className="m-0 text-[0.875rem] text-[var(--alert-text)]" role="alert">
              {status}
            </p>
          ) : null}
        </div>
      </main>
    </AppShell>
  );
}

function MealForm({
  meal,
  day,
  existing,
  onSave,
  onClear,
}: {
  meal: Meal;
  day: string;
  existing: FoodRow | null;
  onSave: (draft: FoodDraft) => Promise<string | null>;
  onClear?: () => Promise<string | null>;
}) {
  const [draft, setDraft] = useState<FoodDraft>(draftFrom(existing));
  const [clearing, setClearing] = useState(false);
  const update = (patch: Partial<FoodDraft>) => setDraft((current) => ({ ...current, ...patch }));
  return (
    <EditorScreen intro={`What did you have for ${mealLabel(meal).toLowerCase()}${day === localDay() ? "" : ` on ${dayLabel(day).split(", ")[1]}`}? Tap or type; skip anything.`} saveLabel={existing ? "Save changes" : "Save meal"} onSave={() => onSave(draft)}>
      <TagInput label="What you ate" values={draft.items} onChange={(items) => update({ items })} suggestions={SUGGESTIONS[meal]} max={LIMITS.items} placeholder="Type a food and press Enter" />
      <ChoiceGroup<Portion> label="How much?" options={PORTIONS} value={draft.portion} onChange={(portion) => update({ portion })} clearable columns={3} />
      <Toggle label="Outside food" checked={draft.outside} onChange={(outside) => update({ outside })} hint="Restaurant, stall or delivery." />
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <label className="field-label !mb-0" htmlFor="meal-note">
            A note <span className="font-normal text-[var(--ink-muted)]">(optional)</span>
          </label>
          {/* Small and out of the way, so a full meal still fits one frame (DESIGN.md 8.3). */}
          {onClear ? (
            <button type="button" className="text-[0.875rem] font-semibold text-[var(--alert-text)] underline" onClick={() => setClearing(true)}>
              Clear this meal
            </button>
          ) : null}
        </div>
        <input id="meal-note" className="field" maxLength={LIMITS.note} placeholder="For example, very spicy" value={draft.note} onChange={(event) => update({ note: event.target.value })} />
      </div>
      {onClear ? (
        <ConfirmDialog open={clearing} title={`Clear ${mealLabel(meal).toLowerCase()}?`} confirmLabel="Clear" onCancel={() => setClearing(false)} onConfirm={onClear}>
          <p className="m-0">It is removed from this day. Other meals stay.</p>
        </ConfirmDialog>
      ) : null}
    </EditorScreen>
  );
}
