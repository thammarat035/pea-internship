import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
} from "bun:test";

// ---------------------------------------------------------------------------
// เทส PositionService ทั้ง 4 เมธอด public (findAll, create, update, delete)
// รวมถึง private helper 3 ตัว (assertUserExists, getUserDepartmentAndOffice,
// assertAssignablePositionOwner) ที่เทสผ่าน public method ทางอ้อม และ
// computeAutoStatus (module-level function ที่ไม่ export) ที่เทสผ่าน
// create()/update() เช่นกัน (pattern เดียวกับ application-documents ที่
// helper ไม่ export ออกมา)
//
// โมดูลนี้ใช้แต่ db.select()/.insert()/.update()/.delete()/.transaction()
// ล้วนๆ ไม่มี db.query.* เลย เหมือน application module
// ---------------------------------------------------------------------------

const mockSelect = mock();

const mockInsertReturning = mock();
const mockInsertValues = mock((_values?: unknown) => ({
  returning: mockInsertReturning,
  then: (resolve: (v: unknown) => unknown) => Promise.resolve().then(resolve),
}));
const mockInsert = mock(() => ({ values: mockInsertValues }));

const mockUpdateReturning = mock();
const mockUpdateWhere = mock((_where?: unknown) => ({
  returning: mockUpdateReturning,
  then: (resolve: (v: unknown) => unknown) => Promise.resolve().then(resolve),
}));
const mockUpdateSet = mock((_set?: unknown) => ({ where: mockUpdateWhere }));
const mockUpdate = mock(() => ({ set: mockUpdateSet }));

const mockDeleteWhere = mock(() => Promise.resolve());
const mockDelete = mock(() => ({ where: mockDeleteWhere }));

function makeChainable<T>(result: T) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.leftJoin = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.limit = () => chain;
  chain.offset = () => chain;
  chain.then = (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

const dbMock = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
  transaction: async (fn: (tx: unknown) => unknown) => fn(dbMock),
};

mock.module("@/db", () => ({ db: dbMock }));

mock.module("@/modules/staff-logs/service", () => ({
  StaffLogsService: class {
    log = mock(() => Promise.resolve());
  },
}));

const { PositionService } = await import("../service");
const { BadRequestError, ForbiddenError } = await import(
  "@/common/exceptions"
);
const { NotFoundError } = await import("elysia");

beforeEach(() => {
  mockSelect.mockReset();
  mockInsertReturning.mockReset();
  mockInsertValues.mockClear();
  mockInsert.mockClear();
  mockUpdateReturning.mockReset();
  mockUpdateWhere.mockClear();
  mockUpdateSet.mockClear();
  mockUpdate.mockClear();
  mockDeleteWhere.mockClear();
  mockDelete.mockClear();
});

afterEach(() => {
  setSystemTime();
});

afterAll(() => {
  mock.restore();
});

