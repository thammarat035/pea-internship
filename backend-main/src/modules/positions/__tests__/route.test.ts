import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

// ---------------------------------------------------------------------------
// เทส route ทั้ง 4 endpoint ของ position module โดย mock PositionService
// ทั้งคลาส — endpoint GET / ไม่มี role restriction (ทุก role เรียกได้)
// ส่วน POST/PUT/DELETE จำกัดเฉพาะ role [1,2] (Admin/Owner) และใช้
// session.userId เป็น identity
// ---------------------------------------------------------------------------

const mockFindAll = mock();
const mockCreate = mock();
const mockUpdate = mock();
const mockDelete = mock();

mock.module("../service", () => ({
  PositionService: class {
    findAll = mockFindAll;
    create = mockCreate;
    update = mockUpdate;
    delete = mockDelete;
  },
}));

const FAKE_USER = { id: "fake-owner-id", roleId: 2 };
const FAKE_SESSION = { id: "fake-session-id", userId: FAKE_USER.id };

mock.module("@/middlewares/auth.middleware", () => ({
  isAuthenticated: new Elysia({ name: "better-auth" }).macro({
    auth: {
      resolve: () => ({ user: FAKE_USER, session: FAKE_SESSION }),
    },
    role: () => ({
      resolve: () => ({ user: FAKE_USER, session: FAKE_SESSION }),
    }),
  }),
}));

const { position } = await import("../index");

describe("position routes", () => {
  beforeEach(() => {
    mockFindAll.mockReset();
    mockCreate.mockReset();
    mockUpdate.mockReset();
    mockDelete.mockReset();
  });

  it("GET /position/ เรียก service.findAll ด้วย query", async () => {
    mockFindAll.mockResolvedValue({ data: [], meta: {} });

    const response = await position.handle(
      new Request("http://localhost/position/?search=Developer&department=10"),
    );

    expect(response.status).toBe(200);
    expect(mockFindAll).toHaveBeenCalledWith(
      expect.objectContaining({ search: "Developer", department: 10 }),
    );
  });

  it("POST /position/ เรียก service.create ด้วย session.userId และ body คืน status 201", async () => {
    mockCreate.mockResolvedValue({ id: 1 });

    const response = await position.handle(
      new Request("http://localhost/position/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Developer", recruitmentStatus: "OPEN" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      FAKE_SESSION.userId,
      expect.objectContaining({ name: "Developer" }),
    );
  });

  it("PUT /position/:id เรียก service.update ด้วย session.userId, id (ตัวเลข) และ body", async () => {
    mockUpdate.mockResolvedValue({ id: 5 });

    const response = await position.handle(
      new Request("http://localhost/position/5", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Developer 2" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      FAKE_SESSION.userId,
      5,
      expect.objectContaining({ name: "Developer 2" }),
    );
  });

  it("DELETE /position/:id เรียก service.delete ด้วย session.userId และ id (ตัวเลข)", async () => {
    mockDelete.mockResolvedValue({ success: true });

    const response = await position.handle(
      new Request("http://localhost/position/5", { method: "DELETE" }),
    );

    expect(response.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledWith(FAKE_SESSION.userId, 5);
  });
});

afterAll(() => {
  mock.restore();
});
