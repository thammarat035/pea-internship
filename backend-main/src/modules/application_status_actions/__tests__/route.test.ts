import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

// ---------------------------------------------------------------------------
// เทส route ทั้ง 2 endpoint ของ application_status_actions โดย mock service
// ทั้งคลาส — ทั้งสอง endpoint ใช้ "auth: true" (ล็อกอินแล้วคนไหนก็เรียกได้
// การเช็คสิทธิ์เป็นรายใบสมัครทำในชั้น service เอง)
// ---------------------------------------------------------------------------

const mockGetByApplicationStatusId = mock();
const mockGetMyActions = mock();

mock.module("../service", () => ({
  ApplicationStatusActionService: class {
    getByApplicationStatusId = mockGetByApplicationStatusId;
    getMyActions = mockGetMyActions;
  },
}));

const FAKE_USER = { id: "fake-user-id", roleId: 3 };
const FAKE_SESSION = { id: "fake-session-id", userId: FAKE_USER.id };

mock.module("@/middlewares/auth.middleware", () => ({
  isAuthenticated: new Elysia({ name: "better-auth" }).macro({
    auth: {
      resolve: () => ({ user: FAKE_USER, session: FAKE_SESSION }),
    },
  }),
}));

const { applicationStatusActionsModule } = await import("../index");

describe("application_status_actions routes", () => {
  beforeEach(() => {
    mockGetByApplicationStatusId.mockReset();
    mockGetMyActions.mockReset();
  });

  describe("GET /application-status-actions/:applicationStatusId", () => {
    it("เรียก service.getByApplicationStatusId ด้วย session.userId, id (แปลงเป็นตัวเลข) และ query", async () => {
      mockGetByApplicationStatusId.mockResolvedValue([]);

      const response = await applicationStatusActionsModule.handle(
        new Request(
          "http://localhost/application-status-actions/10?limit=20&offset=5",
        ),
      );

      expect(response.status).toBe(200);
      expect(mockGetByApplicationStatusId).toHaveBeenCalledWith(
        FAKE_SESSION.userId,
        10,
        expect.objectContaining({ limit: 20, offset: 5 }),
      );
    });
  });

  describe("GET /application-status-actions/me", () => {
    it("เรียก service.getMyActions ด้วย session.userId และ query", async () => {
      mockGetMyActions.mockResolvedValue([]);

      const response = await applicationStatusActionsModule.handle(
        new Request("http://localhost/application-status-actions/me?limit=10"),
      );

      expect(response.status).toBe(200);
      expect(mockGetMyActions).toHaveBeenCalledWith(
        FAKE_SESSION.userId,
        expect.objectContaining({ limit: 10 }),
      );
    });
  });
});

afterAll(() => {
  mock.restore();
});