describe("PositionService.findAll", () => {
  it("รวมหลายแถว mentor เข้าเป็น position เดียวพร้อม mentors array", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(
      makeChainable([
        {
          position: { id: 1, departmentId: 10, officeId: 100, positionOwner: null },
          mentorStaffId: 1,
          mentorFname: "พี่",
          mentorLname: "เลี้ยงเอ",
          mentorEmail: "a@x.com",
          mentorPhone: "081",
        },
        {
          position: { id: 1, departmentId: 10, officeId: 100, positionOwner: null },
          mentorStaffId: 2,
          mentorFname: "พี่",
          mentorLname: "เลี้ยงบี",
          mentorEmail: "b@x.com",
          mentorPhone: "082",
        },
      ]),
    ); // rows
    mockSelect.mockReturnValueOnce(makeChainable([])); // departmentData
    mockSelect.mockReturnValueOnce(makeChainable([])); // officeData
    mockSelect.mockReturnValueOnce(makeChainable([{ count: 1 }])); // totalResult

    const result = await service.findAll({});

    expect(result.data).toHaveLength(1);
    expect(result.data[0].mentors).toHaveLength(2);
    expect(result.data[0].mentors[1].name).toBe("พี่ เลี้ยงบี");
  });

  it("mentors เป็น array ว่างเมื่อตำแหน่งไม่มี mentor เลย (left join ได้ null)", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(
      makeChainable([
        {
          position: { id: 1, departmentId: 10, officeId: 100, positionOwner: null },
          mentorStaffId: null,
          mentorFname: null,
          mentorLname: null,
          mentorEmail: null,
          mentorPhone: null,
        },
      ]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([]));
    mockSelect.mockReturnValueOnce(makeChainable([]));
    mockSelect.mockReturnValueOnce(makeChainable([{ count: 1 }]));

    const result = await service.findAll({});

    expect(result.data[0].mentors).toEqual([]);
  });

  it("ไม่ query owner/department/office เพิ่มเลยเมื่อไม่มีตำแหน่งใดๆ ในผลลัพธ์", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(makeChainable([])); // rows ว่าง
    mockSelect.mockReturnValueOnce(makeChainable([{ count: 0 }])); // totalResult

    const result = await service.findAll({});

    expect(result.data).toEqual([]);
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });

  it("เติมข้อมูล positionOwner/department/office ที่หาเจอ และ hasNextPage คำนวณถูก", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(
      makeChainable([
        {
          position: { id: 1, departmentId: 10, officeId: 100, positionOwner: "owner-1" },
          mentorStaffId: null,
          mentorFname: null,
          mentorLname: null,
          mentorEmail: null,
          mentorPhone: null,
        },
      ]),
    );
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: "owner-1", fname: "สมชาย", lname: "ใจดี", email: "a@x.com", phoneNumber: "081" }]),
    ); // ownerRows
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, deptSap: 10, deptShort: "IT", deptFull: "ฝ่าย IT", location: null, officeId: 100 }]),
    ); // departmentData
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 100, name: "สำนักงานใหญ่", shortName: "HQ" }]),
    ); // officeData
    mockSelect.mockReturnValueOnce(makeChainable([{ count: 25 }])); // totalResult

    const result = await service.findAll({ page: 1, limit: 10 });

    expect(result.data[0].positionOwner).toMatchObject({ fname: "สมชาย" });
    expect(result.data[0].department).toMatchObject({ deptShort: "IT" });
    expect(result.data[0].office).toMatchObject({ shortName: "HQ" });
    expect(result.meta).toEqual({ total: 25, page: 1, limit: 10, totalPages: 3, hasNextPage: true });
  });
});

describe("PositionService.create", () => {
  const validData = {
    name: "Developer",
    recruitmentStatus: "OPEN" as const,
  };

  it("throws ForbiddenError เมื่อไม่พบผู้ใช้งาน", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.create("user-1", validData),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError เมื่อผู้ใช้งานยังไม่สังกัดแผนก", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: null, officeId: null }]));

    expect(
      service.create("user-1", validData),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError เมื่อแผนกยังไม่ได้ผูกสำนักงาน", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10, officeId: null }]));

    expect(
      service.create("user-1", validData),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError เมื่อพยายามสร้างประกาศด้วยสถานะ CLOSE ตรงๆ", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10, officeId: 100 }]));

    expect(
      service.create("user-1", { ...validData, recruitmentStatus: "CLOSE" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("สร้างสำเร็จ: สถานะ OPEN เมื่อไม่ระบุวันรับสมัคร และ departmentId/officeId มาจากสิทธิ์ผู้ใช้ ไม่ใช่จาก body", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10, officeId: 100 }]));
    mockInsertReturning.mockResolvedValueOnce([{ id: 1, recruitmentStatus: "OPEN" }]);

    await service.create("user-1", validData);

    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      departmentId: 10,
      officeId: 100,
      positionOwner: "user-1",
      recruitmentStatus: "OPEN",
    });
  });

  it("สถานะเป็น NOT_OPEN_YET เมื่อ recruitStart อยู่ในอนาคต", async () => {
    const service = new PositionService();
    setSystemTime(new Date(2025, 5, 1));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10, officeId: 100 }]));
    mockInsertReturning.mockResolvedValueOnce([{ id: 1 }]);

    await service.create("user-1", {
      ...validData,
      recruitStart: "2025-07-01",
      recruitEnd: "2025-08-01",
    });

    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      recruitmentStatus: "NOT_OPEN_YET",
    });
  });

  it("สถานะเป็น EXPIRED เมื่อ recruitEnd ผ่านมาแล้ว", async () => {
    const service = new PositionService();
    setSystemTime(new Date(2025, 8, 1));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10, officeId: 100 }]));
    mockInsertReturning.mockResolvedValueOnce([{ id: 1 }]);

    await service.create("user-1", {
      ...validData,
      recruitStart: "2025-06-01",
      recruitEnd: "2025-07-01",
    });

    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      recruitmentStatus: "EXPIRED",
    });
  });

  it("ผูก mentorStaffIds ที่ระบุมาให้ตำแหน่งใหม่", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10, officeId: 100 }]));
    mockInsertReturning.mockResolvedValueOnce([{ id: 1 }]);

    await service.create("user-1", { ...validData, mentorStaffIds: [7, 8] });

    expect(mockInsertValues.mock.calls[1][0]).toEqual([
      { positionId: 1, mentorStaffId: 7 },
      { positionId: 1, mentorStaffId: 8 },
    ]);
  });

  it("ไม่ insert mentor เลยเมื่อไม่ได้ระบุ mentorStaffIds มา", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10, officeId: 100 }]));
    mockInsertReturning.mockResolvedValueOnce([{ id: 1 }]);

    await service.create("user-1", validData);

    expect(mockInsertValues).toHaveBeenCalledTimes(1);
  });
});

