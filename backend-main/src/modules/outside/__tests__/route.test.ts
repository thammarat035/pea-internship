import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

// ---------------------------------------------------------------------------
// เทส route ทั้ง 6 endpoint ของ offsite-tasks โดย mock OffsiteTaskService
// ทั้งคลาส — ใช้ user.id/user.roleId (ไม่ใช่ session.userId) เป็น identity หลัก
// ---------------------------------------------------------------------------

const mockCreateTask = mock();
const mockUpdateTask = mock();
const mockDeleteTask = mock();
const mockGetTasksForDept = mock();
const mockGetTaskById = mock();
const mockGetTasksForStudent = mock();

mock.module("../service", () => ({
  OffsiteTaskService: class {
    createTask = mockCreateTask;
    updateTask = mockUpdateTask;
    deleteTask = mockDeleteTask;
    getTasksForDept = mockGetTasksForDept;
    getTaskById = mockGetTaskById;
    getTasksForStudent = mockGetTasksForStudent;
  },
}));

const FAKE_USER = { id: "fake-mentor-id", roleId: 2 };
const FAKE_SESSION = { id: "fake-session-id", userId: FAKE_USER.id };

mock.module("@/middlewares/auth.middleware", () => ({
  ROLE_IDS: { ADMIN: 1, MENTOR: 2, STUDENT: 3 },
  isAuthenticated: new Elysia({ name: "better-auth" }).macro({
    auth: {
      resolve: () => ({ user: FAKE_USER, session: FAKE_SESSION }),
    },
    role: () => ({
      resolve: () => ({ user: FAKE_USER, session: FAKE_SESSION }),
    }),
  }),
}));

const { offsiteTasks } = await import("../index");

describe("offsite-tasks routes", () => {
  beforeEach(() => {
    mockCreateTask.mockReset();
    mockUpdateTask.mockReset();
    mockDeleteTask.mockReset();
    mockGetTasksForDept.mockReset();
    mockGetTaskById.mockReset();
    mockGetTasksForStudent.mockReset();
  });

  it("POST /offsite-tasks/ เรียก service.createTask ด้วย user.id และ body คืน status 201", async () => {
    mockCreateTask.mockResolvedValue({ success: true, taskId: 1 });

    const response = await offsiteTasks.handle(
      new Request("http://localhost/offsite-tasks/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workDate: "2025-06-20",
          locationName: "บ้านลูกค้า A",
          taskDetail: "ติดตั้งระบบ",
          studentIds: ["student-1"],
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mockCreateTask).toHaveBeenCalledWith(
      FAKE_USER.id,
      expect.objectContaining({ locationName: "บ้านลูกค้า A" }),
    );
  });

  it("PATCH /offsite-tasks/:id เรียก service.updateTask ด้วย id (ตัวเลข), user.id และ body", async () => {
    mockUpdateTask.mockResolvedValue({ success: true });

    const response = await offsiteTasks.handle(
      new Request("http://localhost/offsite-tasks/5", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationName: "ที่ใหม่" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockUpdateTask).toHaveBeenCalledWith(
      5,
      FAKE_USER.id,
      expect.objectContaining({ locationName: "ที่ใหม่" }),
    );
  });

  it("DELETE /offsite-tasks/:id เรียก service.deleteTask ด้วย id (ตัวเลข) และ user.id", async () => {
    mockDeleteTask.mockResolvedValue({ success: true });

    const response = await offsiteTasks.handle(
      new Request("http://localhost/offsite-tasks/5", { method: "DELETE" }),
    );

    expect(response.status).toBe(200);
    expect(mockDeleteTask).toHaveBeenCalledWith(5, FAKE_USER.id);
  });

  it("GET /offsite-tasks/mentor เรียก service.getTasksForDept ด้วย user.id และ query", async () => {
    mockGetTasksForDept.mockResolvedValue({ data: [], meta: {} });

    const response = await offsiteTasks.handle(
      new Request("http://localhost/offsite-tasks/mentor?viewMode=all&page=2"),
    );

    expect(response.status).toBe(200);
    expect(mockGetTasksForDept).toHaveBeenCalledWith(
      FAKE_USER.id,
      expect.objectContaining({ viewMode: "all", page: 2 }),
    );
  });

  it("GET /offsite-tasks/:id เรียก service.getTaskById ด้วย id, user.id และ user.roleId", async () => {
    mockGetTaskById.mockResolvedValue({ id: 5 });

    const response = await offsiteTasks.handle(
      new Request("http://localhost/offsite-tasks/5"),
    );

    expect(response.status).toBe(200);
    expect(mockGetTaskById).toHaveBeenCalledWith(5, FAKE_USER.id, FAKE_USER.roleId);
  });

  it("GET /offsite-tasks/student เรียก service.getTasksForStudent ด้วย user.id", async () => {
    mockGetTasksForStudent.mockResolvedValue([]);

    const response = await offsiteTasks.handle(
      new Request("http://localhost/offsite-tasks/student"),
    );

    expect(response.status).toBe(200);
    expect(mockGetTasksForStudent).toHaveBeenCalledWith(FAKE_USER.id);
  });
});

afterAll(() => {
  mock.restore();
});
