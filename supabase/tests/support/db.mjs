// Test helpers: an in-process Postgres (PGlite) with our migrations applied,
// and a way to run queries as a Supabase role (user, guest, anon, service) the way PostgREST would.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "..", "migrations");

export async function createDb() {
  const db = new PGlite();
  await db.exec(readFileSync(join(here, "shim.sql"), "utf8"));
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
  return db;
}

/**
 * Runs `fn` inside a transaction as the given role with the given token claims.
 * The transaction is rolled back afterwards unless `commit` is true.
 */
export async function withRole(db, { role, sub = null, claims = {}, commit = false }, fn) {
  await db.exec("begin");
  let failed = true;
  try {
    const jwt = sub ? { sub, role, ...claims } : {};
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(jwt)]);
    await db.exec(`set local role ${role}`);
    const result = await fn(db);
    failed = false;
    return result;
  } finally {
    await db.exec(commit && !failed ? "commit" : "rollback");
  }
}

export const asUser = (db, sub, fn) =>
  withRole(db, { role: "authenticated", sub, claims: { is_anonymous: false } }, fn);
export const asGuest = (db, sub, fn) =>
  withRole(db, { role: "authenticated", sub, claims: { is_anonymous: true } }, fn);
export const asAnon = (db, fn) => withRole(db, { role: "anon" }, fn);
export const asService = (db, fn, commit = false) => withRole(db, { role: "service_role", commit }, fn);

// Fixtures are created as the database owner so they persist and bypass RLS.
export async function createUser(db, { anonymous = false, email = null, lastSignInAt = null, createdAt = null } = {}) {
  const result = await db.query(
    `insert into auth.users (email, is_anonymous, last_sign_in_at, created_at)
     values ($1, $2, $3, coalesce($4::timestamptz, now())) returning id`,
    [email, anonymous, lastSignInAt, createdAt]
  );
  return result.rows[0].id;
}

export async function createConversation(db, userId, title = "Headache") {
  const result = await db.query(
    "insert into public.conversations (user_id, title) values ($1, $2) returning id",
    [userId, title]
  );
  return result.rows[0].id;
}

export async function createMessage(db, conversationId, userId, role = "user", extra = {}) {
  const result = await db.query(
    `insert into public.messages (conversation_id, user_id, role, content, care_level, client_message_id)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [conversationId, userId, role, extra.content ?? "hello", extra.careLevel ?? null, extra.clientMessageId ?? null]
  );
  return result.rows[0].id;
}

export const daysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
