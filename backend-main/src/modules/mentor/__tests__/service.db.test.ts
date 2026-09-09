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
// เทสเมธอดที่แตะ database ทั้งหมดของ MentorService mock "@/db" ทั้งโมดูล
// (pattern เดียวกับ check-time/leave-requests) mentor.service ไม่มี insert/
// update/transaction เลย เป็น query อ่านอย่างเดียวล้วนๆ แต่ chain ของ
// db.select() ยาวและซับซ้อนกว่าโมดูลอื่น (มี .limit()/.offset()/.groupBy()/
// .as() สำหรับ subquery ด้วย) จึงต้องขยาย makeChainable ให้รองรับ method
// พวกนี้เพิ่มจาก pattern เดิม
//
// สำคัญ: ทุกครั้งที่โค้ดจริงเรียก db.select(...) จะ "กิน" คิวของ mockSelect
// ไป 1 ครั้งเสมอ ไม่ว่าผลลัพธ์จะถูก await จริงหรือแค่ถูกใช้สร้าง subquery
// (เช่น latestExtensionQuery ใน getStudents ที่ไม่ได้ await ตรงๆ) จึงต้องนับ
// ลำดับการเรียก db.select() ในโค้ดจริงให้ครบก่อนเรียง mockReturnValueOnce
// ---------------------------------------------------------------------------

function makeQueryMock() {
  return { findFirst: mock(), findMany: mock() };
}

const queryMocks = {
  users: makeQueryMock(),
};

const mockSelect = mock();

