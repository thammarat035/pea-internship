import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

// ---------------------------------------------------------------------------
// เทส route ทั้ง 9 endpoint ของ auth module โดย mock AuthService ทั้งคลาส
// จุดพิเศษ: /sign-in/keycloak และ /sign-in/keycloak/itt มี logic เพิ่มเติมใน
// route เอง (ไม่ใช่แค่ forward ไป service ตรงๆ) — อ่าน body ของ Response ที่
// service คืนมา แล้วถ้ามี `url` จะสร้าง 302 redirect ใหม่พร้อม header
// Location เอง จึงต้อง mock ให้ service คืนค่าเป็น Response object จริงๆ
// (ไม่ใช่ plain object) เพราะ route เรียก .clone()/.json() ตรงๆ
// ---------------------------------------------------------------------------

const mockRegisterIntern = mock();
const mockLogin = mock();
const mockLoginItt = mock();
const mockLoginWithKeycloak = mock();
const mockLoginWithKeycloakiTT = mock();
const mockRequestResetPassword = mock();
const mockVerifyResetCode = mock();
const mockResetPassword = mock();
const mockLogout = mock();

mock.module("../service", () => ({
  AuthService: class {
    registerIntern = mockRegisterIntern;
    login = mockLogin;
    login_itt = mockLoginItt;
    loginWithKeycloak = mockLoginWithKeycloak;
    loginWithKeycloakiTT = mockLoginWithKeycloakiTT;
    requestResetPassword = mockRequestResetPassword;
    verifyResetCode = mockVerifyResetCode;
    resetPassword = mockResetPassword;
    logout = mockLogout;
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

const { auth } = await import("../index");

describe("auth routes", () => {
  beforeEach(() => {
    mockRegisterIntern.mockReset();
    mockLogin.mockReset();
    mockLoginItt.mockReset();
    mockLoginWithKeycloak.mockReset();
    mockLoginWithKeycloakiTT.mockReset();
    mockRequestResetPassword.mockReset();
    mockVerifyResetCode.mockReset();
    mockResetPassword.mockReset();
    mockLogout.mockReset();
  });

  it("POST /auth/sign-up/intern เรียก service.registerIntern ด้วย body คืน status 201", async () => {
    mockRegisterIntern.mockResolvedValue({ success: true });

    const response = await auth.handle(
      new Request("http://localhost/auth/sign-up/intern", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fname: "สมชาย",
          lname: "ใจดี",
          phoneNumber: "0812345678",
          email: "a@b.com",
          password: "password123",
          gender: "MALE",
          institutionId: 1,
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mockRegisterIntern).toHaveBeenCalledWith(
      expect.objectContaining({ email: "a@b.com" }),
    );
  });

  it("POST /auth/sign-in/intern เรียก service.login ด้วย body", async () => {
    mockLogin.mockResolvedValue(new Response("{}", { status: 200 }));

    const response = await auth.handle(
      new Request("http://localhost/auth/sign-in/intern", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: "0812345678", password: "password123" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockLogin).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumber: "0812345678" }),
    );
  });

  it("POST /auth/sign-in/intern/itt เรียก service.login_itt ด้วย body", async () => {
    mockLoginItt.mockResolvedValue(new Response("{}", { status: 200 }));

    await auth.handle(
      new Request("http://localhost/auth/sign-in/intern/itt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: "0812345678", password: "password123" }),
      }),
    );

    expect(mockLoginItt).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumber: "0812345678" }),
    );
  });

  it("GET /auth/sign-in/keycloak redirect ไป url ที่ service คืนมา (302 พร้อม Location header)", async () => {
    mockLoginWithKeycloak.mockResolvedValue(
      new Response(JSON.stringify({ url: "https://keycloak.example.com/authorize" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await auth.handle(
      new Request("http://localhost/auth/sign-in/keycloak"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://keycloak.example.com/authorize",
    );
  });

  it("GET /auth/sign-in/keycloak คืน response เดิมตรงๆ เมื่อ body ไม่มี url", async () => {
    mockLoginWithKeycloak.mockResolvedValue(
      new Response(JSON.stringify({ error: "failed" }), { status: 400 }),
    );

    const response = await auth.handle(
      new Request("http://localhost/auth/sign-in/keycloak"),
    );

    expect(response.status).toBe(400);
  });

  it("GET /auth/sign-in/keycloak/itt redirect ไป url ที่ service คืนมา", async () => {
    mockLoginWithKeycloakiTT.mockResolvedValue(
      new Response(JSON.stringify({ url: "https://keycloak.example.com/itt" }), {
        status: 200,
      }),
    );

    const response = await auth.handle(
      new Request("http://localhost/auth/sign-in/keycloak/itt"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://keycloak.example.com/itt");
  });

  it("POST /auth/request-reset-password เรียก service.requestResetPassword ด้วย body", async () => {
    mockRequestResetPassword.mockResolvedValue({ success: true });

    const response = await auth.handle(
      new Request("http://localhost/auth/request-reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: "0812345678", email: "a@b.com" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockRequestResetPassword).toHaveBeenCalledWith(
      expect.objectContaining({ email: "a@b.com" }),
    );
  });

  it("POST /auth/verify-reset-code เรียก service.verifyResetCode ด้วย body", async () => {
    mockVerifyResetCode.mockResolvedValue({ success: true, resetToken: "abc" });

    const response = await auth.handle(
      new Request("http://localhost/auth/verify-reset-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: "0812345678", email: "a@b.com", code: "123456" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockVerifyResetCode).toHaveBeenCalledWith(
      expect.objectContaining({ code: "123456" }),
    );
  });

  it("POST /auth/reset-password เรียก service.resetPassword ด้วย body", async () => {
    mockResetPassword.mockResolvedValue({ success: true });

    const response = await auth.handle(
      new Request("http://localhost/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resetToken: "abc",
          password: "newpassword123",
          confirmPassword: "newpassword123",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockResetPassword).toHaveBeenCalledWith(
      expect.objectContaining({ resetToken: "abc" }),
    );
  });

  it("POST /auth/sign-out เรียก service.logout ด้วย headers และ user.id", async () => {
    mockLogout.mockResolvedValue(new Response("{}", { status: 200 }));

    const response = await auth.handle(
      new Request("http://localhost/auth/sign-out", { method: "POST" }),
    );

    expect(response.status).toBe(200);
    expect(mockLogout).toHaveBeenCalledWith(expect.any(Headers), FAKE_USER.id);
  });
});

afterAll(() => {
  mock.restore();
});
