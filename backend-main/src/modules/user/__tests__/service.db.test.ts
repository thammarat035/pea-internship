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
// เทสเมธอดที่แตะ database/S3 ทั้งหมดของ UserService mock "@/db" และ "@/lib/s3"
// ทั้งโมดูล โมดูลนี้ผสมทั้ง db.query.*.findFirst/findMany (relational query)
// และ db.select().from().where() (query builder) ในไฟล์เดียวกัน จึงต้อง mock
// ทั้งสองแบบพร้อมกัน (ต่างจาก application ที่ใช้แต่ query builder ล้วนๆ)
// ---------------------------------------------------------------------------

function makeQueryMock() {
  return { findFirst: mock(), findMany: mock() };
}

const queryMocks = {
  users: makeQueryMock(),
  studentProfiles: makeQueryMock(),
};

const mockSelect = mock();

const mockInsertValues = mock((_values?: unknown) => Promise.resolve());
const mockInsert = mock(() => ({ values: mockInsertValues }));

const mockUpdateReturning = mock();
const mockUpdateWhere = mock((_where?: unknown) => ({
  returning: mockUpdateReturning,
  then: (resolve: (v: unknown) => unknown) => Promise.resolve().then(resolve),
}));
const mockUpdateSet = mock((_set?: unknown) => ({ where: mockUpdateWhere }));
const mockUpdate = mock(() => ({ set: mockUpdateSet }));

function makeChainable<T>(result: T) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.leftJoin = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.limit = () => chain;
  chain.then = (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

const dbMock = {
  query: queryMocks,
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  transaction: async (fn: (tx: unknown) => unknown) => fn(dbMock),
};

mock.module("@/db", () => ({ db: dbMock }));

const mockS3Send = mock();
mock.module("@/lib/s3", () => ({
  s3Client: { send: mockS3Send },
  BUCKET_NAME: "test-bucket",
}));

const { UserService } = await import("../service");
const { NotFoundError } = await import("@/common/exceptions");

beforeEach(() => {
  for (const q of Object.values(queryMocks)) {
    q.findFirst.mockReset();
    q.findMany.mockReset();
  }
  mockSelect.mockReset();
  mockInsertValues.mockClear();
  mockInsert.mockClear();
  mockUpdateReturning.mockReset();
  mockUpdateWhere.mockClear();
  mockUpdateSet.mockClear();
  mockUpdate.mockClear();
  mockS3Send.mockReset();
});

afterEach(() => {
  setSystemTime();
});

afterAll(() => {
  mock.restore();
});

describe("UserService.me", () => {
  it("throws Error เมื่อไม่พบผู้ใช้งาน", async () => {
    const service = new UserService();
    queryMocks.users.findFirst.mockResolvedValueOnce(undefined);

    expect(service.me("user-1")).rejects.toThrow("User not found");
  });

  it("นักศึกษา (roleId=3): รวมข้อมูล startDate/endDate/hours ล่าสุดเข้ากับโปรไฟล์", async () => {
    const service = new UserService();
    queryMocks.users.findFirst.mockResolvedValueOnce({
      id: "student-1",
      roleId: 3,
      studentProfiles: [{ id: 1, faculty: "วิศวะ" }],
      staffProfiles: null,
    });
    mockSelect.mockReturnValueOnce(makeChainable([{ applicationStatusId: 99 }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ startDate: new Date("2025-06-01"), endDate: new Date("2025-08-01"), hours: "560" }]),
    );

    const result = await service.me("student-1");

    expect(result.profile).toMatchObject({
      id: 1,
      faculty: "วิศวะ",
      hours: "560",
    });
  });

  it("นักศึกษาไม่มีโปรไฟล์เลย -> profile สร้างจาก latestInfo อย่างเดียว", async () => {
    const service = new UserService();
    queryMocks.users.findFirst.mockResolvedValueOnce({
      id: "student-1",
      roleId: 3,
      studentProfiles: undefined,
      staffProfiles: null,
    });
    mockSelect.mockReturnValueOnce(makeChainable([{ applicationStatusId: 99 }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ startDate: null, endDate: null, hours: "100" }]),
    );

    const result = await service.me("student-1");

    expect(result.profile).toEqual({ hours: "100", startDate: null, endDate: null });
  });

  it("นักศึกษาที่ยังไม่เคยสมัครเลย -> hours/startDate/endDate เป็น null ทั้งหมด", async () => {
    const service = new UserService();
    queryMocks.users.findFirst.mockResolvedValueOnce({
      id: "student-1",
      roleId: 3,
      studentProfiles: [{ id: 1 }],
      staffProfiles: null,
    });
    mockSelect.mockReturnValueOnce(makeChainable([])); // ไม่มีใบสมัครเลย

    const result = await service.me("student-1");

    expect((result.profile as { hours: unknown }).hours).toBeNull();
    expect(mockSelect).toHaveBeenCalledTimes(1); // ไม่ query applicationInformations ต่อ
  });

  it("Staff (roleId=1/2): คืน profile จาก staffProfiles ตรงๆ ไม่ query เพิ่ม", async () => {
    const service = new UserService();
    queryMocks.users.findFirst.mockResolvedValueOnce({
      id: "owner-1",
      roleId: 2,
      staffProfiles: { id: 5, position: "หัวหน้างาน" },
      studentProfiles: undefined,
    });

    const result = await service.me("owner-1");

    expect(result.profile).toMatchObject({ id: 5, position: "หัวหน้างาน" });
    expect(mockSelect).not.toHaveBeenCalled();
  });
});

