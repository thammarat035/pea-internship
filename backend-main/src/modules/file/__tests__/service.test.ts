import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

const mockS3Send = mock();
mock.module("@/lib/s3", () => ({
  s3Client: { send: mockS3Send },
  BUCKET_NAME: "test-bucket",
}));

const { FileService } = await import("../service");
const { NotFoundError } = await import("elysia");

beforeEach(() => {
  mockS3Send.mockReset();
});

afterAll(() => {
  mock.restore();
});

describe("FileService.getFile", () => {
  it("คืน buffer และ contentType จาก MinIO", async () => {
    const service = new FileService();
    mockS3Send.mockResolvedValueOnce({
      Body: { transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3])) },
      ContentType: "application/pdf",
    });

    const result = await service.getFile("some/key.pdf");

    expect(result.contentType).toBe("application/pdf");
    expect(Array.from(result.buffer as Uint8Array)).toEqual([1, 2, 3]);
  });

  it("ใช้ 'application/octet-stream' เป็นค่า default เมื่อไม่มี ContentType", async () => {
    const service = new FileService();
    mockS3Send.mockResolvedValueOnce({
      Body: { transformToByteArray: () => Promise.resolve(new Uint8Array([])) },
      ContentType: undefined,
    });

    const result = await service.getFile("some/key");

    expect(result.contentType).toBe("application/octet-stream");
  });

  it("throws NotFoundError เมื่อดึงไฟล์จาก MinIO ไม่สำเร็จ", async () => {
    const service = new FileService();
    mockS3Send.mockRejectedValueOnce(new Error("not found"));

    expect(service.getFile("missing/key.pdf")).rejects.toBeInstanceOf(NotFoundError);
  });
});
