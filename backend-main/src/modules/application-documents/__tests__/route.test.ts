import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

// ---------------------------------------------------------------------------
// เทส route ทั้ง 2 endpoint ของ application-documents โดย mock service ทั้งคลาส
// จุดสังเกต: endpoint "/" ใช้ macro "role: [1]" (เฉพาะ admin) แต่ endpoint
// "/file" ใช้ "auth: true" (ผู้ใช้ล็อกอินแล้วคนไหนก็ได้ - ตัว service เองเป็น
// คนเช็คสิทธิ์เข้าถึงไฟล์แต่ละไฟล์เอง ไม่ใช่ระดับ route)
// ---------------------------------------------------------------------------

const mockFindAllDocuments = mock();
const mockStreamDocument = mock();

mock.module("../service", () => ({
  ApplicationDocumentsService: class {
    findAllDocuments = mockFindAllDocuments;
    streamDocument = mockStreamDocument;
  },
}));

const FAKE_USER = { id: "fake-user-id", roleId: 1 };
const FAKE_SESSION = { id: "fake-session-id", userId: FAKE_USER.id };

mock.module("@/middlewares/auth.middleware", () => ({
  isAuthenticated: new Elysia({ name: "better-auth" }).macro({
    auth: {
      resolve: () => ({ user: FAKE_USER, session: FAKE_SESSION }),
    },
    role: () => ({
      resolve: () => ({ user: FAKE_USER, session: FAKE_SESSION }),
    }),
  }),
}));

const { ApplicationDocuments } = await import("../index");

describe("application-documents routes", () => {
  beforeEach(() => {
    mockFindAllDocuments.mockReset();
    mockStreamDocument.mockReset();
  });

  describe("GET /application-documents/", () => {
    it("เรียก service.findAllDocuments ด้วย session.userId และ query คืน status 200", async () => {
      mockFindAllDocuments.mockResolvedValue([]);

      const response = await ApplicationDocuments.handle(
        new Request(
          "http://localhost/application-documents/?docTypeId=1&validationStatus=PENDING",
        ),
      );

      expect(response.status).toBe(200);
      expect(mockFindAllDocuments).toHaveBeenCalledWith(
        FAKE_SESSION.userId,
        expect.objectContaining({ docTypeId: 1, validationStatus: "PENDING" }),
      );
    });
  });

  describe("GET /application-documents/file", () => {
    it("เรียก service.streamDocument ด้วย session.userId และ key แล้วตั้ง header จากผลลัพธ์", async () => {
      const fakeStream = new ReadableStream();
      mockStreamDocument.mockResolvedValue({
        body: fakeStream,
        contentType: "application/pdf",
        filename: "test.pdf",
        contentDisposition: 'inline; filename="test.pdf"',
      });

      const response = await ApplicationDocuments.handle(
        new Request(
          "http://localhost/application-documents/file?key=applications/10/1/test.pdf",
        ),
      );

      expect(response.status).toBe(200);
      expect(mockStreamDocument).toHaveBeenCalledWith(
        FAKE_SESSION.userId,
        "applications/10/1/test.pdf",
      );
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(response.headers.get("content-disposition")).toBe(
        'inline; filename="test.pdf"',
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
    });

    it("ตอบ 422 เมื่อไม่ส่ง key มา (validation)", async () => {
      const response = await ApplicationDocuments.handle(
        new Request("http://localhost/application-documents/file"),
      );

      expect(response.status).not.toBe(200);
      expect(mockStreamDocument).not.toHaveBeenCalled();
    });
  });
});

afterAll(() => {
  mock.restore();
});