describe("UserService.getStaff", () => {
  it("แปลง staffProfiles (array) เป็น staffProfileId เดี่ยวๆ", async () => {
    const service = new UserService();
    queryMocks.users.findMany.mockResolvedValueOnce([
      { id: "owner-1", roleId: 2, staffProfiles: [{ id: 7 }] },
      { id: "admin-1", roleId: 1, staffProfiles: [] },
    ]);

    const result = await service.getStaff();

    expect(result[0].staffProfileId).toBe(7);
    expect(result[1].staffProfileId).toBeNull();
  });
});

describe("UserService.getStudent", () => {
  it("คืนรายชื่อนักศึกษาตามที่ query ส่งกลับมา", async () => {
    const service = new UserService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: "student-1", fname: "สมชาย" }]),
    );

    const result = await service.getStudent();

    expect(result).toMatchObject([{ id: "student-1", fname: "สมชาย" }]);
  });
});

describe("UserService.updateUser", () => {
  it("throws Error เมื่อไม่พบผู้ใช้งาน (update ไม่ match แถวไหน)", async () => {
    const service = new UserService();
    mockUpdateReturning.mockResolvedValueOnce([]);

    expect(
      service.updateUser("user-1", { fname: "ใหม่" }),
    ).rejects.toThrow("User not found");
  });

  it("อัปเดตเฉพาะ field ที่ส่งมา (partial update)", async () => {
    const service = new UserService();
    mockUpdateReturning.mockResolvedValueOnce([{ id: "user-1", fname: "ใหม่" }]);

    await service.updateUser("user-1", { fname: "ใหม่" });

    expect(mockUpdateSet.mock.calls[0][0]).toEqual({ fname: "ใหม่" });
  });
});