function makeChainable<T>(result: T) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.leftJoin = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.groupBy = () => chain;
  chain.limit = () => chain;
  chain.offset = () => chain;
  chain.as = () => chain;
  chain.then = (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

const dbMock = {
  query: queryMocks,
  select: mockSelect,
};

mock.module("@/db", () => ({ db: dbMock }));

const { MentorService } = await import("../service");
const { ForbiddenError, NotFoundError } = await import(
  "@/common/exceptions"
);

function bkkIso(dateStr: string, time: string) {
  return new Date(`${dateStr}T${time}:00+07:00`).toISOString();
}

beforeEach(() => {
  for (const q of Object.values(queryMocks)) {
    q.findFirst.mockReset();
    q.findMany.mockReset();
  }
  mockSelect.mockReset();
});

afterEach(() => {
  setSystemTime();
});

afterAll(() => {
  mock.restore();
});

describe("MentorService.getStudents", () => {
  it("throws ForbiddenError เมื่อผู้ใช้ไม่ใช่พี่เลี้ยง (ไม่มี staffProfiles)", async () => {
    const service = new MentorService();
    queryMocks.users.findFirst.mockResolvedValueOnce({
      id: "mentor-1",
      staffProfiles: null,
    });

    expect(
      service.getStudents("mentor-1", { page: 1, limit: 10 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("คืน list ว่างเมื่อไม่มีนักศึกษาตรงเงื่อนไขเลย (ไม่ query สถิติเพิ่ม)", async () => {
    const service = new MentorService();
    queryMocks.users.findFirst.mockResolvedValueOnce({
      id: "mentor-1",
      departmentId: 10,
      staffProfiles: { id: 1 },
    });
    mockSelect.mockReturnValueOnce(makeChainable([])); // latestExtensionQuery (สร้างแต่ไม่ await ตรงๆ)
    mockSelect.mockReturnValueOnce(makeChainable([])); // baseQuery -> ไม่มีนักศึกษาเลย

    const result = await service.getStudents("mentor-1", {
      page: 1,
      limit: 10,
    });

    expect(result).toEqual({
      data: [],
      meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
    });
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });

  it("รับ status='active'/'completed' และ search ได้โดยไม่ error (ผ่าน branch การกรองที่ต่างกัน)", async () => {
    const service = new MentorService();
    queryMocks.users.findFirst.mockResolvedValueOnce({
      id: "mentor-1",
      departmentId: 10,
      staffProfiles: { id: 1 },
    });
    mockSelect.mockReturnValueOnce(makeChainable([]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    const resultActive = await service.getStudents("mentor-1", {
      page: 1,
      limit: 10,
      status: "active",
    });
    expect(resultActive.data).toEqual([]);

    queryMocks.users.findFirst.mockResolvedValueOnce({
      id: "mentor-1",
      departmentId: 10,
      staffProfiles: { id: 1 },
    });
    mockSelect.mockReturnValueOnce(makeChainable([]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    const resultCompleted = await service.getStudents("mentor-1", {
      page: 1,
      limit: 10,
      status: "completed",
      search: "สมชาย",
    });
    expect(resultCompleted.data).toEqual([]);
  });

  it("คำนวณสถิติ วันนี้-ยังไม่ลงเวลา และชั่วโมงคงเหลือ (ผ่าน endDate) ได้ถูกต้อง", async () => {
    const service = new MentorService();
    setSystemTime(new Date(bkkIso("2025-06-16", "12:00"))); // จันทร์

    queryMocks.users.findFirst.mockResolvedValueOnce({
      id: "mentor-1",
      departmentId: 10,
      staffProfiles: { id: 1 },
    });
    mockSelect.mockReturnValueOnce(makeChainable([])); // latestExtensionQuery
    mockSelect.mockReturnValueOnce(
      makeChainable([
        {
          userId: "student-1",
          studentProfileId: 1,
          firstName: "สมชาย",
          lastName: "ใจดี",
          image: null,
          totalHoursGoal: 560,
          positionName: "Developer",
          username: "somchai",
          departmentName: "IT",
          endDate: "2025-06-20", // ศุกร์นี้
          extendedEndDate: null,
          institutionName: "ม.เกษตร",
          globalAccumulatedHours: "100.00",
          globalTotalHoursGoal: "560",
        },
      ]),
    ); // baseQuery
    mockSelect.mockReturnValueOnce(makeChainable([{ count: 1 }])); // totalRes
    mockSelect.mockReturnValueOnce(makeChainable([])); // todayLeaves (ไม่มีใครลาวันนี้)
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { studentProfileId: 1, workDate: "2025-06-16", dailyStatus: "PRESENT" },
        { studentProfileId: 1, workDate: "2025-06-13", dailyStatus: "LATE" },
      ]),
    ); // allLogs

    const result = await service.getStudents("mentor-1", {
      page: 1,
      limit: 10,
    });

    expect(result.meta).toEqual({ total: 1, page: 1, limit: 10, totalPages: 1 });
    const student = result.data[0];
    expect(student.fullName).toBe("สมชาย ใจดี (somchai)");
    expect(student.todayStatus).toEqual({ text: "เข้างานปกติ", code: "PRESENT" });
    expect(student.statistics).toEqual({ present: 1, late: 1, leave: 0, absent: 0 });
    expect(student.workHours.accumulated).toBe(100);
    expect(student.workHours.goal).toBe(560);
    // เหลือ 460 ชม. > 0 และมี endDate (ศุกร์เดียวกันสัปดาห์) -> เหลือ 5 วันทำการ (จ.-ศ.)
    expect(student.workHours.remainingDays).toBe(5);
  });

  it("แสดงสถานะวันนี้เป็น 'ลาป่วย'/'ลากิจ' แทน 'ลางาน' เมื่อมีใบลาที่อนุมัติแล้วของวันนี้", async () => {
    const service = new MentorService();
    setSystemTime(new Date(bkkIso("2025-06-16", "12:00")));

    queryMocks.users.findFirst.mockResolvedValueOnce({
      id: "mentor-1",
      departmentId: 10,
      staffProfiles: { id: 1 },
    });
    mockSelect.mockReturnValueOnce(makeChainable([]));
    mockSelect.mockReturnValueOnce(
      makeChainable([
        {
          userId: "student-1",
          studentProfileId: 1,
          firstName: "ก",
          lastName: "ข",
          image: null,
          totalHoursGoal: 560,
          positionName: null,
          username: "u1",
          departmentName: null,
          endDate: null,
          extendedEndDate: null,
          institutionName: null,
          globalAccumulatedHours: "0",
          globalTotalHoursGoal: "0",
        },
        {
          userId: "student-2",
          studentProfileId: 2,
          firstName: "ค",
          lastName: "ง",
          image: null,
          totalHoursGoal: 560,
          positionName: null,
          username: "u2",
          departmentName: null,
          endDate: null,
          extendedEndDate: null,
          institutionName: null,
          globalAccumulatedHours: "0",
          globalTotalHoursGoal: "0",
        },
      ]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([{ count: 2 }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { userId: "student-1", leaveType: "SICK" },
        { userId: "student-2", leaveType: "ABSENCE" },
      ]),
    );
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { studentProfileId: 1, workDate: "2025-06-16", dailyStatus: "LEAVE" },
        { studentProfileId: 2, workDate: "2025-06-16", dailyStatus: "LEAVE" },
      ]),
    );

    const result = await service.getStudents("mentor-1", {
      page: 1,
      limit: 10,
    });

    const byId = (id: string) =>
      result.data.find((s: { id: string }) => s.id === id)!;
    expect(byId("student-1").todayStatus).toEqual({ text: "ลาป่วย", code: "SICK" });
    expect(byId("student-2").todayStatus).toEqual({ text: "ลากิจ", code: "ABSENCE" });
  });

  it("คำนวณ remainingDays แบบประมาณ (เหลือชั่วโมง/7) เมื่อไม่มีทั้ง endDate และ extendedEndDate", async () => {
    const service = new MentorService();
    setSystemTime(new Date(bkkIso("2025-06-16", "12:00")));

    queryMocks.users.findFirst.mockResolvedValueOnce({
      id: "mentor-1",
      departmentId: 10,
      staffProfiles: { id: 1 },
    });
    mockSelect.mockReturnValueOnce(makeChainable([]));
    mockSelect.mockReturnValueOnce(
      makeChainable([
        {
          userId: "student-1",
          studentProfileId: 1,
          firstName: "ก",
          lastName: "ข",
          image: null,
          totalHoursGoal: 560,
          positionName: null,
          username: "u1",
          departmentName: null,
          endDate: null,
          extendedEndDate: null,
          institutionName: null,
          globalAccumulatedHours: "0",
          globalTotalHoursGoal: "560",
        },
      ]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([{ count: 1 }]));
    mockSelect.mockReturnValueOnce(makeChainable([]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    const result = await service.getStudents("mentor-1", {
      page: 1,
      limit: 10,
    });

    // เหลือ 560 ชม. ไม่มีวันสิ้นสุดให้อ้างอิง -> ceil(560/7) = 80 วัน
    expect(result.data[0].workHours.remainingDays).toBe(80);
  });
});

describe("MentorService.getStudentDetail", () => {
  it("throws ForbiddenError เมื่อผู้ใช้ไม่ใช่พี่เลี้ยง", async () => {
    const service = new MentorService();
    mockSelect.mockReturnValueOnce(makeChainable([])); // mentor check -> ไม่พบ

    expect(
      service.getStudentDetail("mentor-1", "student-1", {
        page: 1,
        limit: 10,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws NotFoundError เมื่อไม่พบนักศึกษา หรือนักศึกษาไม่ได้อยู่ในสถานะฝึกงาน", async () => {
    const service = new MentorService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "mentor-1" }])); // mentor ok
    mockSelect.mockReturnValueOnce(makeChainable([])); // studentInfo -> ไม่พบ

    expect(
      service.getStudentDetail("mentor-1", "student-1", {
        page: 1,
        limit: 10,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("รวมชั่วโมงสะสม สรุปสถิติ และแนบ note (ลา/นอกสถานที่/แก้ไขเวลา) ในแต่ละแถวถูกต้อง", async () => {
    const service = new MentorService();
    setSystemTime(new Date(bkkIso("2025-06-16", "12:00")));

    mockSelect.mockReturnValueOnce(makeChainable([{ id: "mentor-1" }])); // mentor
    mockSelect.mockReturnValueOnce(
      makeChainable([
        {
          userId: "student-1",
          applicationStatusId: 5,
          firstName: "สมชาย",
          lastName: "ใจดี",
          username: "somchai",
          email: "somchai@example.com",
          phone: "0812345678",
          image: null,
          internshipStatus: "ACTIVE",
          statusNote: null,
          institutionName: "ม.เกษตร",
          positionName: "Developer",
          startDate: "2025-05-01",
          endDate: "2025-07-15",
          totalHoursGoal: 560,
          studentProfileId: 1,
        },
      ]),
    ); // studentInfo
    mockSelect.mockReturnValueOnce(
      makeChainable([
        { dailyStatus: "PRESENT", actualHoursWorked: "7.00", approvedLeaveHours: "0" },
        { dailyStatus: "LATE", actualHoursWorked: "6.50", approvedLeaveHours: "0" },
        { dailyStatus: "LEAVE", actualHoursWorked: "0", approvedLeaveHours: "7.00" },
      ]),
    ); // allLogsForStats
    mockSelect.mockReturnValueOnce(
      makeChainable([{ totalExtendedHours: "0", latestNewEndDate: null, latestApprovedAt: null }]),
    ); // extendedData
    mockSelect.mockReturnValueOnce(makeChainable([{ count: 3 }])); // totalLogsCount
    mockSelect.mockReturnValueOnce(
      makeChainable([
        {
          id: 1,
          workDate: "2025-06-16",
          status: "PRESENT",
          actualHoursWorked: "7.00",
          approvedLeaveHours: "0",
          dailyTaskNote: null,
          checkInTime: bkkIso("2025-06-16", "08:30"),
          checkInNote: null,
          checkOutTime: bkkIso("2025-06-16", "16:30"),
          checkOutNote: null,
          leaveReason: null,
          leaveType: null,
          leaveFile: null,
          offsiteLocation: null,
          offsiteTaskDetail: null,
          correctionReason: null,
        },
        {
          id: 2,
          workDate: "2025-06-15",
          status: "LEAVE",
          actualHoursWorked: "0",
          approvedLeaveHours: "7.00",
          dailyTaskNote: null,
          checkInTime: null,
          checkInNote: null,
          checkOutTime: null,
          checkOutNote: null,
          leaveReason: "ไข้หวัด",
          leaveType: "SICK",
          leaveFile: "leaves/1.pdf",
          offsiteLocation: null,
          offsiteTaskDetail: null,
          correctionReason: null,
        },
        {
          id: 3,
          workDate: "2025-06-14",
          status: "PRESENT",
          actualHoursWorked: "7.00",
          approvedLeaveHours: "0",
          dailyTaskNote: null,
          checkInTime: bkkIso("2025-06-14", "08:30"),
          checkInNote: null,
          checkOutTime: bkkIso("2025-06-14", "16:30"),
          checkOutNote: null,
          leaveReason: null,
          leaveType: null,
          leaveFile: null,
          offsiteLocation: "บ้านลูกค้า A",
          offsiteTaskDetail: "ติดตั้งระบบ",
          correctionReason: "แก้ไขเวลาออกงาน",
        },
      ]),
    ); // paginatedLogs

    const result = await service.getStudentDetail("mentor-1", "student-1", {
      page: 1,
      limit: 10,
    });

    expect(result.progress.accumulatedHours).toBe(20.5); // 7 + 6.5 + 0 + 0 + 0 + 7
    expect(result.summary).toEqual({ present: 1, late: 1, leave: 1, absent: 0 });

    const records = result.attendanceTable.records;
    expect(records[0].checkInTime).not.toBe("--:--");
    expect(records[1].notes).toContainEqual({ type: "LEAVE", detail: "ไข้หวัด" });
    expect(records[1].hours).toBe(7); // 0 + 7 (approvedLeaveHours)
    expect(records[2].notes).toContainEqual({
      type: "OFFSITE",
      detail: "ปฏิบัติงานนอกสถานที่",
    });
    expect(records[2].notes).toContainEqual({
      type: "CORRECTION",
      detail: "แก้ไขเวลาออกงาน",
    });
  });

  it("ใช้ extendedEndDate จากการขยายเวลาที่อนุมัติแล้วแทน endDate เดิม เมื่อคำนวณวันคงเหลือ", async () => {
    const service = new MentorService();
    setSystemTime(new Date(bkkIso("2025-06-16", "12:00"))); // จันทร์

    mockSelect.mockReturnValueOnce(makeChainable([{ id: "mentor-1" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([
        {
          userId: "student-1",
          applicationStatusId: 5,
          firstName: "ก",
          lastName: "ข",
          username: "u1",
          email: "u1@example.com",
          phone: null,
          image: null,
          internshipStatus: "ACTIVE",
          statusNote: null,
          institutionName: null,
          positionName: null,
          startDate: "2025-05-01",
          endDate: "2025-06-16", // วันนี้พอดี (จะหมดเขต) แต่ถูกขยายเวลาแล้ว
          totalHoursGoal: 560,
          studentProfileId: 1,
        },
      ]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([])); // allLogsForStats ว่าง -> accumulated 0
    mockSelect.mockReturnValueOnce(
      makeChainable([
        {
          totalExtendedHours: "20",
          latestNewEndDate: "2025-06-20", // ขยายไปถึงศุกร์
          latestApprovedAt: "2025-06-01T00:00:00Z",
        },
      ]),
    );
    mockSelect.mockReturnValueOnce(makeChainable([{ count: 0 }]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    const result = await service.getStudentDetail("mentor-1", "student-1", {
      page: 1,
      limit: 10,
    });

    expect(result.progress.totalExtendedHours).toBe(20);
    expect(result.progress.extendedEndDate).not.toBeNull();
    // เหลือ 560 ชม. เต็ม และวันสิ้นสุดใหม่คือศุกร์นี้ (จ.-ศ. = 5 วันทำการ)
    expect(result.progress.remainingDays).toBe(5);
  });
});
