import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

// ---------------------------------------------------------------------------
// เทส route ทั้ง 4 endpoint ของ institution module โดย mock InstitutionService
// ทั้งคลาส
//
// ข้อสังเกต: POST /institution/ ไม่มีทั้ง `auth: true` และ `role: [...]` เลย
// (ต่างจาก PUT/DELETE ที่มี role: [1]) - เหมือนกรณี PUT /dept/:id ที่เจอมาก่อน
// หน้านี้ เทสด้านล่างเรียก POST โดยไม่แนบ auth header ใดๆ เพื่อบันทึกพฤติกรรม
// ปัจจุบันไว้ ไม่ได้ยืนยันว่าเป็นพฤติกรรมที่ตั้งใจ
// ---------------------------------------------------------------------------

const mockFindAll = mock();
const mockCreate = mock();
const mockUpdate = mock();
const mockDelete = mock();

mock.module("../service", () => ({
  InstitutionService: class {
    findAll = mockFindAll;
    create = mockCreate;
    update = mockUpdate;
    delete = mockDelete;
  },
}));

const FAKE_USER = { id: "fake-admin-id", roleId: 1 };
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

const { institution } = await import("../index");

describe("institution routes", () => {
  beforeEach(() => {
    mockFindAll.mockReset();
    mockCreate.mockReset();
    mockUpdate.mockReset();
    mockDelete.mockReset();
  });

  it("GET /institution/ เรียก service.findAll ด้วย query", async () => {
    mockFindAll.mockResolvedValue({ data: [], meta: {} });

    const response = await institution.handle(
      new Request("http://localhost/institution/?search=เกษตร&type=UNIVERSITY"),
    );

    expect(response.status).toBe(200);
    expect(mockFindAll).toHaveBeenCalledWith(
      expect.objectContaining({ search: "เกษตร", type: "UNIVERSITY" }),
    );
  });

  it("POST /institution/ เรียก service.create ด้วย body คืน status 201 แม้ไม่แนบ auth header เลย", async () => {
    mockCreate.mockResolvedValue({ id: 1, name: "ม.เกษตรศาสตร์" });

    const response = await institution.handle(
      new Request("http://localhost/institution/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ institutionsType: "UNIVERSITY", name: "ม.เกษตรศาสตร์" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ม.เกษตรศาสตร์" }),
    );
  });

  it("PUT /institution/:id เรียก service.update ด้วย session.userId, id (ตัวเลข) และ body", async () => {
    mockUpdate.mockResolvedValue({ id: 1, name: "ชื่อใหม่" });

    const response = await institution.handle(
      new Request("http://localhost/institution/1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "ชื่อใหม่" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      FAKE_SESSION.userId,
      1,
      expect.objectContaining({ name: "ชื่อใหม่" }),
    );
  });

  it("DELETE /institution/:id เรียก service.delete ด้วย session.userId และ id (ตัวเลข)", async () => {
    mockDelete.mockResolvedValue({ success: true });

    const response = await institution.handle(
      new Request("http://localhost/institution/1", { method: "DELETE" }),
    );

    expect(response.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledWith(FAKE_SESSION.userId, 1);
  });
});

afterAll(() => {
  mock.restore();
});