describe("UserService.updateStaffPhone", () => {
  it("throws NotFoundError เมื่อไม่พบ staffProfile", async () => {
    const service = new UserService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.updateStaffPhone(99, "0812345678"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("อัปเดตเบอร์โทรสำเร็จ", async () => {
    const service = new UserService();
    mockSelect.mockReturnValueOnce(makeChainable([{ userId: "owner-1" }]));
    mockUpdateReturning.mockResolvedValueOnce([{ id: "owner-1", phoneNumber: "0812345678" }]);

    const result = await service.updateStaffPhone(5, "0812345678");

    expect(result.phoneNumber).toBe("0812345678");
  });
});

describe("UserService.updateStudentProfile", () => {
  it("throws Error เมื่อไม่พบโปรไฟล์นักศึกษา (มีการแก้ไข field โปรไฟล์)", async () => {
    const service = new UserService();
    mockUpdateReturning.mockResolvedValueOnce([]);

    expect(
      service.updateStudentProfile("student-1", { faculty: "วิศวะ" }),
    ).rejects.toThrow("Student profile not found");
  });

  it("throws Error เมื่อไม่พบข้อมูลใบสมัครล่าสุด (แก้ไข hours แต่ไม่เคยสมัครเลย)", async () => {
    const service = new UserService();
    mockUpdateReturning.mockResolvedValueOnce([{ id: 1, faculty: "วิศวะ" }]);
    mockSelect.mockReturnValueOnce(makeChainable([])); // ไม่มีใบสมัคร

    expect(
      service.updateStudentProfile("student-1", { faculty: "วิศวะ", hours: 500 }),
    ).rejects.toThrow("Latest application not found");
  });

  it("throws Error เมื่อ endDate ใหม่ก่อน startDate เดิม", async () => {
    const service = new UserService();
    // ไม่มี field โปรไฟล์ (faculty/major/studentNote) ให้แก้ -> ไปทาง select โปรไฟล์เดิมก่อน
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1, faculty: "วิศวะ" }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ applicationStatusId: 10 }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 1, startDate: new Date("2025-06-01"), endDate: new Date("2025-08-01"), hours: "560" }]),
    );

    expect(
      service.updateStudentProfile("student-1", { endDate: "2025-05-01" }),
    ).rejects.toThrow("endDate must be greater than or equal to startDate");
  });

  it("อัปเดตเฉพาะ field โปรไฟล์ (ไม่แตะ hours/date) -> ยังคงดึงข้อมูล application เดิมมาแนบ", async () => {
    const service = new UserService();
    mockUpdateReturning.mockResolvedValueOnce([{ id: 1, faculty: "วิศวะใหม่" }]);
    mockSelect.mockReturnValueOnce(makeChainable([{ applicationStatusId: 10 }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ hours: "560", startDate: new Date("2025-06-01"), endDate: new Date("2025-08-01") }]),
    );

    const result = await service.updateStudentProfile("student-1", {
      faculty: "วิศวะใหม่",
    });

    expect(result.faculty).toBe("วิศวะใหม่");
    expect(result.hours).toBe("560");
  });

  it("อัปเดต hours/startDate/endDate สำเร็จ", async () => {
    const service = new UserService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 1, faculty: "วิศวะ" }])); // select โปรไฟล์เดิม (ไม่มี field โปรไฟล์ให้แก้)
    mockSelect.mockReturnValueOnce(makeChainable([{ applicationStatusId: 10 }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 1, startDate: new Date("2025-06-01"), endDate: new Date("2025-08-01"), hours: "560" }]),
    );
    mockUpdateReturning.mockResolvedValueOnce([
      { hours: "600", startDate: new Date("2025-06-01"), endDate: new Date("2025-09-01") },
    ]);

    const result = await service.updateStudentProfile("student-1", {
      hours: 600,
      endDate: "2025-09-01",
    });

    expect(result.hours).toBe("600");
  });
});

describe("UserService.getStudentProgress", () => {
  it("throws NotFoundError เมื่อไม่พบข้อมูลสรุปชั่วโมง", async () => {
    const service = new UserService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.getStudentProgress("student-1"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("จำกัด percentage ไว้ไม่เกิน 100 แม้ทำเกินเป้า", async () => {
    const service = new UserService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ accumulatedHours: "600", totalHoursGoal: "560" }]),
    );

    const result = await service.getStudentProgress("student-1");

    expect(result.percentage).toBe(100);
  });

  it("คืน percentage เป็น 0 เมื่อ totalHoursGoal เป็น 0 (กัน divide by zero)", async () => {
    const service = new UserService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ accumulatedHours: "0", totalHoursGoal: "0" }]),
    );

    const result = await service.getStudentProgress("student-1");

    expect(result.percentage).toBe(0);
  });
});

