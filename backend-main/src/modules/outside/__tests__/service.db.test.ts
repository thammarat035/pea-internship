import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";

// ---------------------------------------------------------------------------
// เทส OffsiteTaskService ทั้ง 7 เมธอด (รวม private sendOffsiteNotification ที่
// ไม่ถูกเรียกใช้จากที่ไหนในไฟล์เลย - เทสแยกโดยตรงเช่นเดียวกับ helper อื่นๆ
// ที่ไม่มีคน caller) mock ทั้ง "@/db" (query + select builder ผสมกัน),
// "@/modules/fcm/service" และ "@/config/firebase" (ตัวหลังไม่ได้ใช้จริงเพราะ
// method ที่เรียกมันเป็น dead code แต่ต้อง mock กันพังตอน import)
// ---------------------------------------------------------------------------

function makeQueryMock() {
  return { findFirst: mock(), findMany: mock() };
}

const queryMocks = {
  users: makeQueryMock(),
  offsiteTasks: makeQueryMock(),
  applicationStatuses: makeQueryMock(),
  offsiteTaskStudents: makeQueryMock(),
};

const mockSelect = mock();

const mockInsertReturning = mock();
const mockInsertValues = mock((_values?: unknown) => ({
  returning: mockInsertReturning,
  then: (resolve: (v: unknown) => unknown) => Promise.resolve().then(resolve),
}));
const mockInsert = mock(() => ({ values: mockInsertValues }));

const mockUpdateWhere = mock(() => Promise.resolve());
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
  query: queryMocks,
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
  transaction: async (fn: (tx: unknown) => unknown) => fn(dbMock),
};

mock.module("@/db", () => ({ db: dbMock }));

const mockGetTokensByUserId = mock(() => Promise.resolve([] as string[]));
mock.module("@/modules/fcm/service", () => ({
  FCMService: class {
    getTokensByUserId = mockGetTokensByUserId;
  },
}));

const mockSendNotification = mock(() => Promise.resolve());
mock.module("@/config/firebase", () => ({
  sendNotification: mockSendNotification,
}));

const { OffsiteTaskService } = await import("../service");
const { BadRequestError, ForbiddenError, NotFoundError } = await import(
  "@/common/exceptions"
);

beforeEach(() => {
  for (const q of Object.values(queryMocks)) {
    q.findFirst.mockReset();
    q.findMany.mockReset();
  }
  mockSelect.mockReset();
  mockInsertReturning.mockReset();
  mockInsertValues.mockClear();
  mockInsert.mockClear();
  mockUpdateWhere.mockClear();
  mockUpdateSet.mockClear();
  mockUpdate.mockClear();
  mockDeleteWhere.mockClear();
  mockDelete.mockClear();
  mockGetTokensByUserId.mockReset();
  mockSendNotification.mockReset();
});

afterAll(() => {
  mock.restore();
});

