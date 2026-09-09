import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// เทส AuthService ทั้ง 9 เมธอด mock "@/lib/auth" (better-auth instance) ทั้งตัว
// เพราะเป็น library ที่ทำงานจริงกับ database/crypto ของมันเอง ไม่เกี่ยวกับ
// business logic ที่ service.ts เป็นคนควบคุม (เช่น sign-up สำเร็จไหม, รหัสถูก
// ไหม) — ส่วน crypto ของ node (hash/randomBytes) ปล่อยให้รันจริง เพราะเป็น
// pure computation กำหนดผลลัพธ์ได้แน่นอน ไม่ต้อง mock
// ---------------------------------------------------------------------------

function makeQueryMock() {
  return { findFirst: mock(), findMany: mock() };
}

const mockSelect = mock();

const mockInsertValues = mock((_values?: unknown) => ({
  then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve().then(resolve, reject),
}));
const mockInsert = mock(() => ({ values: mockInsertValues }));

const mockUpdateReturning = mock(() => Promise.resolve([{ id: 1 }]));
const mockUpdateWhere = mock((_where?: unknown) => ({
  returning: mockUpdateReturning,
  then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve().then(resolve, reject),
}));
const mockUpdateSet = mock((_set?: unknown) => ({ where: mockUpdateWhere }));
const mockUpdate = mock(() => ({ set: mockUpdateSet }));

const mockDeleteWhere = mock(() => Promise.resolve());
const mockDelete = mock(() => ({ where: mockDeleteWhere }));

