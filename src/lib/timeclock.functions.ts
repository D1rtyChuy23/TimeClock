import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { PTO_NEXT, canPto, canSetRole, type PtoAction, type PtoStatus } from "@/lib/clock-machine";
import type { Sql } from "@/lib/db";

export type Role = "admin" | "employee";

export type Profile = {
  userId: string;
  fullName: string;
  email: string;
  role: Role;
  ptoAllowance: number;
  createdAt: string;
};

export type Punch = {
  id: number;
  userId: string;
  clockIn: string;
  clockOut: string | null;
  manual: boolean;
  createdBy: string | null;
};

export type PtoRequest = {
  id: number;
  userId: string;
  day: string;
  hours: number;
  note: string | null;
  status: "pending" | "approved" | "denied";
  decidedBy: string | null;
  createdAt: string;
};

export type Holiday = { day: string; name: string };

/** Approved time off everyone can see. Notes stay off this list. */
export type OffDay = {
  id: number;
  userId: string;
  fullName: string;
  day: string;
  hours: number;
};

export type Snapshot = {
  me: Profile;
  people: Profile[];
  punches: Punch[];
  pto: PtoRequest[];
  holidays: Holiday[];
  offDays: OffDay[];
  serverNow: string;
};

export type ClockResult = { ok: true; data: Snapshot } | { ok: false; error: string };

const CODES = new Set([
  "not_allowed",
  "not_found",
  "too_long",
  "bad_range",
  "future",
  "bad_hours",
  "bad_day",
  "bad_note",
  "bad_name",
  "last_admin",
  "duplicate",
  "not_open",
  "already_in",
  "already_out",
  "changed",
  "error",
]);

function fail(error: string): ClockResult {
  return { ok: false, error: CODES.has(error) ? error : "error" };
}

function asRecord(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object") return {};
  return v as Record<string, unknown>;
}

function num(v: unknown): number {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return Number.NaN;
}

function iso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function dayStr(v: unknown): string {
  if (typeof v === "string") return v.slice(0, 10);
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return "";
}

function isDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function mapProfile(row: Record<string, unknown>): Profile {
  const role = row.role === "admin" ? "admin" : "employee";
  return {
    userId: String(row.user_id),
    fullName: String(row.full_name ?? ""),
    email: String(row.email ?? ""),
    role,
    ptoAllowance: num(row.pto_allowance) || 0,
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
  };
}

function mapPunch(row: Record<string, unknown>): Punch {
  return {
    id: num(row.id),
    userId: String(row.user_id),
    clockIn: iso(row.clock_in) ?? new Date(0).toISOString(),
    clockOut: iso(row.clock_out),
    manual: row.manual === true || row.manual === "t" || row.manual === "true",
    createdBy: row.created_by == null ? null : String(row.created_by),
  };
}

function mapPto(row: Record<string, unknown>): PtoRequest {
  const status = row.status === "approved" || row.status === "denied" ? row.status : "pending";
  const note = row.note == null || row.note === "" ? null : String(row.note);
  return {
    id: num(row.id),
    userId: String(row.user_id),
    day: dayStr(row.day),
    hours: num(row.hours),
    note,
    status,
    decidedBy: row.decided_by == null ? null : String(row.decided_by),
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
  };
}