describe("UserService.updateProfile", () => {
  it("throws NotFoundError เมื่อไม่พบผู้ใช้งาน", async () => {
    const service = new UserService();
    queryMocks.studentProfiles.findFirst.mockResolvedValueOnce(undefined);
    queryMocks.users.findFirst.mockResolvedValueOnce(undefined);

    expect(
      service.updateProfile("user-1", {}),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("อัปโหลดรูปใหม่สำเร็จ และลบรูปเก่าออกจาก MinIO", async () => {
    const service = new UserService();
    queryMocks.studentProfiles.findFirst.mockResolvedValueOnce({
      image: "profiles/old.png",
    });
    queryMocks.users.findFirst.mockResolvedValueOnce({
      id: "user-1",
      displayUsername: "old-nick",
    });
    mockS3Send.mockResolvedValue({});

    const file = new File(["fake-image"], "new.png", { type: "image/png" });
    const result = await service.updateProfile("user-1", { image: file });

    expect(result.success).toBe(true);
    expect(result.data.imageUrl).toMatch(/^profiles\/user-1-/);
    expect(mockS3Send).toHaveBeenCalledTimes(2); // upload ใหม่ + ลบเก่า
    expect(mockUpdateSet.mock.calls[0][0]).toHaveProperty("image");
  });

  it("เปลี่ยนแค่ nickname โดยไม่มีการอัปโหลดรูป -> ไม่เรียก s3 เลย", async () => {
    const service = new UserService();
    queryMocks.studentProfiles.findFirst.mockResolvedValueOnce({ image: null });
    queryMocks.users.findFirst.mockResolvedValueOnce({
      id: "user-1",
      displayUsername: "old-nick",
    });

    const result = await service.updateProfile("user-1", { nickname: "นิคเนมใหม่" });

    expect(result.data.nickname).toBe("นิคเนมใหม่");
    expect(mockS3Send).not.toHaveBeenCalled();
    expect(mockUpdateSet.mock.calls[0][0]).toEqual({ displayUsername: "นิคเนมใหม่" });
  });
});

describe("UserService.getProfileImage", () => {
  it("throws NotFoundError เมื่อยังไม่ได้ตั้งรูปโปรไฟล์", async () => {
    const service = new UserService();
    mockSelect.mockReturnValueOnce(makeChainable([{ image: null }]));

    expect(
      service.getProfileImage("user-1"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("คืน buffer และ contentType จาก MinIO", async () => {
    const service = new UserService();
    mockSelect.mockReturnValueOnce(makeChainable([{ image: "profiles/a.png" }]));
    mockS3Send.mockResolvedValueOnce({
      Body: { transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3])) },
      ContentType: "image/png",
    });

    const result = await service.getProfileImage("user-1");

    expect(result.contentType).toBe("image/png");
  });

  it("throws NotFoundError เมื่อดึงจาก MinIO ไม่สำเร็จ", async () => {
    const service = new UserService();
    mockSelect.mockReturnValueOnce(makeChainable([{ image: "profiles/a.png" }]));
    mockS3Send.mockRejectedValueOnce(new Error("not found in bucket"));

    expect(
      service.getProfileImage("user-1"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("UserService.extendInternship", () => {
  it("throws Error เมื่อไม่พบรายการฝึกงานที่ active อยู่", async () => {
    const service = new UserService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.extendInternship({ studentId: "student-1", hours: 7, mentorId: "mentor-1" }),
    ).rejects.toThrow("ไม่พบรายการฝึกงานที่กำลังดำเนินการ (Active) อยู่");
  });

  it("throws Error เมื่อไม่พบวันสิ้นสุดการฝึกงานเดิม", async () => {
    const service = new UserService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 10 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ endDate: null }]));

    expect(
      service.extendInternship({ studentId: "student-1", hours: 7, mentorId: "mentor-1" }),
    ).rejects.toThrow("ไม่พบข้อมูลวันสิ้นสุดการฝึกงานเดิม");
  });

  it("throws Error เมื่อขอขยายเวลาเร็วเกินไป (ยังไม่เข้าช่วง 7 วันทำการสุดท้าย)", async () => {
    const service = new UserService();
    setSystemTime(new Date(2025, 5, 1)); // 1 มิ.ย. ยังห่างจาก endDate มาก
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 10 }]));
    mockSelect.mockReturnValueOnce(makeChainable([{ endDate: new Date(2025, 7, 1) }])); // จบ 1 ส.ค.

    expect(
      service.extendInternship({ studentId: "student-1", hours: 7, mentorId: "mentor-1" }),
    ).rejects.toThrow("7 วันทำการสุดท้าย");
  });

  it("ขยายเวลาสำเร็จ: รวมชั่วโมงที่เคยขยายไว้ก่อนหน้า และคำนวณวันสิ้นสุดใหม่โดยข้ามวันหยุด", async () => {
    const service = new UserService();
    // endDate เดิมคือศุกร์ 1 ส.ค. 2025 และวันนี้ผ่านมาแล้ว (เข้าเงื่อนไขขอขยายได้)
    setSystemTime(new Date(2025, 7, 5));
    mockSelect.mockReturnValueOnce(makeChainable([{ id: 10 }])); // currentApp
    mockSelect.mockReturnValueOnce(makeChainable([{ endDate: new Date(2025, 7, 1) }])); // appInfo
    mockSelect.mockReturnValueOnce(makeChainable([{ totalPreviousHours: "7" }])); // เคยขยายมาแล้ว 7 ชม.

    const result = await service.extendInternship({
      studentId: "student-1",
      hours: 7,
      mentorId: "mentor-1",
      reason: "ชดเชยวันลา",
    });

    expect(result.success).toBe(true);
    // รวม 7+7=14 ชม. = 2 วันทำการ นับจาก endDate เดิม (1 ส.ค. ศุกร์) ข้ามเสาร์-อาทิตย์ -> 4 ส.ค. (จันทร์) + อีกวัน -> 5 ส.ค. (อังคาร)
    expect(result.newEndDate).toContain("2025-08-05");
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      applicationStatusId: 10,
      additionalHours: "7",
      reason: "ชดเชยวันลา",
      status: "APPROVED",
    });
    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({
      internshipStatus: "EXTENDED",
    });
  });
});

