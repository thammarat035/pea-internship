import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

const mockSelect = mock();

const mockInsertReturning = mock();
const mockInsertValues = mock((_values?: unknown) => ({
  returning: mockInsertReturning,
}));
const mockInsert = mock(() => ({ values: mockInsertValues }));

const mockDeleteReturning = mock();
const mockDeleteWhere = mock((_where?: unknown) => ({
  returning: mockDeleteReturning,
}));
const mockDelete = mock(() => ({ where: mockDeleteWhere }));

function makeChainable<T>(result: T) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.limit = () => chain;
  chain.offset = () => chain;
  chain.then = (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function postgresError(code: string) {
  const err = new Error(`postgres error ${code}`);
  (err as unknown as { cause: unknown }).cause = { code };
  return err;
}

const dbMock = { select: mockSelect, insert: mockInsert, delete: mockDelete };
mock.module("@/db", () => ({ db: dbMock }));

const { FavoriteService } = await import("../service");
const { ConflictError, ForbiddenError } = await import(
  "@/common/exceptions"
);
const { NotFoundError } = await import("elysia");

beforeEach(() => {
  mockSelect.mockReset();
  mockInsertReturning.mockReset();
  mockInsertValues.mockClear();
  mockInsert.mockClear();
  mockDeleteReturning.mockReset();
  mockDeleteWhere.mockClear();
  mockDelete.mockClear();
});

afterAll(() => {
  mock.restore();
});

describe("FavoriteService.findMyFavorites", () => {
  it("throws ForbiddenError เมื่อไม่พบผู้ใช้งาน", async () => {
    const service = new FavoriteService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.findMyFavorites("user-1", {}),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("คืนรายการ favorite พร้อม pagination meta", async () => {
    const service = new FavoriteService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ favorite: { id: 1 }, position: { id: 5, name: "Dev" } }]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([{ count: 1 }]));

    const result = await service.findMyFavorites("user-1", { page: 1, limit: 20 });

    expect(result.data).toHaveLength(1);
    expect(result.meta).toEqual({ total: 1, page: 1, limit: 20, totalPages: 1, hasNextPage: false });
  });
});

describe("FavoriteService.create", () => {
  it("throws ForbiddenError เมื่อไม่พบผู้ใช้งาน", async () => {
    const service = new FavoriteService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.create("user-1", { positionId: 5 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("กด favorite สำเร็จ", async () => {
    const service = new FavoriteService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockInsertReturning.mockResolvedValueOnce([{ id: 1, userId: "user-1", positionId: 5 }]);

    const result = await service.create("user-1", { positionId: 5 });

    expect(result).toMatchObject({ positionId: 5 });
  });

  it("throws ConflictError เมื่อกด favorite ตำแหน่งเดิมซ้ำ (postgres unique violation 23505)", async () => {
    const service = new FavoriteService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockInsertReturning.mockRejectedValueOnce(postgresError("23505"));

    expect(
      service.create("user-1", { positionId: 5 }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("FavoriteService.delete", () => {
  it("throws ForbiddenError เมื่อไม่พบผู้ใช้งาน", async () => {
    const service = new FavoriteService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(service.delete("user-1", 5)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("ลบสำเร็จ", async () => {
    const service = new FavoriteService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockDeleteReturning.mockResolvedValueOnce([{ id: 1 }]);

    const result = await service.delete("user-1", 5);

    expect(result).toEqual({ success: true, message: "ลบ favorite เรียบร้อยแล้ว" });
  });

  it("throws NotFoundError เมื่อไม่พบรายการ favorite ที่จะลบ", async () => {
    const service = new FavoriteService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockDeleteReturning.mockResolvedValueOnce([]);

    expect(service.delete("user-1", 999)).rejects.toBeInstanceOf(NotFoundError);
  });
});
