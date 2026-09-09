import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// เทส MailService: โมดูลนี้ไม่มี route/database เลย เป็น pure wrapper รอบ
// nodemailer + template builder ฟังก์ชัน ความรับผิดชอบหลักของคลาสนี้คือ
// "แมป field ให้ถูก + เลือก subject/template ให้ตรงกับ event" (ไม่ใช่การ
// render HTML จริง ซึ่งเป็นหน้าที่ของไฟล์ template แยกต่างหาก) จึง mock ทั้ง
// nodemailer และ ./templates ออกไปทั้งคู่ เพื่อโฟกัสแค่ mapping ของ service เอง
//
// สำคัญ: service.ts อ่าน process.env.APP_URL ที่ "module load time" แล้ว throw
// ทันทีถ้าไม่ได้ตั้งไว้ (บรรทัด 12-16) จึงต้องตั้งค่า env นี้ก่อน import เสมอ
// ---------------------------------------------------------------------------

process.env.APP_URL = "https://intern.example.com";
process.env.MAIL_FROM = "noreply@example.com";

const mockSendMail = mock(() => Promise.resolve());
const mockCreateTransport = mock(() => ({ sendMail: mockSendMail }));

mock.module("nodemailer", () => ({
  default: { createTransport: mockCreateTransport },
  createTransport: mockCreateTransport,
}));

const mockAcceptTemplate = mock((_p: unknown) => "<html>accept</html>");
const mockCancelTemplate = mock((_p: unknown) => "<html>cancel</html>");
const mockCompleteTemplate = mock((_p: unknown) => "<html>complete</html>");
const mockPositionFilledTemplate = mock((_p: unknown) => "<html>filled</html>");
const mockRejectTemplate = mock((_p: unknown) => "<html>reject</html>");
const mockRejectDocTemplate = mock((_p: unknown) => "<html>reject-doc</html>");
const mockResetPasswordTemplate = mock((_p: unknown) => "<html>reset</html>");

mock.module("@/modules/mail/templates", () => ({
  acceptTemplate: mockAcceptTemplate,
  cancelTemplate: mockCancelTemplate,
  completeTemplate: mockCompleteTemplate,
  positionFilledTemplate: mockPositionFilledTemplate,
  rejectTemplate: mockRejectTemplate,
  rejectDocTemplate: mockRejectDocTemplate,
  resetPasswordTemplate: mockResetPasswordTemplate,
}));

const { MailService, sendResetPasswordCodeEmail } = await import(
  "../service"
);

beforeEach(() => {
  mockSendMail.mockClear();
  mockCreateTransport.mockClear();
  mockAcceptTemplate.mockClear();
  mockCancelTemplate.mockClear();
  mockCompleteTemplate.mockClear();
  mockPositionFilledTemplate.mockClear();
  mockRejectTemplate.mockClear();
  mockRejectDocTemplate.mockClear();
  mockResetPasswordTemplate.mockClear();
});

afterAll(() => {
  mock.restore();
});

describe("MailService.sendEmail", () => {
  it("throws Error เมื่อไม่ระบุผู้รับ", async () => {
    const service = new MailService();

    expect(service.sendEmail("", "หัวข้อ", "<p>hi</p>")).rejects.toThrow(
      "Email recipient is required",
    );
  });

  it("ส่งอีเมลสำเร็จผ่าน transporter.sendMail โดยใช้ MAIL_FROM เป็นผู้ส่ง", async () => {
    const service = new MailService();

    await service.sendEmail("student1@example.com", "หัวข้อทดสอบ", "<p>hi</p>");

    expect(mockSendMail).toHaveBeenCalledWith({
      from: "noreply@example.com",
      to: "student1@example.com",
      subject: "หัวข้อทดสอบ",
      html: "<p>hi</p>",
    });
  });
});

describe("MailService build*Email methods", () => {
  const params = {
    firstname: "สมชาย",
    lastname: "ใจดี",
    positionName: "Developer",
    departmentName: "ฝ่าย IT",
  };

  it("buildAcceptedForInternshipEmail: subject ถูกต้อง และแมป field เป็น firstName/lastName/position/department/appUrl", () => {
    const service = new MailService();

    const result = service.buildAcceptedForInternshipEmail(params);

    expect(result.subject).toBe("โปรดอัปโหลดเอกสารขอความอนุเคราะห์");
    expect(mockAcceptTemplate).toHaveBeenCalledWith({
      firstName: "สมชาย",
      lastName: "ใจดี",
      position: "Developer",
      department: "ฝ่าย IT",
      appUrl: "https://intern.example.com/",
    });
    expect(result.html).toBe("<html>accept</html>");
  });

  it("buildInternshipCompletedEmail: subject ถูกต้องและเรียก completeTemplate", () => {
    const service = new MailService();

    const result = service.buildInternshipCompletedEmail(params);

    expect(result.subject).toBe("คุณผ่านเข้าฝึกงานแล้ว");
    expect(mockCompleteTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: "สมชาย", position: "Developer" }),
    );
  });

  it("buildDocumentRejectedEmail: ไม่ต้องมี position/department ก็เรียกได้ (เอกสารตีกลับไม่ต้องระบุตำแหน่ง)", () => {
    const service = new MailService();

    const result = service.buildDocumentRejectedEmail({
      firstname: "สมชาย",
      lastname: "ใจดี",
    });

    expect(result.subject).toBe("เอกสารถูกตีกลับ");
    expect(mockRejectDocTemplate).toHaveBeenCalledWith({
      firstName: "สมชาย",
      lastName: "ใจดี",
      appUrl: "https://intern.example.com/",
    });
  });

  it("buildRejectedByOwnerEmail: subject ถูกต้องและเรียก rejectTemplate", () => {
    const service = new MailService();

    const result = service.buildRejectedByOwnerEmail(params);

    expect(result.subject).toBe("ผลการสมัครฝึกงาน");
    expect(mockRejectTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ department: "ฝ่าย IT" }),
    );
  });

  it("buildInternshipCanceledEmail: subject ถูกต้องและเรียก cancelTemplate", () => {
    const service = new MailService();

    const result = service.buildInternshipCanceledEmail(params);

    expect(result.subject).toBe("การฝึกงานถูกยกเลิก");
    expect(mockCancelTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ lastName: "ใจดี" }),
    );
  });

  it("buildPositionFilledEmail: subject ถูกต้องและเรียก positionFilledTemplate", () => {
    const service = new MailService();

    const result = service.buildPositionFilledEmail(params);

    expect(result.subject).toBe("การสมัครถูกยกเลิกเนื่องจากตำแหน่งเต็ม");
    expect(mockPositionFilledTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ position: "Developer" }),
    );
  });
});

describe("sendResetPasswordCodeEmail", () => {
  it("ส่งอีเมลรีเซ็ตรหัสผ่านพร้อมรหัส OTP ผ่าน resetPasswordTemplate", async () => {
    await sendResetPasswordCodeEmail("student1@example.com", "123456");

    expect(mockResetPasswordTemplate).toHaveBeenCalledWith({ code: "123456" });
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "student1@example.com",
        subject: "รีเซ็ตรหัสผ่าน",
        html: "<html>reset</html>",
      }),
    );
  });
});
