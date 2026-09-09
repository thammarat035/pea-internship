import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

const mockSelect = mock();

const mockInsertValues = mock((_values?: unknown) => Promise.resolve());
const mockInsert = mock(() => ({ values: mockInsertValues }));

const mockUpdateWhere = mock(() => Promise.resolve());
const mockUpdateSet = mock((_set?: unknown) => ({ where: mockUpdateWhere }));
const mockUpdate = mock(() => ({ set: mockUpdateSet }));

const mockDeleteWhere = mock(() => Promise.resolve());
const mockDelete = mock(() => ({ where: mockDeleteWhere }));

function makeChainable<T>(result: T) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.limit = () => chain;
  chain.then = (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

const dbMock = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
};
mock.module("@/db", () => ({ db: dbMock }));

const { FCMService } = await import("../service");

beforeEach(() => {
  mockSelect.mockReset();
  mockInsertValues.mockClear();
  mockInsert.mockClear();
  mockUpdateWhere.mockClear();
  mockUpdateSet.mockClear();
  mockUpdate.mockClear();
  mockDeleteWhere.mockClear();
  mockDelete.mockClear();
});

afterAll(() => {
  mock.restore();
});

describe("FCMService.registerToken", () => {
  it("insert token ใหม่เมื่อยังไม่เคยลงทะเบียน token นี้มาก่อน", async () => {
    const service = new FCMService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    await service.registerToken("user-1", "token-abc");

    expect(mockInsertValues.mock.calls[0][0]).toEqual({ userId: "user-1", token: "token-abc" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("อัปเดตแค่ updatedAt เมื่อ token นี้เคยลงทะเบียนไว้แล้ว (ไม่ insert ซ้ำ)", async () => {
    const service = new FCMService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1 }]));

    await service.registerToken("user-1", "token-abc");

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdateSet.mock.calls[0][0]).toHaveProperty("updatedAt");
  });

  it("โยน error ต่อไปเมื่อ query ล้มเหลว (ไม่กลืน error ทิ้ง)", async () => {
    const service = new FCMService();
    mockSelect.mockImplementationOnce(() => {
      throw new Error("db down");
    });

    expect(service.registerToken("user-1", "token-abc")).rejects.toThrow("db down");
  });
});

describe("FCMService.getTokensByUserId", () => {
  it("คืนรายการ token ทั้งหมดของผู้ใช้", async () => {
    const service = new FCMService();
    mockSelect.mockReturnValueOnce(makeChainable([{ token: "t1" }, { token: "t2" }]));

    const result = await service.getTokensByUserId("user-1");

    expect(result).toEqual(["t1", "t2"]);
  });
});

describe("FCMService.removeToken", () => {
  it("ลบ token สำเร็จ", async () => {
    const service = new FCMService();

    await service.removeToken("token-abc");

    expect(mockDelete).toHaveBeenCalledTimes(1);
  });
});