describe("PositionService.update", () => {
  it("throws NotFoundError เมื่อไม่พบใบประกาศ", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10, officeId: 100 }]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.update("user-1", 5, {}),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ForbiddenError เมื่อใบประกาศเป็นของแผนกอื่น", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10, officeId: 100 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 5, departmentId: 99 }]));

    expect(
      service.update("user-1", 5, {}),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws BadRequestError เมื่อพยายามล้าง positionOwner เป็น null/ว่างเปล่า", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10, officeId: 100 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 5, departmentId: 10, recruitmentStatus: "OPEN", acceptedCount: 0 }]));

    expect(
      service.update("user-1", 5, { positionOwner: "" }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("throws NotFoundError เมื่อ positionOwner ใหม่ไม่มีอยู่จริง", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10, officeId: 100 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 5, departmentId: 10, recruitmentStatus: "OPEN", acceptedCount: 0 }]));
    mockSelect.mockReturnValueOnce(makeChainable([])); // targetUser ไม่พบ

    expect(
      service.update("user-1", 5, { positionOwner: "ghost" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ForbiddenError เมื่อ positionOwner ใหม่คนละแผนกกับใบประกาศ", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10, officeId: 100 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 5, departmentId: 10, recruitmentStatus: "OPEN", acceptedCount: 0 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "other-owner", roleId: 2, departmentId: 99 }]));

    expect(
      service.update("user-1", 5, { positionOwner: "other-owner" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError เมื่อ positionOwner ใหม่ไม่ใช่ role Admin/Owner", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10, officeId: 100 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 5, departmentId: 10, recruitmentStatus: "OPEN", acceptedCount: 0 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "student-1", roleId: 3, departmentId: 10 }]));

    expect(
      service.update("user-1", 5, { positionOwner: "student-1" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws BadRequestError เมื่อลด positionCount ต่ำกว่า acceptedCount ปัจจุบัน", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10, officeId: 100 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 5, departmentId: 10, recruitmentStatus: "OPEN", acceptedCount: 3 }]));

    expect(
      service.update("user-1", 5, { positionCount: 2 }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("throws NotFoundError เมื่อ update ไม่ match แถวไหนเลย (แผนกเปลี่ยนกลางทาง)", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10, officeId: 100 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 5, departmentId: 10, recruitmentStatus: "OPEN", acceptedCount: 0 }]));
    mockUpdateReturning.mockResolvedValueOnce([]);

    expect(
      service.update("user-1", 5, { name: "ใหม่" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("recruitmentStatus='CLOSE' ที่ระบุมาตรงๆ มีผลเหนือ autoStatus ที่คำนวณได้", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10, officeId: 100 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 5, departmentId: 10, recruitmentStatus: "OPEN", acceptedCount: 0 }]));
    mockUpdateReturning.mockResolvedValueOnce([{ id: 5 }]);

    await service.update("user-1", 5, { recruitmentStatus: "CLOSE" });

    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({ recruitmentStatus: "CLOSE" });
  });

  it("ค้าง CLOSE ไว้ต่อ เมื่อเดิมถูกปิดด้วยมือและไม่ได้ระบุ recruitmentStatus มาแก้ไข", async () => {
    const service = new PositionService();
    setSystemTime(new Date(2025, 5, 15)); // อยู่ในช่วงรับสมัคร ถ้าไม่เช็คจะกลาย OPEN อัตโนมัติ
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10, officeId: 100 }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{
        id: 5,
        departmentId: 10,
        recruitmentStatus: "CLOSE",
        acceptedCount: 0,
        recruitStart: "2025-06-01",
        recruitEnd: "2025-06-30",
      }]),
    );
    mockUpdateReturning.mockResolvedValueOnce([{ id: 5 }]);

    await service.update("user-1", 5, { name: "แก้ชื่อเฉยๆ" });

    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({ recruitmentStatus: "CLOSE" });
  });

  it("คำนวณ autoStatus ใหม่ตามวันที่ เมื่อไม่ได้ปิดด้วยมือมาก่อน", async () => {
    const service = new PositionService();
    setSystemTime(new Date(2025, 5, 15));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10, officeId: 100 }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{
        id: 5,
        departmentId: 10,
        recruitmentStatus: "NOT_OPEN_YET",
        acceptedCount: 0,
        recruitStart: "2025-06-01",
        recruitEnd: "2025-06-30",
      }]),
    );
    mockUpdateReturning.mockResolvedValueOnce([{ id: 5 }]);

    await service.update("user-1", 5, { name: "แก้ชื่อเฉยๆ" });

    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({ recruitmentStatus: "OPEN" });
  });

  it("แก้ไขรายชื่อ mentor: ลบของเดิมทั้งหมดแล้วเพิ่มใหม่", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10, officeId: 100 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 5, departmentId: 10, recruitmentStatus: "OPEN", acceptedCount: 0 }]));
    mockUpdateReturning.mockResolvedValueOnce([{ id: 5 }]);

    await service.update("user-1", 5, { mentorStaffIds: [9] });

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockInsertValues.mock.calls[0][0]).toEqual([{ positionId: 5, mentorStaffId: 9 }]);
  });
});

