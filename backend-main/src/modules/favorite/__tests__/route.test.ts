import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

const mockFindMyFavorites = mock();
const mockCreate = mock();
const mockDelete = mock();

mock.module("../service", () => ({
  FavoriteService: class {
    findMyFavorites = mockFindMyFavorites;
    create = mockCreate;
    delete = mockDelete;
  },
}));

const FAKE_USER = { id: "fake-user-id", roleId: 3 };
const FAKE_SESSION = { id: "fake-session-id", userId: FAKE_USER.id };

mock.module("@/middlewares/auth.middleware", () => ({
  isAuthenticated: new Elysia({ name: "better-auth" }).macro({
    auth: { resolve: () => ({ user: FAKE_USER, session: FAKE_SESSION }) },
  }),
}));

const { favorite } = await import("../index");

describe("favorite routes", () => {
  beforeEach(() => {
    mockFindMyFavorites.mockReset();
    mockCreate.mockReset();
    mockDelete.mockReset();
  });

  it("GET /favorite/ เรียก service.findMyFavorites ด้วย session.userId และ query", async () => {
    mockFindMyFavorites.mockResolvedValue({ data: [], meta: {} });

    const response = await favorite.handle(
      new Request("http://localhost/favorite/?page=2"),
    );

    expect(response.status).toBe(200);
    expect(mockFindMyFavorites).toHaveBeenCalledWith(
      FAKE_SESSION.userId,
      expect.objectContaining({ page: 2 }),
    );
  });

  it("POST /favorite/ เรียก service.create ด้วย session.userId และ body คืน status 201", async () => {
    mockCreate.mockResolvedValue({ id: 1, positionId: 5 });

    const response = await favorite.handle(
      new Request("http://localhost/favorite/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionId: 5 }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      FAKE_SESSION.userId,
      expect.objectContaining({ positionId: 5 }),
    );
  });

  it("DELETE /favorite/:positionId เรียก service.delete ด้วย session.userId และ positionId (ตัวเลข)", async () => {
    mockDelete.mockResolvedValue({ success: true });

    const response = await favorite.handle(
      new Request("http://localhost/favorite/5", { method: "DELETE" }),
    );

    expect(response.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledWith(FAKE_SESSION.userId, 5);
  });
});

afterAll(() => {
  mock.restore();
});
