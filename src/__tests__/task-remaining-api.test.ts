import { NextRequest } from "next/server";

import * as blockComplete from "@/app/api/scheduled-blocks/[id]/complete/route";
import * as logTime from "@/app/api/tasks/[id]/log-time/route";
import * as taskRoute from "@/app/api/tasks/[id]/route";

type Row = Record<string, unknown> & { id: string };

const db: { tasks: Row[]; blocks: Row[] } = { tasks: [], blocks: [] };

function matches(row: Row, where: Record<string, unknown> = {}) {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function withRelations(row: Row | undefined) {
  return row ? { ...row, tags: [], project: null } : null;
}

const taskApi = {
  findUnique: jest.fn(async ({ where }) =>
    withRelations(db.tasks.find((t) => matches(t, where)))
  ),
  findFirst: jest.fn(async ({ where }) =>
    withRelations(db.tasks.find((t) => matches(t, where)))
  ),
  update: jest.fn(async ({ where, data }) => {
    const row = db.tasks.find((t) => t.id === where.id)!;
    for (const [key, value] of Object.entries(data)) {
      if (key === "tags" || key === "project") continue;
      if (value !== undefined) row[key] = value;
    }
    return withRelations(row);
  }),
  create: jest.fn(async ({ data }) => {
    const row = { id: `t${db.tasks.length + 1}`, ...data } as Row;
    db.tasks.push(row);
    return withRelations(row);
  }),
};

const blockApi = {
  findFirst: jest.fn(async ({ where }) => {
    const block = db.blocks.find((b) => matches(b, where));
    return block
      ? { ...block, task: db.tasks.find((t) => t.id === block.taskId) }
      : null;
  }),
  findMany: jest.fn(async ({ where }) =>
    db.blocks
      .filter((b) => matches(b, where))
      .sort((a, b) => (a.start as Date).getTime() - (b.start as Date).getTime())
  ),
  delete: jest.fn(async ({ where }) => {
    db.blocks = db.blocks.filter((b) => b.id !== where.id);
  }),
  deleteMany: jest.fn(async () => ({ count: 0 })),
  updateMany: jest.fn(async () => ({ count: 0 })),
  create: jest.fn(),
};

jest.mock("@/lib/prisma", () => {
  // Getters: jest.mock is hoisted above the fakes' declarations.
  const prisma: Record<string, unknown> = {
    get task() {
      return taskApi;
    },
    get scheduledBlock() {
      return blockApi;
    },
    taskListMapping: { findFirst: jest.fn(async () => null) },
    $transaction: jest.fn(
      async (arg: unknown): Promise<unknown> =>
        typeof arg === "function" ? arg(prisma) : Promise.all(arg as unknown[])
    ),
  };
  return { prisma };
});
jest.mock("@/lib/auth/api-auth", () => ({
  authenticateRequest: jest.fn(async () => ({ userId: "u1" })),
}));
jest.mock("@/lib/replan-coordinator", () => ({ requestReplan: jest.fn() }));
jest.mock("@/lib/user-timezone", () => ({
  getUserTimeZone: jest.fn(async () => "UTC"),
}));
jest.mock("@/lib/task-block-push", () => ({
  schedulePushTaskBlock: jest.fn(),
  deleteTaskBlockEvent: jest.fn(),
}));
jest.mock("@/lib/task-sync/task-change-tracker", () => ({
  TaskChangeTracker: jest.fn(),
}));
jest.mock("@/lib/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { requestReplan } = jest.requireMock("@/lib/replan-coordinator");

function request(path: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost:3012${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** Route handlers are typed as possibly returning undefined. */
async function call(response: Promise<Response | undefined>) {
  const res = await response;
  if (!res) throw new Error("No response");
  return res;
}

function seedTask(overrides: Partial<Row> = {}) {
  db.tasks = [
    {
      id: "task-1",
      userId: "u1",
      title: "Write report",
      status: "todo",
      duration: 240,
      remainingMinutes: 240,
      isRecurring: false,
      recurrenceRule: null,
      scheduleLocked: false,
      scheduledStart: null,
      scheduledEnd: null,
      projectId: null,
      dueDate: null,
      startDate: null,
      tags: [],
      ...overrides,
    },
  ];
}

beforeEach(() => {
  jest.clearAllMocks();
  db.blocks = [];
  seedTask();
});

describe("POST /api/tasks/:id/log-time", () => {
  it("subtracts the minutes and re-plans", async () => {
    const res = await call(
      logTime.POST(
        request("/api/tasks/task-1/log-time", "POST", { minutes: 90 }),
        params("task-1")
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.remainingMinutes).toBe(150);
    expect(body.status).toBe("todo");
    expect(requestReplan).toHaveBeenCalledWith("u1");
  });

  it("completes the task when nothing is left", async () => {
    seedTask({ remainingMinutes: 60 });
    const res = await call(
      logTime.POST(
        request("/api/tasks/task-1/log-time", "POST", { minutes: 60 }),
        params("task-1")
      )
    );
    const body = await res.json();
    expect(body.remainingMinutes).toBe(0);
    expect(body.status).toBe("completed");
    expect(db.tasks[0].completedAt).toBeInstanceOf(Date);
  });

  it("rejects invalid minutes and completed tasks", async () => {
    const bad = await call(
      logTime.POST(
        request("/api/tasks/task-1/log-time", "POST", { minutes: -5 }),
        params("task-1")
      )
    );
    expect(bad.status).toBe(400);
    seedTask({ status: "completed" });
    const done = await call(
      logTime.POST(
        request("/api/tasks/task-1/log-time", "POST", { minutes: 5 }),
        params("task-1")
      )
    );
    expect(done.status).toBe(409);
  });
});

describe("POST /api/scheduled-blocks/:id/complete", () => {
  it("subtracts the chunk's minutes and removes the chunk", async () => {
    db.blocks = [
      {
        id: "b1",
        userId: "u1",
        taskId: "task-1",
        start: new Date("2026-11-23T14:00:00Z"),
        end: new Date("2026-11-23T15:30:00Z"),
        locked: false,
      },
      {
        id: "b2",
        userId: "u1",
        taskId: "task-1",
        start: new Date("2026-11-24T14:00:00Z"),
        end: new Date("2026-11-24T16:30:00Z"),
        locked: false,
      },
    ];
    const res = await call(
      blockComplete.POST(
        request("/api/scheduled-blocks/b1/complete", "POST"),
        params("b1")
      )
    );
    const body = await res.json();
    expect(body.remainingMinutes).toBe(150);
    expect(db.blocks.map((b) => b.id)).toEqual(["b2"]);
    expect(requestReplan).toHaveBeenCalledWith("u1");
  });

  it("completes the task with its last chunk", async () => {
    seedTask({ remainingMinutes: 30 });
    db.blocks = [
      {
        id: "b1",
        userId: "u1",
        taskId: "task-1",
        start: new Date("2026-11-23T14:00:00Z"),
        end: new Date("2026-11-23T14:30:00Z"),
        locked: false,
      },
    ];
    const res = await call(
      blockComplete.POST(
        request("/api/scheduled-blocks/b1/complete", "POST"),
        params("b1")
      )
    );
    const body = await res.json();
    expect(body.status).toBe("completed");
    expect(body.remainingMinutes).toBe(0);
    expect(db.blocks).toHaveLength(0);
  });

  it("unlocks a locked task whose last locked chunk is done", async () => {
    seedTask({ scheduleLocked: true });
    db.blocks = [
      {
        id: "b1",
        userId: "u1",
        taskId: "task-1",
        start: new Date("2026-11-23T14:00:00Z"),
        end: new Date("2026-11-23T15:00:00Z"),
        locked: true,
      },
    ];
    const res = await call(
      blockComplete.POST(
        request("/api/scheduled-blocks/b1/complete", "POST"),
        params("b1")
      )
    );
    const body = await res.json();
    expect(body.remainingMinutes).toBe(180);
    expect(body.scheduleLocked).toBe(false);
    expect(body.scheduledStart).toBeNull();
  });
});

describe("PUT /api/tasks/:id remaining time", () => {
  it("keeps worked minutes when the duration is edited", async () => {
    seedTask({ remainingMinutes: 90 }); // 150 worked
    const res = await call(
      taskRoute.PUT(
        request("/api/tasks/task-1", "PUT", { duration: 300 }),
        params("task-1")
      )
    );
    const body = await res.json();
    expect(body.duration).toBe(300);
    expect(body.remainingMinutes).toBe(150);
  });

  it("ignores an echoed remaining value on a full-object save", async () => {
    seedTask({ remainingMinutes: 90 });
    const res = await call(
      taskRoute.PUT(
        request("/api/tasks/task-1", "PUT", {
          ...db.tasks[0],
          duration: 180,
          remainingMinutes: 90,
        }),
        params("task-1")
      )
    );
    expect((await res.json()).remainingMinutes).toBe(30);
  });

  it("completes the task when a duration edit leaves nothing to do", async () => {
    seedTask({ remainingMinutes: 90 });
    const res = await call(
      taskRoute.PUT(
        request("/api/tasks/task-1", "PUT", { duration: 120 }),
        params("task-1")
      )
    );
    const body = await res.json();
    expect(body.remainingMinutes).toBe(0);
    expect(body.status).toBe("completed");
  });

  it("applies a shorten fix (duration and remaining together)", async () => {
    seedTask({ remainingMinutes: 180 }); // 60 worked
    const res = await call(
      taskRoute.PUT(
        request("/api/tasks/task-1", "PUT", {
          duration: 180,
          remainingMinutes: 120,
        }),
        params("task-1")
      )
    );
    const body = await res.json();
    expect(body).toMatchObject({ duration: 180, remainingMinutes: 120 });
  });

  it("restores the remaining time when a finished task is reopened", async () => {
    seedTask({ status: "completed", remainingMinutes: 0 });
    const res = await call(
      taskRoute.PUT(
        request("/api/tasks/task-1", "PUT", { status: "todo" }),
        params("task-1")
      )
    );
    expect((await res.json()).remainingMinutes).toBe(240);
  });
});
