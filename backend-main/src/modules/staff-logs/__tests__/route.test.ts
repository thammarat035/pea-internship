import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

const mockLog = mock();
const mockFindAll = mock();

mock.module("../service", () => ({
  StaffLogsService: class {
    log = mockLog;
    findAll = mockFindAll;
  },
}));

mock.module("@/db", () => ({ db: {} }));

const FAKE_USER = { id: "fake-admin-id", roleId: 1 };
const FAKE_SESSION = { id: "fake-session-id", userId: FAKE_USER.id };

mock.module("@/middlewares/auth.middleware", () => ({
  isAuthenticated: new Elysia({ name: "better-auth" }).macro({
    role: () => ({ resolve: () => ({ user: FAKE_USER, session: FAKE_SESSION }) }),
  }),
}));

const { staffLogs } = await import("../index");

describe("staff-logs routes", () => {
  beforeEach(() => {
    mockLog.mockReset();
    mockFindAll.mockReset();
  });

  it("POST /staff-logs/ เรียก service.log ด้วย session.userId และ action คืน status 201", async () => {
    mockLog.mockResolvedValue(undefined);

    const response = await staffLogs.handle(
      new Request("http://localhost/staff-logs/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "DID_SOMETHING" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mockLog).toHaveBeenCalledWith(
      expect.anything(),
      FAKE_SESSION.userId,
      "DID_SOMETHING",
    );
  });

  it("GET /staff-logs/ เรียก service.findAll ด้วย session.userId และ query", async () => {
    mockFindAll.mockResolvedValue([]);

    const response = await staffLogs.handle(
      new Request("http://localhost/staff-logs/?userId=user-1"),
    );

    expect(response.status).toBe(200);
    expect(mockFindAll).toHaveBeenCalledWith(
      FAKE_SESSION.userId,
      expect.objectContaining({ userId: "user-1" }),
    );
  });
});

afterAll(() => {
  mock.restore();
});
