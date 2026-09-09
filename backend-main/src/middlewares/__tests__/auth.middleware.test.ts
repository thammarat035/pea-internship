import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

// ---------------------------------------------------------------------------
// เทส isAuthenticated ตัวจริง (ไม่ mock ทิ้งเหมือนทุกโมดูลที่ผ่านมา) —
// ทุกเทสของทั้ง 25 โมดูลก่อนหน้านี้ mock macro "auth"/"role" ให้ resolve
// user/session ปลอมตรงๆ เสมอ สมมติไว้ว่า middleware ตัวจริงทำงานถูก แต่ไม่เคย
// มีเทสไหนพิสูจน์เรื่องนั้นเลย ไฟล์นี้จึงเทส "ตัวจริง" ของ middleware โดย mock
// แค่ "@/lib/auth" (เฉพาะ auth.api.getSession ที่ macro เรียกใช้จริง) แล้วขับ
// ผ่าน route ที่ประกาศ auth:true / role:[...] จริงๆ ผ่าน Elysia app
//
// ใช้ errorMiddleware ตัวจริงประกอบด้วย เพื่อให้ UnauthorizedError/
// ForbiddenError ที่ macro throw ออกมา ถูกแปลงเป็น HTTP response แทนที่จะ
// หลุดเป็น unhandled rejection ในเทส
// ---------------------------------------------------------------------------

const mockGetSession = mock();

mock.module("@/lib/auth", () => ({
  auth: {
    handler: () => new Response(null, { status: 404 }),
    api: { getSession: mockGetSession },
  },
}));

const { isAuthenticated, ROLE_IDS } = await import("../auth.middleware");
const { errorMiddleware } = await import("../error.middleware");

function buildApp() {
  return new Elysia()
    .use(errorMiddleware)
    .use(isAuthenticated)
    .get("/needs-auth", ({ user, session }) => ({ user, session }), {
      auth: true,
    })
    .get("/admin-only", ({ user }) => ({ user }), {
      role: [ROLE_IDS.ADMIN],
    })
    .get("/admin-or-mentor", ({ user }) => ({ user }), {
      role: [ROLE_IDS.ADMIN, ROLE_IDS.MENTOR],
    })
    .get("/single-role-value", ({ user }) => ({ user }), {
      role: ROLE_IDS.MENTOR,
    });
}

beforeEach(() => {
  mockGetSession.mockReset();
});

afterAll(() => {
  mock.restore();
});

describe("ROLE_IDS", () => {
  it("มีค่าคงที่ตรงตาม role ในระบบ", () => {
    expect(ROLE_IDS).toEqual({ ADMIN: 1, MENTOR: 2, STUDENT: 3 });
  });
});

describe("isAuthenticated macro 'auth'", () => {
  it("throws 401 เมื่อไม่มี session เลย", async () => {
    const app = buildApp();
    mockGetSession.mockResolvedValueOnce(null);

    const response = await app.handle(
      new Request("http://localhost/needs-auth"),
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("UNAUTHORIZED");
  });

  it("ผ่านเข้า handler ได้พร้อม user/session จาก getSession เมื่อ login อยู่", async () => {
    const app = buildApp();
    mockGetSession.mockResolvedValueOnce({
      user: { id: "user-1", roleId: 3 },
      session: { id: "session-1" },
    });

    const response = await app.handle(
      new Request("http://localhost/needs-auth"),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user).toEqual({ id: "user-1", roleId: 3 });
    expect(body.session).toEqual({ id: "session-1" });
  });
});

describe("isAuthenticated macro 'role'", () => {
  it("throws 401 เมื่อไม่มี session เลย (เช็คก่อนเช็ค role ด้วยซ้ำ)", async () => {
    const app = buildApp();
    mockGetSession.mockResolvedValueOnce(null);

    const response = await app.handle(
      new Request("http://localhost/admin-only"),
    );

    expect(response.status).toBe(401);
  });

  it("throws 403 เมื่อ role ของผู้ใช้ไม่อยู่ใน allowed roles", async () => {
    const app = buildApp();
    mockGetSession.mockResolvedValueOnce({
      user: { id: "student-1", roleId: ROLE_IDS.STUDENT },
      session: { id: "session-1" },
    });

    const response = await app.handle(
      new Request("http://localhost/admin-only"),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("FORBIDDEN");
  });

  it("ผ่านเข้า handler ได้เมื่อ role ตรงกับที่อนุญาต (ค่าเดียว ไม่ใช่ array)", async () => {
    const app = buildApp();
    mockGetSession.mockResolvedValueOnce({
      user: { id: "admin-1", roleId: ROLE_IDS.ADMIN },
      session: { id: "session-1" },
    });

    const response = await app.handle(
      new Request("http://localhost/admin-only"),
    );

    expect(response.status).toBe(200);
  });

  it("รองรับ role หลายค่าพร้อมกัน (array) - ผ่านเมื่อ role อยู่ใน list", async () => {
    const app = buildApp();
    mockGetSession.mockResolvedValueOnce({
      user: { id: "mentor-1", roleId: ROLE_IDS.MENTOR },
      session: { id: "session-1" },
    });

    const response = await app.handle(
      new Request("http://localhost/admin-or-mentor"),
    );

    expect(response.status).toBe(200);
  });

  it("รองรับการส่ง role เป็นค่าเดี่ยว (ไม่ห่อ array) ใน route config ได้ด้วย", async () => {
    const app = buildApp();
    mockGetSession.mockResolvedValueOnce({
      user: { id: "mentor-1", roleId: ROLE_IDS.MENTOR },
      session: { id: "session-1" },
    });

    const response = await app.handle(
      new Request("http://localhost/single-role-value"),
    );

    expect(response.status).toBe(200);
  });

  it("throws 403 เมื่อ role อยู่ใน array ที่อนุญาตแต่ผู้ใช้ไม่ตรงสักตัว", async () => {
    const app = buildApp();
    mockGetSession.mockResolvedValueOnce({
      user: { id: "student-1", roleId: ROLE_IDS.STUDENT },
      session: { id: "session-1" },
    });

    const response = await app.handle(
      new Request("http://localhost/admin-or-mentor"),
    );

    expect(response.status).toBe(403);
  });
});