async function sqlClient(): Promise<Sql> {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

async function ensureProfile(sql: Sql, userId: string): Promise<Profile> {
  const users = await sql<Record<string, unknown>>`
    select id, name, email from "user" where id = ${userId}
  `;
  const user = users[0];
  if (!user) throw new Error("not_found");
  const name = String(user.name ?? "").trim().slice(0, 80);
  const email = String(user.email ?? "").slice(0, 200);
  const rows = await sql<Record<string, unknown>>`
    insert into profiles (user_id, full_name, email, role)
    select ${userId}, ${name}, ${email},
      case when exists (select 1 from profiles where role = 'admin') then 'employee' else 'admin' end
    on conflict (user_id) do update set
      email = excluded.email,
      full_name = case when profiles.full_name = '' then excluded.full_name else profiles.full_name end
    returning user_id, full_name, email, role, pto_allowance, created_at
  `;
  return mapProfile(rows[0]);
}

async function snapshot(sql: Sql, userId: string): Promise<Snapshot> {
  const me = await ensureProfile(sql, userId);
  const admin = me.role === "admin";
  const people = admin
    ? (await sql<Record<string, unknown>>`
        select user_id, full_name, email, role, pto_allowance, created_at
        from profiles order by full_name asc, email asc
      `).map(mapProfile)
    : [me];
  const punchRows = admin
    ? await sql<Record<string, unknown>>`
        select id, user_id, clock_in, clock_out, manual, created_by
        from punches
        where clock_in >= now() - interval '90 days'
           or clock_out is null
           or clock_out >= now() - interval '90 days'
        order by clock_in desc
      `
    : await sql<Record<string, unknown>>`
        select id, user_id, clock_in, clock_out, manual, created_by
        from punches
        where user_id = ${userId}
          and (
            clock_in >= now() - interval '90 days'
            or clock_out is null
            or clock_out >= now() - interval '90 days'
          )
        order by clock_in desc
      `;
  const ptoRows = admin
    ? await sql<Record<string, unknown>>`
        select id, user_id, day, hours, note, status, decided_by, created_at
        from pto_requests
        where day >= date_trunc('year', current_date)::date
           or status = 'pending'
        order by day desc, id desc
      `
    : await sql<Record<string, unknown>>`
        select id, user_id, day, hours, note, status, decided_by, created_at
        from pto_requests
        where user_id = ${userId}
          and (day >= date_trunc('year', current_date)::date or status = 'pending')
        order by day desc, id desc
      `;
  const holidayRows = await sql<Record<string, unknown>>`
    select day, name from holidays order by day asc
  `;
  const offRows = await sql<Record<string, unknown>>`
    select r.id, r.user_id, r.day, r.hours,
           coalesce(nullif(p.full_name, ''), p.email, '') as full_name
    from pto_requests r
    join profiles p on p.user_id = r.user_id
    where r.status = 'approved'
    order by r.day asc, full_name asc
  `;
  return {
    me,
    people,
    punches: punchRows.map(mapPunch),
    pto: ptoRows.map(mapPto),
    holidays: holidayRows.map((row) => ({ day: dayStr(row.day), name: String(row.name ?? "") })),
    offDays: offRows.map((row) => ({
      id: num(row.id),
      userId: String(row.user_id),
      fullName: String(row.full_name ?? ""),
      day: dayStr(row.day),
      hours: num(row.hours),
    })),
    serverNow: new Date().toISOString(),
  };
}

async function requireAdmin(sql: Sql, userId: string): Promise<Profile> {
  const me = await ensureProfile(sql, userId);
  if (me.role !== "admin") throw new Error("not_allowed");
  return me;
}

function knownError(e: unknown): string | null {
  if (!(e instanceof Error)) return null;
  if (CODES.has(e.message)) return e.message;
  if (/duplicate key|unique constraint/i.test(e.message)) return "duplicate";
  return null;
}

async function run(userId: string, fn: (sql: Sql) => Promise<void>): Promise<ClockResult> {
  try {
    const sql = await sqlClient();
    await fn(sql);
    return { ok: true, data: await snapshot(sql, userId) };
  } catch (e) {
    const code = knownError(e);
    if (!code) console.error(e);
    return fail(code ?? "error");
  }
}

export const loadClock = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<Snapshot> => {
    const sql = await sqlClient();
    return snapshot(sql, context.userId);
  });

export const togglePunch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => {
    const o = asRecord(raw);
    const target = typeof o.targetUserId === "string" ? o.targetUserId : "";
    const action = o.action === "in" || o.action === "out" ? o.action : "";
    return { targetUserId: target, action };
  })
  .handler(async ({ context, data }): Promise<ClockResult> => {
    return run(context.userId, async (sql) => {
      const me = await ensureProfile(sql, context.userId);
      const target = data.targetUserId && data.targetUserId !== context.userId ? data.targetUserId : context.userId;
      if (target !== context.userId && me.role !== "admin") throw new Error("not_allowed");
      // Shift machine (clock-machine.ts): the screen names the direction. With no
      // action (a page loaded before this change) it still flips, as it used to.
      if (data.action !== "in") {
        const closed = await sql<{ id: number }>`
          update punches set clock_out = now()
          where user_id = ${target} and clock_out is null
          returning id
        `;
        if (closed.length > 0) return;
        if (data.action === "out") throw new Error("already_out");
      }
      // one_open_punch makes a second open shift a no-op instead of an error.
      const opened = await sql<{ id: number }>`
        insert into punches (user_id, clock_in, manual, created_by)
        values (${target}, now(), false, ${context.userId})
        on conflict do nothing
        returning id
      `;
      if (opened.length === 0) throw new Error("already_in");
    });
  });

