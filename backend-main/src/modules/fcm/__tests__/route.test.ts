import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

const mockRegisterToken = mock();

mock.module("../service", () => ({
  FCMService: class {
    registerToken = mockRegisterToken;
  },
}));

const FAKE_USER = { id: "fake-user-id", roleId: 3 };
const FAKE_SESSION = { id: "fake-session-id", userId: FAKE_USER.id };

mock.module("@/middlewares/auth.middleware", () => ({
  isAuthenticated: new Elysia({ name: "better-auth" }).macro({
    role: () => ({ resolve: () => ({ user: FAKE_USER, session: FAKE_SESSION }) }),
  }),
}));

const { fcm } = await import("../index");

describe("fcm routes", () => {
  beforeEach(() => {
    mockRegisterToken.mockReset();
  });

  it("POST /fcm/notifications/register-token เรียก service.registerToken ด้วย user.id และ token", async () => {
    mockRegisterToken.mockResolvedValue(undefined);

    const response = await fcm.handle(
      new Request("http://localhost/fcm/notifications/register-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "device-token-abc" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockRegisterToken).toHaveBeenCalledWith(FAKE_USER.id, "device-token-abc");
  });
});

afterAll(() => {
  mock.restore();
});