describe("OffsiteTaskService.createTask", () => {
  it("throws BadRequestError เมื่อไม่ระบุนักศึกษาเลย", async () => {
    const service = new OffsiteTaskService();

    expect(
      service.createTask("mentor-1", {
        workDate: "2025-06-20",
        locationName: "x",
        taskDetail: "y",
        studentIds: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("มอบหมายงานสำเร็จ: บันทึกงาน ผูกรายชื่อนักศึกษา และแจ้งเตือนทุกคน", async () => {
    const service = new OffsiteTaskService();
    queryMocks.users.findFirst.mockResolvedValueOnce({
      fname: "พี่เลี้ยง",
      lname: "ใจดี",
    });
    mockInsertReturning.mockResolvedValueOnce([{ id: 100 }]);

    const result = await service.createTask("mentor-1", {
      workDate: "2025-06-20",
      locationName: "บ้านลูกค้า A",
      taskDetail: "ติดตั้งระบบ",
      studentIds: ["student-1", "student-2"],
    });

    expect(result).toEqual({
      success: true,
      message: "มอบหมายงานนอกสถานที่สำเร็จพร้อมแจ้งเตือนนักศึกษา",
      taskId: 100,
    });
    // insert 0 = offsiteTasks, 1 = offsiteTaskStudents, 2 = notifications
    expect(mockInsertValues.mock.calls[1][0]).toEqual([
      { taskId: 100, studentId: "student-1" },
      { taskId: 100, studentId: "student-2" },
    ]);
    const notificationPayload = mockInsertValues.mock.calls[2][0] as Array<{
      message: string;
    }>;
    expect(notificationPayload).toHaveLength(2);
    expect(notificationPayload[0].message).toContain("พี่เลี้ยง ใจดี");
  });

  it("ใช้ 'พี่เลี้ยง' เป็นชื่อ fallback เมื่อไม่พบข้อมูลพี่เลี้ยง", async () => {
    const service = new OffsiteTaskService();
    queryMocks.users.findFirst.mockResolvedValueOnce(undefined);
    mockInsertReturning.mockResolvedValueOnce([{ id: 101 }]);

    await service.createTask("mentor-1", {
      workDate: "2025-06-20",
      locationName: "x",
      taskDetail: "y",
      studentIds: ["student-1"],
    });

    const notificationPayload = mockInsertValues.mock.calls[2][0] as Array<{
      message: string;
    }>;
    expect(notificationPayload[0].message).toContain("(พี่เลี้ยง)");
  });
});

describe("OffsiteTaskService.getTasksByMentor", () => {
  it("คืนรายการงานของ mentor คนนั้น", async () => {
    const service = new OffsiteTaskService();
    queryMocks.offsiteTasks.findMany.mockResolvedValueOnce([{ id: 1 }]);

    const result = await service.getTasksByMentor("mentor-1");

    expect(result).toMatchObject([{ id: 1 }]);
  });
});

describe("OffsiteTaskService.getTasksForStudent", () => {
  it("แปลงข้อมูลงาน แนบชื่อตำแหน่งจากใบสมัคร active และเรียงจากวันที่ล่าสุดไปเก่าสุด", async () => {
    const service = new OffsiteTaskService();
    queryMocks.applicationStatuses.findFirst.mockResolvedValueOnce({
      internshipPosition: { name: "Developer" },
    });
    queryMocks.offsiteTaskStudents.findMany.mockResolvedValueOnce([
      {
        task: {
          id: 1,
          workDate: "2025-06-10",
          locationName: "A",
          taskDetail: "d1",
          note: null,
          assignedByUser: { fname: "พี่", lname: "เลี้ยง" },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      {
        task: {
          id: 2,
          workDate: "2025-06-20",
          locationName: "B",
          taskDetail: "d2",
          note: null,
          assignedByUser: { fname: "พี่", lname: "เลี้ยง" },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    ]);

    const result = await service.getTasksForStudent("student-1");

    expect(result).toHaveLength(2);
    expect(result[0].taskId).toBe(2); // งานวันที่ 20 มิ.ย. มาก่อนเพราะเรียงล่าสุดก่อน
    expect(result[0].positionName).toBe("Developer");
    expect(result[0].assignedBy).toBe("พี่ เลี้ยง");
  });

  it("ใช้ 'ไม่ระบุตำแหน่ง' เมื่อไม่มีใบสมัคร active และข้าม record ที่ task เป็น null (ถูกลบไปแล้ว)", async () => {
    const service = new OffsiteTaskService();
    queryMocks.applicationStatuses.findFirst.mockResolvedValueOnce(undefined);
    queryMocks.offsiteTaskStudents.findMany.mockResolvedValueOnce([
      { task: null }, // งานถูกลบ (soft delete) -> ถูกกรองออก
      {
        task: {
          id: 1,
          workDate: "2025-06-10",
          locationName: "A",
          taskDetail: "d1",
          note: null,
          assignedByUser: { fname: "พี่", lname: "เลี้ยง" },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    ]);

    const result = await service.getTasksForStudent("student-1");

    expect(result).toHaveLength(1);
    expect(result[0].positionName).toBe("ไม่ระบุตำแหน่ง");
  });
});

describe("OffsiteTaskService.updateTask", () => {
  it("throws NotFoundError เมื่อไม่พบงาน หรือไม่ใช่เจ้าของงาน", async () => {
    const service = new OffsiteTaskService();
    queryMocks.offsiteTasks.findFirst.mockResolvedValueOnce(undefined);

    expect(
      service.updateTask(5, "mentor-1", {}),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws BadRequestError เมื่อส่ง studentIds มาเป็น array ว่าง", async () => {
    const service = new OffsiteTaskService();
    queryMocks.offsiteTasks.findFirst.mockResolvedValueOnce({ id: 5 });

    expect(
      service.updateTask(5, "mentor-1", { studentIds: [] }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("แก้ไขข้อมูลงานอย่างเดียว โดยไม่แตะรายชื่อนักศึกษาเมื่อไม่ได้ส่ง studentIds มา", async () => {
    const service = new OffsiteTaskService();
    queryMocks.offsiteTasks.findFirst.mockResolvedValueOnce({ id: 5 });

    const result = await service.updateTask(5, "mentor-1", {
      locationName: "ที่ใหม่",
    });

    expect(result.success).toBe(true);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("แก้ไขรายชื่อนักศึกษา: ลบของเดิมทั้งหมดแล้วเพิ่มใหม่", async () => {
    const service = new OffsiteTaskService();
    queryMocks.offsiteTasks.findFirst.mockResolvedValueOnce({ id: 5 });

    await service.updateTask(5, "mentor-1", {
      studentIds: ["student-3"],
    });

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockInsertValues.mock.calls[0][0]).toEqual([
      { taskId: 5, studentId: "student-3" },
    ]);
  });
});

describe("OffsiteTaskService.deleteTask", () => {
  it("throws NotFoundError เมื่อไม่พบงาน หรือไม่ใช่เจ้าของงาน", async () => {
    const service = new OffsiteTaskService();
    queryMocks.offsiteTasks.findFirst.mockResolvedValueOnce(undefined);

    expect(
      service.deleteTask(5, "mentor-1"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("ลบ (soft delete) สำเร็จโดยตั้งค่า deletedAt", async () => {
    const service = new OffsiteTaskService();
    queryMocks.offsiteTasks.findFirst.mockResolvedValueOnce({ id: 5 });

    const result = await service.deleteTask(5, "mentor-1");

    expect(result.success).toBe(true);
    expect(mockUpdateSet.mock.calls[0][0]).toHaveProperty("deletedAt");
  });
});

describe("OffsiteTaskService.getTasksForDept", () => {
  it("throws BadRequestError เมื่อผู้ใช้ไม่มีสังกัดแผนก", async () => {
    const service = new OffsiteTaskService();
    queryMocks.users.findFirst.mockResolvedValueOnce({ departmentId: null });

    expect(
      service.getTasksForDept("mentor-1", {}),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("throws BadRequestError เมื่อระบุ targetMentorId ที่ไม่มีอยู่จริง", async () => {
    const service = new OffsiteTaskService();
    queryMocks.users.findFirst.mockResolvedValueOnce({ departmentId: 10 });
    queryMocks.users.findFirst.mockResolvedValueOnce(undefined);

    expect(
      service.getTasksForDept("mentor-1", { targetMentorId: "ghost" }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("throws ForbiddenError เมื่อ targetMentorId อยู่คนละแผนก", async () => {
    const service = new OffsiteTaskService();
    queryMocks.users.findFirst.mockResolvedValueOnce({ departmentId: 10 });
    queryMocks.users.findFirst.mockResolvedValueOnce({ departmentId: 99 });

    expect(
      service.getTasksForDept("mentor-1", { targetMentorId: "other-mentor" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("viewMode='mine' (ค่า default): คืนผลลัพธ์พร้อม pagination และ isOwner ถูกต้อง", async () => {
    const service = new OffsiteTaskService();
    queryMocks.users.findFirst.mockResolvedValueOnce({ departmentId: 10 });
    mockSelect.mockReturnValueOnce(makeChainable([{ count: 1 }])); // totalResult
    queryMocks.offsiteTasks.findMany.mockResolvedValueOnce([
      {
        id: 1,
        workDate: "2025-06-20",
        createdAt: new Date(),
        locationName: "A",
        taskDetail: "d",
        updatedAt: new Date(),
        assignedByUser: { id: "mentor-1", fname: "พี่", lname: "เลี้ยง" },
        students: [
          { student: { id: "student-1", fname: "สม", lname: "ชาย", displayUsername: "somchai" } },
        ],
      },
    ]);

    const result = await service.getTasksForDept("mentor-1", {});

    expect(result.meta).toEqual({ total: 1, page: 1, limit: 10, totalPages: 1 });
    expect(result.data[0].isOwner).toBe(true);
    expect(result.data[0].students[0].name).toBe("สม ชาย");
  });

  it("viewMode='all': ค้นหา mentor ทุกคนในแผนกก่อนกรอง", async () => {
    const service = new OffsiteTaskService();
    queryMocks.users.findFirst.mockResolvedValueOnce({ departmentId: 10 });
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "mentor-1" }, { id: "mentor-2" }])); // deptMentors
    mockSelect.mockReturnValueOnce(makeChainable([{ count: 0 }])); // totalResult
    queryMocks.offsiteTasks.findMany.mockResolvedValueOnce([]);

    const result = await service.getTasksForDept("mentor-1", { viewMode: "all" });

    expect(result.data).toEqual([]);
  });

  it("assignedBy คืน 'ไม่ระบุ' เมื่อไม่พบผู้มอบหมายงาน (assignedByUser เป็น null)", async () => {
    const service = new OffsiteTaskService();
    queryMocks.users.findFirst.mockResolvedValueOnce({ departmentId: 10 });
    mockSelect.mockReturnValueOnce(makeChainable([{ count: 1 }]));
    queryMocks.offsiteTasks.findMany.mockResolvedValueOnce([
      {
        id: 1,
        workDate: "2025-06-20",
        createdAt: new Date(),
        locationName: "A",
        taskDetail: "d",
        updatedAt: new Date(),
        assignedByUser: null,
        students: [],
      },
    ]);

    const result = await service.getTasksForDept("mentor-1", {});

    expect(result.data[0].assignedBy).toBe("ไม่ระบุ");
    expect(result.data[0].isOwner).toBe(false);
  });

  it("search ไม่เจอผลลัพธ์เลย -> บังคับให้ไม่มีข้อมูลคืนกลับ", async () => {
    const service = new OffsiteTaskService();
    queryMocks.users.findFirst.mockResolvedValueOnce({ departmentId: 10 });
    mockSelect.mockReturnValueOnce(makeChainable([])); // matchingTaskIds ว่าง
    mockSelect.mockReturnValueOnce(makeChainable([{ count: 0 }]));
    queryMocks.offsiteTasks.findMany.mockResolvedValueOnce([]);

    const result = await service.getTasksForDept("mentor-1", { search: "ไม่มีตัวตน" });

    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
  });
});

describe("OffsiteTaskService.getTaskById", () => {
  it("throws BadRequestError เมื่อไม่พบผู้ใช้งานปัจจุบัน", async () => {
    const service = new OffsiteTaskService();
    queryMocks.users.findFirst.mockResolvedValueOnce(undefined);

    expect(
      service.getTaskById(5, "user-1", 2),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("throws NotFoundError เมื่อไม่พบงาน", async () => {
    const service = new OffsiteTaskService();
    queryMocks.users.findFirst.mockResolvedValueOnce({ id: "user-1", departmentId: 10 });
    queryMocks.offsiteTasks.findFirst.mockResolvedValueOnce(undefined);

    expect(
      service.getTaskById(5, "user-1", 2),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws BadRequestError เมื่อ mentor/admin พยายามดูงานของแผนกอื่น", async () => {
    const service = new OffsiteTaskService();
    queryMocks.users.findFirst.mockResolvedValueOnce({ id: "mentor-1", departmentId: 10 });
    queryMocks.offsiteTasks.findFirst.mockResolvedValueOnce({
      assignedByUser: { departmentId: 99 },
      students: [],
    });

    expect(
      service.getTaskById(5, "mentor-1", 2),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("throws BadRequestError เมื่อ student ไม่ได้รับมอบหมายงานนี้", async () => {
    const service = new OffsiteTaskService();
    queryMocks.users.findFirst.mockResolvedValueOnce({ id: "student-1", departmentId: null });
    queryMocks.offsiteTasks.findFirst.mockResolvedValueOnce({
      assignedByUser: { departmentId: 10 },
      students: [{ student: { id: "other-student" } }],
    });

    expect(
      service.getTaskById(5, "student-1", 3),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("throws BadRequestError เมื่อ roleId ไม่รู้จัก", async () => {
    const service = new OffsiteTaskService();
    queryMocks.users.findFirst.mockResolvedValueOnce({ id: "user-1", departmentId: 10 });
    queryMocks.offsiteTasks.findFirst.mockResolvedValueOnce({
      assignedByUser: { departmentId: 10 },
      students: [],
    });

    expect(
      service.getTaskById(5, "user-1", 99),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("Student ที่ได้รับมอบหมายเห็นรายละเอียดงาน พร้อมชื่อตำแหน่งจากใบสมัคร active", async () => {
    const service = new OffsiteTaskService();
    queryMocks.users.findFirst.mockResolvedValueOnce({ id: "student-1", departmentId: null });
    queryMocks.offsiteTasks.findFirst.mockResolvedValueOnce({
      id: 5,
      workDate: "2025-06-20",
      createdAt: new Date(),
      locationName: "A",
      taskDetail: "d",
      note: "n",
      assignedByUser: {
        id: "mentor-1",
        fname: "พี่",
        lname: "เลี้ยง",
        departmentId: 10,
        staffProfiles: [{ employeeId: "EMP001" }],
      },
      students: [
        {
          student: {
            id: "student-1",
            fname: "สม",
            lname: "ชาย",
            displayUsername: "somchai",
            studentProfiles: [{ image: "img.png", faculty: "วิศวะ", major: "CS" }],
            applicationStatuses: [{ internshipPosition: { name: "Developer" } }],
          },
        },
      ],
    });

    const result = await service.getTaskById(5, "student-1", 3);

    expect(result.isOwner).toBe(false);
    expect(result.assignedByEmployeeId).toBe("EMP001");
    expect(result.students[0]).toMatchObject({
      name: "สม ชาย",
      positionName: "Developer",
      image: "img.png",
    });
  });

  it("นักศึกษาที่ไม่มีใบสมัคร active -> positionName เป็น 'ไม่ระบุตำแหน่ง'", async () => {
    const service = new OffsiteTaskService();
    queryMocks.users.findFirst.mockResolvedValueOnce({ id: "mentor-1", departmentId: 10 });
    queryMocks.offsiteTasks.findFirst.mockResolvedValueOnce({
      id: 5,
      workDate: "2025-06-20",
      createdAt: new Date(),
      locationName: "A",
      taskDetail: "d",
      note: null,
      assignedByUser: {
        id: "mentor-1",
        fname: "พี่",
        lname: "เลี้ยง",
        departmentId: 10,
        staffProfiles: [],
      },
      students: [
        {
          student: {
            id: "student-1",
            fname: "สม",
            lname: "ชาย",
            displayUsername: null,
            studentProfiles: [],
            applicationStatuses: [],
          },
        },
      ],
    });

    const result = await service.getTaskById(5, "mentor-1", 2);

    expect(result.students[0].positionName).toBe("ไม่ระบุตำแหน่ง");
    expect(result.assignedByEmployeeId).toBeNull();
    expect(result.isOwner).toBe(true);
  });
});

describe("OffsiteTaskService (private, dead code) sendOffsiteNotification", () => {
  // เมธอดนี้ไม่ถูกเรียกใช้จากที่ไหนในไฟล์เลย (grep ทั้งไฟล์เจอแค่ที่ประกาศ)
  // เทสไว้เผื่อวันหนึ่งมีคนเริ่มเรียกใช้งานจริง
  function callSendOffsiteNotification(
    service: InstanceType<typeof OffsiteTaskService>,
    mentorId: string,
    studentIds: string[],
    location: string,
    date: string,
  ) {
    return (
      service as unknown as {
        sendOffsiteNotification: (
          mentorId: string,
          studentIds: string[],
          location: string,
          date: string,
        ) => Promise<void>;
      }
    ).sendOffsiteNotification(mentorId, studentIds, location, date);
  }

  it("ส่ง FCM notification ให้ทุก token ของนักศึกษาทุกคนที่ระบุ", async () => {
    const service = new OffsiteTaskService();
    queryMocks.users.findFirst.mockResolvedValueOnce({ fname: "พี่", lname: "เลี้ยง" });
    mockGetTokensByUserId
      .mockResolvedValueOnce(["token-1", "token-2"])
      .mockResolvedValueOnce(["token-3"]);

    await callSendOffsiteNotification(
      service,
      "mentor-1",
      ["student-1", "student-2"],
      "บ้านลูกค้า A",
      "2025-06-20",
    );

    expect(mockSendNotification).toHaveBeenCalledTimes(3);
  });

  it("ไม่ throw แม้เกิด error ระหว่างส่ง (ดักไว้ด้วย try/catch)", async () => {
    const service = new OffsiteTaskService();
    queryMocks.users.findFirst.mockRejectedValueOnce(new Error("db down"));

    await expect(
      callSendOffsiteNotification(service, "mentor-1", ["student-1"], "A", "2025-06-20"),
    ).resolves.toBeUndefined();
  });
});