export const forceOut = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => {
    const o = asRecord(raw);
    return { userId: typeof o.userId === "string" ? o.userId : "" };
  })
  .handler(async ({ context, data }): Promise<ClockResult> => {
    return run(context.userId, async (sql) => {
      await requireAdmin(sql, context.userId);
      if (!data.userId) throw new Error("not_found");
      const closed = await sql`
        update punches set clock_out = now()
        where user_id = ${data.userId} and clock_out is null
        returning id
      `;
      if (closed.length === 0) throw new Error("not_open");
    });
  });

export const requestPto = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => {
    const o = asRecord(raw);
    return {
      day: typeof o.day === "string" ? o.day : "",
      hours: num(o.hours),
      note: typeof o.note === "string" ? o.note : "",
    };
  })
  .handler(async ({ context, data }): Promise<ClockResult> => {
    return run(context.userId, async (sql) => {
      await ensureProfile(sql, context.userId);
      if (!isDay(data.day)) throw new Error("bad_day");
      if (!Number.isFinite(data.hours) || data.hours <= 0 || data.hours > 24) throw new Error("bad_hours");
      const note = data.note.trim().slice(0, 200);
      if (data.note.trim().length > 200) throw new Error("bad_note");
      const hours = Math.round(data.hours * 100) / 100;
      await sql`
        insert into pto_requests (user_id, day, hours, note, status)
        values (${context.userId}, ${data.day}, ${hours}, ${note || null}, 'pending')
      `;
    });
  });

export const cancelPto = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => ({ id: num(asRecord(raw).id) }))
  .handler(async ({ context, data }): Promise<ClockResult> => {
    return run(context.userId, async (sql) => {
      const me = await ensureProfile(sql, context.userId);
      const rows = await sql<Record<string, unknown>>`
        select id, user_id, status, day from pto_requests where id = ${data.id}
      `;
      const row = rows[0];
      if (!row) throw new Error("not_found");
      // The server does not know the person's time zone, so "today" here is UTC
      // yesterday: nobody is refused a cancel their own screen still offers.
      const cutoff = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const who = {
        owner: String(row.user_id) === context.userId,
        admin: me.role === "admin",
        daysUntil: Math.round((Date.parse(dayStr(row.day)) - Date.parse(cutoff)) / 86_400_000),
      };
      if (!canPto("cancel", mapPto(row).status, who)) throw new Error("not_allowed");
      await sql`delete from pto_requests where id = ${data.id}`;
    });
  });

export const decidePto = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => {
    const o = asRecord(raw);
    const status = o.status === "approved" || o.status === "denied" || o.status === "pending" ? o.status : "";
    return { id: num(o.id), status };
  })
  .handler(async ({ context, data }): Promise<ClockResult> => {
    return run(context.userId, async (sql) => {
      await requireAdmin(sql, context.userId);
      const action = (Object.keys(PTO_NEXT) as Array<Exclude<PtoAction, "cancel">>).find(
        (a) => PTO_NEXT[a] === data.status,
      );
      if (!action) throw new Error("not_allowed");
      const found = await sql<{ status: PtoStatus }>`select status from pto_requests where id = ${data.id}`;
      if (found.length === 0) throw new Error("not_found");
      // Someone else already decided it: refuse instead of silently overwriting.
      if (!canPto(action, found[0].status, { owner: false, admin: true, daysUntil: 0 })) {
        throw new Error("changed");
      }
      const rows = await sql`
        update pto_requests
        set status = ${data.status}, decided_by = ${data.status === "pending" ? null : context.userId}
        where id = ${data.id} and status = ${found[0].status}
        returning id
      `;
      if (rows.length === 0) throw new Error("changed");
    });
  });