function makeChainable<T>(result: T) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.limit = () => chain;
  chain.then = (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

const dbMock = {
  query: { studentProfiles: makeQueryMock() },
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
  transaction: async (fn: (tx: unknown) => unknown) => fn(dbMock),
};

mock.module("@/db", () => ({ db: dbMock }));

const mockSignUpEmail = mock();
const mockSignInUsername = mock();
const mockSignOut = mock();
const mockSignInSocial = mock();
const mockPasswordHash = mock(() => Promise.resolve("hashed-password"));

mock.module("@/lib/auth", () => ({
  auth: {
    api: {
      signUpEmail: mockSignUpEmail,
      signInUsername: mockSignInUsername,
      signOut: mockSignOut,
      signInSocial: mockSignInSocial,
    },
    $context: Promise.resolve({ password: { hash: mockPasswordHash } }),
  },
}));

const mockSendResetPasswordCodeEmail = mock((_to?: string, _code?: string) =>
  Promise.resolve(),
);
mock.module("@/modules/mail/service", () => ({
  sendResetPasswordCodeEmail: mockSendResetPasswordCodeEmail,
}));

const { AuthService } = await import("../service");
const { BadRequestError, InternalServerError } = await import(
  "@/common/exceptions"
);

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

beforeEach(() => {
  mockSelect.mockReset();
  mockInsertValues.mockClear();
  mockInsert.mockClear();
  mockUpdateReturning.mockReset();
  mockUpdateReturning.mockResolvedValue([{ id: 1 }]);
  mockUpdateWhere.mockClear();
  mockUpdateSet.mockClear();
  mockUpdate.mockClear();
  mockDeleteWhere.mockClear();
  mockDelete.mockClear();
  mockSignUpEmail.mockReset();
  mockSignInUsername.mockReset();
  mockSignOut.mockReset();
  mockSignInSocial.mockReset();
  mockPasswordHash.mockClear();
  mockSendResetPasswordCodeEmail.mockClear();
});

afterAll(() => {
  mock.restore();
});

const REGISTER_DATA = {
  fname: "สมชาย",
  lname: "ใจดี",
  phoneNumber: "0812345678",
  email: "student1@example.com",
  password: "password123",
  gender: "MALE" as const,
  institutionId: 1,
};

describe("AuthService.registerIntern", () => {
  it("throws InternalServerError เมื่อ better-auth ไม่คืน user มา", async () => {
    const service = new AuthService();
    mockSignUpEmail.mockResolvedValueOnce({ user: null });

    expect(
      service.registerIntern(REGISTER_DATA),
    ).rejects.toBeInstanceOf(InternalServerError);
  });

  it("สมัครสำเร็จ: สร้าง studentProfile ด้วยข้อมูลที่ถูกต้อง", async () => {
    const service = new AuthService();
    mockSignUpEmail.mockResolvedValueOnce({ user: { id: "user-1" } });

    const result = await service.registerIntern(REGISTER_DATA);

    expect(result).toEqual({ success: true, message: "Intern registration successful" });
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      userId: "user-1",
      institutionId: 1,
      internshipStatus: "IDLE",
      isActive: true,
    });
  });

  it("rollback: ลบ user ที่สร้างไปแล้วเมื่อสร้าง studentProfile ไม่สำเร็จ แล้ว throw BadRequestError", async () => {
    const service = new AuthService();
    mockSignUpEmail.mockResolvedValueOnce({ user: { id: "user-1" } });
    mockInsertValues.mockImplementationOnce(() => Promise.reject(new Error("db error")));

    await expect(
      service.registerIntern(REGISTER_DATA),
    ).rejects.toBeInstanceOf(BadRequestError);

    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it("rollback: ยังคง throw BadRequestError แม้การลบ user ตอน rollback ก็ล้มเหลวด้วย", async () => {
    const service = new AuthService();
    mockSignUpEmail.mockResolvedValueOnce({ user: { id: "user-1" } });
    mockInsertValues.mockImplementationOnce(() => Promise.reject(new Error("db error")));
    mockDeleteWhere.mockImplementationOnce(() => Promise.reject(new Error("rollback failed")));

    await expect(
      service.registerIntern(REGISTER_DATA),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe("AuthService.login", () => {
  it("throws InternalServerError เมื่อไม่มี response จาก auth provider เลย", async () => {
    const service = new AuthService();
    mockSignInUsername.mockResolvedValueOnce(null);

    expect(
      service.login({ phoneNumber: "0812345678", password: "password123" }),
    ).rejects.toBeInstanceOf(InternalServerError);
  });

  it("throws BadRequestError เมื่อ response.ok เป็น false", async () => {
    const service = new AuthService();
    mockSignInUsername.mockResolvedValueOnce(new Response(null, { status: 401 }));

    expect(
      service.login({ phoneNumber: "0812345678", password: "wrong" }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("ล็อกอินสำเร็จคืน response ตรงๆ", async () => {
    const service = new AuthService();
    const res = new Response("{}", { status: 200 });
    mockSignInUsername.mockResolvedValueOnce(res);

    const result = await service.login({ phoneNumber: "0812345678", password: "password123" });

    expect(result).toBe(res);
  });
});

describe("AuthService.login_itt", () => {
  it("throws BadRequestError เมื่อ response ไม่ ok", async () => {
    const service = new AuthService();
    mockSignInUsername.mockResolvedValueOnce(new Response(null, { status: 401 }));

    expect(
      service.login_itt({ phoneNumber: "0812345678", password: "wrong" }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("ล็อกอินสำเร็จคืน response แม้ internshipStatus จะไม่ใช่ ACTIVE (เงื่อนไขเช็คถูกคอมเมนต์ปิดไว้)", async () => {
    const service = new AuthService();
    const res = new Response(JSON.stringify({ user: { id: "student-1" } }), { status: 200 });
    mockSignInUsername.mockResolvedValueOnce(res);
    mockSelect.mockReturnValueOnce(makeChainable([{ internshipStatus: "IDLE" }]));

    const result = await service.login_itt({ phoneNumber: "0812345678", password: "password123" });

    // clone() ถูกเรียกในโค้ดจริง (response.clone().json()) จึงเทียบ status แทนการเทียบ object ตรงๆ
    expect(result.status).toBe(200);
  });
});

describe("AuthService.logout", () => {
  it("ลบ FCM token ทั้งหมดของผู้ใช้และคืน response จาก signOut", async () => {
    const service = new AuthService();
    const res = new Response("{}", { status: 200 });
    mockSignOut.mockResolvedValueOnce(res);

    const result = await service.logout(new Headers(), "user-1");

    expect(result).toBe(res);
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it("ยังคง logout สำเร็จแม้การลบ FCM token จะล้มเหลว", async () => {
    const service = new AuthService();
    const res = new Response("{}", { status: 200 });
    mockSignOut.mockResolvedValueOnce(res);
    mockDeleteWhere.mockImplementationOnce(() => Promise.reject(new Error("db down")));

    const result = await service.logout(new Headers(), "user-1");

    expect(result).toBe(res);
  });
});

describe("AuthService.requestResetPassword", () => {
  it("throws BadRequestError เมื่อไม่พบบัญชีที่ตรงกับเบอร์โทร+อีเมล", async () => {
    const service = new AuthService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.requestResetPassword({ phoneNumber: "0812345678", email: "a@b.com" }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("throws BadRequestError เมื่อบัญชีไม่มีอีเมล", async () => {
    const service = new AuthService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1", email: null }]));

    expect(
      service.requestResetPassword({ phoneNumber: "0812345678", email: "a@b.com" }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("ส่งคำขอสำเร็จ: ยกเลิกโทเคนเก่าทั้งหมด สร้างโทเคนใหม่ และส่งอีเมล", async () => {
    const service = new AuthService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: "user-1", email: "student1@example.com" }]),
    );

    const result = await service.requestResetPassword({
      phoneNumber: "0812345678",
      email: "student1@example.com",
    });

    expect(result.success).toBe(true);
    expect(mockUpdateSet.mock.calls[0][0]).toEqual({ used: true }); // เคลียร์โทเคนเก่า
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({ userId: "user-1", used: false });
    expect(mockSendResetPasswordCodeEmail).toHaveBeenCalledTimes(1);
    expect(mockSendResetPasswordCodeEmail.mock.calls[0][0]).toBe("student1@example.com");
  });
});

describe("AuthService.verifyResetCode", () => {
  it("throws BadRequestError เมื่อไม่พบบัญชี", async () => {
    const service = new AuthService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.verifyResetCode({ phoneNumber: "0812345678", email: "a@b.com", code: "123456" }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("throws BadRequestError เมื่อไม่พบโทเคนที่ยังไม่ถูกใช้", async () => {
    const service = new AuthService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.verifyResetCode({ phoneNumber: "0812345678", email: "a@b.com", code: "123456" }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("throws BadRequestError และตั้งค่า used=true เมื่อโทเคนหมดอายุแล้ว", async () => {
    const service = new AuthService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 99, expiresAt: new Date(Date.now() - 1000), tokenHash: "x" }]),
    );

    await expect(
      service.verifyResetCode({ phoneNumber: "0812345678", email: "a@b.com", code: "123456" }),
    ).rejects.toBeInstanceOf(BadRequestError);

    expect(mockUpdateSet.mock.calls[0][0]).toEqual({ used: true });
  });

  it("throws BadRequestError เมื่อรหัสยืนยันไม่ตรงกับ hash ที่บันทึกไว้", async () => {
    const service = new AuthService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 99, expiresAt: new Date(Date.now() + 60000), tokenHash: sha256("999999") }]),
    );

    expect(
      service.verifyResetCode({ phoneNumber: "0812345678", email: "a@b.com", code: "123456" }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("ยืนยันรหัสสำเร็จ: ปิดโทเคน OTP เดิม และออก resetToken ใหม่ให้", async () => {
    const service = new AuthService();
    mockSelect.mockReturnValueOnce(makeChainable([{ id: "user-1" }]));
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 99, expiresAt: new Date(Date.now() + 60000), tokenHash: sha256("123456") }]),
    );

    const result = await service.verifyResetCode({
      phoneNumber: "0812345678",
      email: "a@b.com",
      code: "123456",
    });

    expect(result.success).toBe(true);
    expect(typeof result.resetToken).toBe("string");
    expect(result.resetToken.length).toBeGreaterThan(0);
    expect(mockUpdateSet.mock.calls[0][0]).toEqual({ used: true }); // ปิดโทเคน OTP เดิม
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({ userId: "user-1", used: false });
  });
});

describe("AuthService.resetPassword", () => {
  it("throws BadRequestError เมื่อรหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน", async () => {
    const service = new AuthService();

    expect(
      service.resetPassword({
        resetToken: "abc",
        password: "password123",
        confirmPassword: "different",
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("throws BadRequestError เมื่อไม่พบ reset token", async () => {
    const service = new AuthService();
    mockSelect.mockReturnValueOnce(makeChainable([]));

    expect(
      service.resetPassword({
        resetToken: "abc",
        password: "password123",
        confirmPassword: "password123",
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("throws BadRequestError และปิดโทเคนเมื่อหมดอายุแล้ว", async () => {
    const service = new AuthService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 1, userId: "user-1", expiresAt: new Date(Date.now() - 1000) }]),
    );

    await expect(
      service.resetPassword({
        resetToken: "abc",
        password: "password123",
        confirmPassword: "password123",
      }),
    ).rejects.toBeInstanceOf(BadRequestError);

    expect(mockUpdateSet.mock.calls[0][0]).toEqual({ used: true });
  });

  it("throws BadRequestError เมื่อไม่พบบัญชี credential ให้เปลี่ยนรหัสผ่าน", async () => {
    const service = new AuthService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 1, userId: "user-1", expiresAt: new Date(Date.now() + 60000) }]),
    );
    mockUpdateReturning.mockResolvedValueOnce([]); // ไม่พบ account credential

    expect(
      service.resetPassword({
        resetToken: "abc",
        password: "password123",
        confirmPassword: "password123",
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("เปลี่ยนรหัสผ่านสำเร็จ: hash รหัสผ่านใหม่ผ่าน better-auth และปิดโทเคน", async () => {
    const service = new AuthService();
    mockSelect.mockReturnValueOnce(
      makeChainable([{ id: 1, userId: "user-1", expiresAt: new Date(Date.now() + 60000) }]),
    );
    mockUpdateReturning.mockResolvedValueOnce([{ id: 5 }]);

    const result = await service.resetPassword({
      resetToken: "abc",
      password: "newpassword123",
      confirmPassword: "newpassword123",
    });

    expect(result).toEqual({ success: true, message: "เปลี่ยนรหัสผ่านสำเร็จ" });
    expect(mockPasswordHash).toHaveBeenCalledWith("newpassword123");
    // update ครั้งที่ 2 = ปิดโทเคน (ครั้งที่ 1 คือ update accounts.password)
    expect(mockUpdateSet.mock.calls[1][0]).toEqual({ used: true });
  });
});

describe("AuthService.loginWithKeycloak / loginWithKeycloakiTT", () => {
  it("loginWithKeycloak เรียก signInSocial ด้วย provider=keycloak และใช้ callbackURL จาก env ถ้ามี", async () => {
    const service = new AuthService();
    process.env.KEYCLOAK_CALLBACK_URL = "https://custom.example.com/callback";
    mockSignInSocial.mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await service.loginWithKeycloak(new Headers());

    expect(mockSignInSocial).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          provider: "keycloak",
          callbackURL: "https://custom.example.com/callback",
        }),
      }),
    );
    delete process.env.KEYCLOAK_CALLBACK_URL;
  });

  it("loginWithKeycloak ใช้ callbackURL ค่า default เมื่อไม่ได้ตั้ง env ไว้", async () => {
    const service = new AuthService();
    delete process.env.KEYCLOAK_CALLBACK_URL;
    mockSignInSocial.mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await service.loginWithKeycloak(new Headers());

    expect(mockSignInSocial).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          callbackURL: "http://localhost:2700/login/owner/callback",
        }),
      }),
    );
  });

  it("loginWithKeycloakiTT เรียก signInSocial ด้วย provider=keycloak และ callbackURL จาก env เฉพาะของ iTT", async () => {
    const service = new AuthService();
    process.env.iTT_KEYCLOAK_CALLBACK_URL = "https://itt.example.com/callback";
    mockSignInSocial.mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await service.loginWithKeycloakiTT(new Headers());

    expect(mockSignInSocial).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          provider: "keycloak",
          callbackURL: "https://itt.example.com/callback",
        }),
      }),
    );
    delete process.env.iTT_KEYCLOAK_CALLBACK_URL;
  });
});
