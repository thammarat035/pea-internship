import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

// ---------------------------------------------------------------------------
// เทส route ทั้ง 11 endpoint ของ user module โดย mock UserService ทั้งคลาส
// จุดสังเกต: route นี้ผสมทั้ง session.userId (บาง endpoint) และ user.id
// (บาง endpoint) เป็น identity หลัก คนละแบบกันตามแต่ละ route — ต้องเช็คให้
// ตรงว่า endpoint ไหนใช้ตัวไหน
// ---------------------------------------------------------------------------

const mockMe = mock();
const mockGetStaff = mock();
const mockGetStudent = mock();
const mockUpdateUser = mock();
const mockUpdateStaffPhone = mock();
const mockUpdateStudentProfile = mock();
const mockGetStudentProgress = mock();
const mockUpdateProfile = mock();
const mockGetProfileImage = mock();
const mockExtendInternship = mock();
const mockCompleteInternship = mock();

mock.module("../service", () => ({
  UserService: class {
    me = mockMe;
    getStaff = mockGetStaff;
    getStudent = mockGetStudent;
    updateUser = mockUpdateUser;
    updateStaffPhone = mockUpdateStaffPhone;
    updateStudentProfile = mockUpdateStudentProfile;
    getStudentProgress = mockGetStudentProgress;
    updateProfile = mockUpdateProfile;
    getProfileImage = mockGetProfileImage;
    extendInternship = mockExtendInternship;
    completeInternship = mockCompleteInternship;
  },
}));

const FAKE_USER = { id: "fake-user-id", roleId: 3 };
const FAKE_SESSION = { id: "fake-session-id", userId: FAKE_USER.id };

mock.module("@/middlewares/auth.middleware", () => ({
  ROLE_IDS: { ADMIN: 1, MENTOR: 2, STUDENT: 3 },
  isAuthenticated: new Elysia({ name: "better-auth" }).macro({
    auth: {
      resolve: () => ({ user: FAKE_USER, session: FAKE_SESSION }),
    },
    role: () => ({
      resolve: () => ({ user: FAKE_USER, session: FAKE_SESSION }),
    }),
  }),
}));

const { user } = await import("../index");