export const setAllowance = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => {
    const o = asRecord(raw);
    return { userId: typeof o.userId === "string" ? o.userId : "", hours: num(o.hours) };
  })
  .handler(async ({ context, data }): Promise<ClockResult> => {
    return run(context.userId, async (sql) => {
      await requireAdmin(sql, context.userId);
      if (!data.userId) throw new Error("not_found");
      if (!Number.isFinite(data.hours) || data.hours < 0 || data.hours > 999.99) throw new Error("bad_hours");
      const hours = Math.round(data.hours * 100) / 100;
      const rows = await sql`
        update profiles set pto_allowance = ${hours} where user_id = ${data.userId} returning user_id
      `;
      if (rows.length === 0) throw new Error("not_found");
    });
  });

export const setRole = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => {
    const o = asRecord(raw);
    const role = o.role === "admin" || o.role === "employee" ? o.role : "";
    return { userId: typeof o.userId === "string" ? o.userId : "", role };
  })
  .handler(async ({ context, data }): Promise<ClockResult> => {
    return run(context.userId, async (sql) => {
      await requireAdmin(sql, context.userId);
      if (!data.userId || (data.role !== "admin" && data.role !== "employee")) throw new Error("not_allowed");
      const left = await sql<{ n: number }>`
        select count(*) as n from profiles where role = 'admin' and user_id <> ${data.userId}
      `;
      if (!canSetRole(data.role, num(left[0]?.n))) throw new Error("last_admin");
      const rows = await sql`
        update profiles set role = ${data.role} where user_id = ${data.userId} returning user_id
      `;
      if (rows.length === 0) throw new Error("not_found");
    });
  });

export const deletePunch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => ({ id: num(asRecord(raw).id) }))
  .handler(async ({ context, data }): Promise<ClockResult> => {
    return run(context.userId, async (sql) => {
      await requireAdmin(sql, context.userId);
      const rows = await sql`delete from punches where id = ${data.id} returning id`;
      if (rows.length === 0) throw new Error("not_found");
    });
  });

export const addPunch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => {
    const o = asRecord(raw);
    return {
      userId: typeof o.userId === "string" ? o.userId : "",
      clockIn: typeof o.clockIn === "string" ? o.clockIn : "",
      clockOut: typeof o.clockOut === "string" ? o.clockOut : "",
    };
  })
  .handler(async ({ context, data }): Promise<ClockResult> => {
    return run(context.userId, async (sql) => {
      await requireAdmin(sql, context.userId);
      const start = new Date(data.clockIn);
      const end = new Date(data.clockOut);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        throw new Error("bad_range");
      }
      const hours = (end.getTime() - start.getTime()) / 3_600_000;
      if (hours > 16) throw new Error("too_long");
      if (end.getTime() > Date.now() + 120_000) throw new Error("future");
      const who = await sql`select user_id from profiles where user_id = ${data.userId}`;
      if (who.length === 0) throw new Error("not_found");
      await sql`
        insert into punches (user_id, clock_in, clock_out, manual, created_by)
        values (${data.userId}, ${start.toISOString()}, ${end.toISOString()}, true, ${context.userId})
      `;
    });
  });

export const addHoliday = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => {
    const o = asRecord(raw);
    return {
      day: typeof o.day === "string" ? o.day : "",
      name: typeof o.name === "string" ? o.name : "",
    };
  })
  .handler(async ({ context, data }): Promise<ClockResult> => {
    return run(context.userId, async (sql) => {
      await requireAdmin(sql, context.userId);
      const name = data.name.trim();
      if (!isDay(data.day)) throw new Error("bad_day");
      if (name.length < 1 || name.length > 60) throw new Error("bad_name");
      await sql`insert into holidays (day, name) values (${data.day}, ${name})`;
    });
  });

export const deleteHoliday = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => {
    const o = asRecord(raw);
    return { day: typeof o.day === "string" ? o.day : "" };
  })
  .handler(async ({ context, data }): Promise<ClockResult> => {
    return run(context.userId, async (sql) => {
      await requireAdmin(sql, context.userId);
      const rows = await sql`delete from holidays where day = ${data.day} returning day`;
      if (rows.length === 0) throw new Error("not_found");
    });
  });