describe("PositionService.delete", () => {
  it("throws NotFoundError เมื่อไม่พบใบประกาศ", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10, officeId: 100 }]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.delete("user-1", 5),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ForbiddenError เมื่อใบประกาศเป็นของแผนกอื่น", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10, officeId: 100 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 5, departmentId: 99, acceptedCount: 0 }]));

    expect(
      service.delete("user-1", 5),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws BadRequestError เมื่อมีผู้ได้รับคัดเลือกแล้ว (ลบไม่ได้)", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10, officeId: 100 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 5, departmentId: 10, acceptedCount: 2 }]));

    expect(
      service.delete("user-1", 5),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("ลบสำเร็จ: soft delete ตำแหน่ง ยกเลิกใบสมัครที่เกี่ยวข้องทั้งหมด และแจ้งเตือนนักศึกษา", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10, officeId: 100 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 5, departmentId: 10, acceptedCount: 0 }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ userId: "student-1" }, { userId: "student-2" }]),
    ); // affectedApplications

    const result = await service.delete("user-1", 5);

    expect(result.success).toBe(true);
    expect(mockUpdateSet.mock.calls[0][0]).toHaveProperty("deletedAt"); // soft delete ตำแหน่ง
    expect(mockUpdateSet.mock.calls[1][0]).toMatchObject({ applicationStatus: "ABORT" }); // ใบสมัคร
    expect(mockUpdateSet.mock.calls[2][0]).toMatchObject({ internshipStatus: "IDLE" }); // studentProfiles
    const notificationPayload = mockInsertValues.mock.calls[0][0] as unknown[];
    expect(notificationPayload).toHaveLength(2);
  });

  it("ไม่แจ้งเตือนใครเลยเมื่อไม่มีใบสมัครที่ได้รับผลกระทบ", async () => {
    const service = new PositionService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ departmentId: 10, officeId: 100 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 5, departmentId: 10, acceptedCount: 0 }]));
    mockSelect.mockReturnValueOnce(makeChainable([])); // ไม่มีใบสมัครที่เกี่ยวข้อง

    await service.delete("user-1", 5);

    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});