describe("user routes", () => {
  beforeEach(() => {
    mockMe.mockReset();
    mockGetStaff.mockReset();
    mockGetStudent.mockReset();
    mockUpdateUser.mockReset();
    mockUpdateStaffPhone.mockReset();
    mockUpdateStudentProfile.mockReset();
    mockGetStudentProgress.mockReset();
    mockUpdateProfile.mockReset();
    mockGetProfileImage.mockReset();
    mockExtendInternship.mockReset();
    mockCompleteInternship.mockReset();
  });

  it("GET /user/profile เรียก service.me ด้วย session.userId", async () => {
    mockMe.mockResolvedValue({ id: FAKE_USER.id });

    const response = await user.handle(
      new Request("http://localhost/user/profile"),
    );

    expect(response.status).toBe(200);
    expect(mockMe).toHaveBeenCalledWith(FAKE_SESSION.userId);
  });

  it("GET /user/staff เรียก service.getStaff ด้วย departmentId ที่แปลงเป็นตัวเลขแล้ว", async () => {
    mockGetStaff.mockResolvedValue([]);

    await user.handle(new Request("http://localhost/user/staff?departmentId=10"));

    expect(mockGetStaff).toHaveBeenCalledWith(10);
  });

  it("GET /user/student เรียก service.getStudent ด้วย departmentId จาก query", async () => {
    mockGetStudent.mockResolvedValue([]);

    await user.handle(new Request("http://localhost/user/student?departmentId=10"));

    expect(mockGetStudent).toHaveBeenCalledWith(10);
  });

  it("PUT /user/update เรียก service.updateUser ด้วย session.userId และ body", async () => {
    mockUpdateUser.mockResolvedValue({ id: FAKE_USER.id });

    const response = await user.handle(
      new Request("http://localhost/user/update", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fname: "ใหม่" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockUpdateUser).toHaveBeenCalledWith(
      FAKE_SESSION.userId,
      expect.objectContaining({ fname: "ใหม่" }),
    );
  });

  it("PUT /user/staff/:staffProfileId/phone เรียก service.updateStaffPhone ด้วย id (ตัวเลข) และเบอร์โทร", async () => {
    mockUpdateStaffPhone.mockResolvedValue({ id: "owner-1" });

    await user.handle(
      new Request("http://localhost/user/staff/5/phone", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: "0812345678" }),
      }),
    );

    expect(mockUpdateStaffPhone).toHaveBeenCalledWith(5, "0812345678");
  });

  it("PUT /user/student-profile เรียก service.updateStudentProfile ด้วย session.userId และ body", async () => {
    mockUpdateStudentProfile.mockResolvedValue({ id: 1 });

    await user.handle(
      new Request("http://localhost/user/student-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ faculty: "วิศวะ" }),
      }),
    );

    expect(mockUpdateStudentProfile).toHaveBeenCalledWith(
      FAKE_SESSION.userId,
      expect.objectContaining({ faculty: "วิศวะ" }),
    );
  });

  it("GET /user/student/total-hours เรียก service.getStudentProgress ด้วย user.id", async () => {
    mockGetStudentProgress.mockResolvedValue({ percentage: 50 });

    await user.handle(
      new Request("http://localhost/user/student/total-hours"),
    );

    expect(mockGetStudentProgress).toHaveBeenCalledWith(FAKE_USER.id);
  });

  it("PUT /user/student/itt/profile เรียก service.updateProfile ด้วย user.id และ body", async () => {
    mockUpdateProfile.mockResolvedValue({ success: true });

    const formData = new FormData();
    formData.append("nickname", "นิคเนม");

    await user.handle(
      new Request("http://localhost/user/student/itt/profile", {
        method: "PUT",
        body: formData,
      }),
    );

    expect(mockUpdateProfile).toHaveBeenCalledWith(
      FAKE_USER.id,
      expect.objectContaining({ nickname: "นิคเนม" }),
    );
  });

  it("GET /user/student/itt/profile ใช้ user.id เป็นค่า default เมื่อไม่ระบุ userId ใน query", async () => {
    mockGetProfileImage.mockResolvedValue({
      buffer: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    });

    const response = await user.handle(
      new Request("http://localhost/user/student/itt/profile"),
    );

    expect(response.status).toBe(200);
    expect(mockGetProfileImage).toHaveBeenCalledWith(FAKE_USER.id);
  });

  it("GET /user/student/itt/profile ใช้ userId จาก query แทนเมื่อระบุมา", async () => {
    mockGetProfileImage.mockResolvedValue({
      buffer: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    });

    await user.handle(
      new Request(
        "http://localhost/user/student/itt/profile?userId=other-student",
      ),
    );

    expect(mockGetProfileImage).toHaveBeenCalledWith("other-student");
  });

  it("POST /user/internship/extend เรียก service.extendInternship ด้วย mentorId=user.id", async () => {
    mockExtendInternship.mockResolvedValue({ success: true });

    await user.handle(
      new Request("http://localhost/user/internship/extend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: "student-1", hours: 7 }),
      }),
    );

    expect(mockExtendInternship).toHaveBeenCalledWith({
      studentId: "student-1",
      hours: 7,
      mentorId: FAKE_USER.id,
      reason: undefined,
    });
  });

  it("POST /user/internship/complete เรียก service.completeInternship ด้วย studentId, user.id, note", async () => {
    mockCompleteInternship.mockResolvedValue({ success: true });

    await user.handle(
      new Request("http://localhost/user/internship/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: "student-1", note: "ครบกำหนด" }),
      }),
    );

    expect(mockCompleteInternship).toHaveBeenCalledWith(
      "student-1",
      FAKE_USER.id,
      "ครบกำหนด",
    );
  });
});

afterAll(() => {
  mock.restore();
});
