import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// เทส ApplicationCompleteModalService: state machine เล็กๆ ที่ตัดสินว่าควร
// แสดง modal "รับทราบการจบฝึกงาน" ให้นักศึกษาหรือไม่ (มี COMPLETE +
// ยังไม่เคย acknowledge) และบันทึกการ acknowledge แบบ idempotent
// ---------------------------------------------------------------------------

const mockSelect = mock();

const mockInsertValues = mock((_values?: unknown) => Promise.resolve());
const mockInsert = mock(() => ({ values: mockInsertValues }));

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
  transaction: async (fn: (tx: unknown) => unknown) => fn(dbMock),
};

mock.module("@/db", () => ({ db: dbMock }));

const { ApplicationCompleteModalService } = await import("../service");
const { BadRequestError, ForbiddenError, NotFoundError } = await import(
  "@/common/exceptions"
);

beforeEach(() => {
  mockSelect.mockReset();
  mockInsertValues.mockClear();
  mockInsert.mockClear();
});

afterAll(() => {
  mock.restore();
});

describe("ApplicationCompleteModalService.getModalStatus", () => {
  it("throws NotFoundError เมื่อไม่พบผู้ใช้งาน", async () => {
    const service = new ApplicationCompleteModalService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.getModalStatus("user-1"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ForbiddenError เมื่อผู้ใช้งานไม่ใช่นักศึกษา (roleId != 3)", async () => {
    const service = new ApplicationCompleteModalService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1", roleId: 2 }]));

    expect(
      service.getModalStatus("user-1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("shouldShow=false เมื่อไม่มีใบสมัครสถานะ COMPLETE เลย", async () => {
    const service = new ApplicationCompleteModalService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1", roleId: 3 }]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    const result = await service.getModalStatus("user-1");

    expect(result).toEqual({
      shouldShow: false,
      applicationStatusId: null,
      title: null,
      message: null,
    });
  });

  it("shouldShow=false เมื่อมี COMPLETE แล้วแต่ acknowledge ไปแล้ว", async () => {
    const service = new ApplicationCompleteModalService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1", roleId: 3 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 10 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1 }])); // มี ack แล้ว

    const result = await service.getModalStatus("user-1");

    expect(result).toEqual({
      shouldShow: false,
      applicationStatusId: 10,
      title: null,
      message: null,
    });
  });

  it("shouldShow=true พร้อมข้อความเมื่อมี COMPLETE และยังไม่เคย acknowledge", async () => {
    const service = new ApplicationCompleteModalService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1", roleId: 3 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 10 }]));
    mockSelect.mockReturnValueOnce(makeChainable([])); // ยังไม่ ack

    const result = await service.getModalStatus("user-1");

    expect(result).toEqual({
      shouldShow: true,
      applicationStatusId: 10,
      title: "การฝึกงานเสร็จสิ้นแล้ว",
      message: "กรุณากดรับทราบเพื่อปิดข้อความนี้",
    });
  });
});

describe("ApplicationCompleteModalService.acknowledgeModal", () => {
  it("throws NotFoundError เมื่อไม่พบผู้ใช้งาน", async () => {
    const service = new ApplicationCompleteModalService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.acknowledgeModal("user-1"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ForbiddenError เมื่อผู้ใช้งานไม่ใช่นักศึกษา", async () => {
    const service = new ApplicationCompleteModalService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1", roleId: 1 }]));

    expect(
      service.acknowledgeModal("user-1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws BadRequestError เมื่อไม่มีใบสมัครสถานะ COMPLETE ให้ acknowledge", async () => {
    const service = new ApplicationCompleteModalService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1", roleId: 3 }]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.acknowledgeModal("user-1"),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("บันทึก acknowledge สำเร็จเมื่อยังไม่เคย ack มาก่อน", async () => {
    const service = new ApplicationCompleteModalService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1", roleId: 3 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 10 }]));
    mockSelect.mockReturnValueOnce(makeChainable([])); // ยังไม่เคย ack

    const result = await service.acknowledgeModal("user-1");

    expect(result).toEqual({ message: "รับทราบสถานะเรียบร้อยแล้ว" });
    expect(mockInsertValues).toHaveBeenCalledTimes(1);
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      applicationStatusId: 10,
      userId: "user-1",
    });
  });

  it("ไม่ insert ซ้ำเมื่อเคย acknowledge ไปแล้ว (idempotent) แต่ยังตอบสำเร็จเหมือนเดิม", async () => {
    const service = new ApplicationCompleteModalService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1", roleId: 3 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 10 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1 }])); // ack ไปแล้ว

    const result = await service.acknowledgeModal("user-1");

    expect(result).toEqual({ message: "รับทราบสถานะเรียบร้อยแล้ว" });
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});
