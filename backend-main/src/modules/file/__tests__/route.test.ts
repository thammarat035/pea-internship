import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";

const mockGetFile = mock();

mock.module("../service", () => ({
  FileService: class {
    getFile = mockGetFile;
  },
}));

const FAKE_USER = { id: "fake-user-id", roleId: 3 };
const FAKE_SESSION = { id: "fake-session-id", userId: FAKE_USER.id };

mock.module("@/middlewares/auth.middleware", () => ({
  isAuthenticated: new Elysia({ name: "better-auth" }).macro({
    auth: { resolve: () => ({ user: FAKE_USER, session: FAKE_SESSION }) },
  }),
}));

const { file } = await import("../index");

describe("file routes", () => {
  beforeEach(() => {
    mockGetFile.mockReset();
  });

  it("GET /files/:key เรียก service.getFile ด้วย key ที่ decode แล้ว และตั้ง Content-Type จากผลลัพธ์", async () => {
    mockGetFile.mockResolvedValue({
      buffer: new Uint8Array([1, 2, 3]),
      contentType: "application/pdf",
    });

    const response = await file.handle(
      new Request(
        "http://localhost/files/applications%2F10%2F1%2Ftranscript.pdf",
      ),
    );

    expect(response.status).toBe(200);
    expect(mockGetFile).toHaveBeenCalledWith("applications/10/1/transcript.pdf");
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
  });
});

afterAll(() => {
  mock.restore();
});