describe("UserService.completeInternship", () => {
  it("throws Error เมื่อไม่พบรายการฝึกงานที่ active อยู่", async () => {
    const service = new UserService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.completeInternship("student-1", "admin-1"),
    ).rejects.toThrow("ไม่พบรายการฝึกงานที่กำลังดำเนินการอยู่");
  });

  it("throws Error เมื่อยังไม่ถึงวันสิ้นสุดการฝึกงาน", async () => {
    const service = new UserService();
    setSystemTime(new Date(2025, 5, 1));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, endDate: new Date(2025, 7, 1), hoursGoal: "560" }]),
    );

    expect(
      service.completeInternship("student-1", "admin-1"),
    ).rejects.toThrow("ยังไม่ถึงกำหนดวันสิ้นสุดการฝึกงาน");
  });

  it("throws Error เมื่อไม่พบโปรไฟล์นักศึกษาให้ปิด (update ไม่ match)", async () => {
    const service = new UserService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, endDate: null, hoursGoal: "560" }]),
    );
    mockUpdateReturning.mockResolvedValueOnce([]);

    expect(
      service.completeInternship("student-1", "admin-1"),
    ).rejects.toThrow("ไม่พบข้อมูลโปรไฟล์นักศึกษา");
  });

  it("จบการฝึกงานสำเร็จ เมื่อถึงหรือเลยวันสิ้นสุดแล้ว และบันทึกลง internshipEndHistory", async () => {
    const service = new UserService();
    setSystemTime(new Date(2025, 7, 5));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, endDate: new Date(2025, 7, 1), hoursGoal: "560" }]),
    );
    mockUpdateReturning.mockResolvedValueOnce([{ id: 3 }]);

    const result = await service.completeInternship("student-1", "admin-1", "ครบกำหนดแล้ว");

    expect(result).toEqual({ success: true, message: "บันทึกการจบการฝึกงานเรียบร้อยแล้ว" });
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      studentProfileId: 3,
      status: "COMPLETE",
      reason: "ครบกำหนดแล้ว",
      changedBy: "admin-1",
    });
  });

  it("ไม่เช็ควันสิ้นสุดเลยเมื่อ endDate เป็น null (ปิดจบได้ทันที)", async () => {
    const service = new UserService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 10, endDate: null, hoursGoal: "560" }]),
    );
    mockUpdateReturning.mockResolvedValueOnce([{ id: 3 }]);

    const result = await service.completeInternship("student-1", "admin-1");

    expect(result.success).toBe(true);
  });
});
