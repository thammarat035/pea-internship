import { describe, expect, it } from "bun:test";
import { Elysia, t } from "elysia";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "@/common/exceptions";
import { errorMiddleware } from "../error.middleware";

// ---------------------------------------------------------------------------
// เทส errorMiddleware แบบรันผ่าน Elysia app จริง (ไม่ใช่ดึง callback ออกมาเรียก
// ตรงๆ) เพราะ error code อย่าง VALIDATION/PARSE/NOT_FOUND มาจากพฤติกรรมภายใน
// ของ elysia เอง (validation ล้มเหลว, JSON parse ผิด, ไม่มี route ตรงกันเลย)
// การจำลอง object ปลอมขึ้นมาเองเสี่ยงจะไม่ตรงกับ shape จริงที่ elysia ส่งมา
// ยืนยันแล้วด้วยการรันจริงว่าทั้ง 3 code นี้เกิดขึ้นจริงตามที่คาดไว้
//
// จุดสำคัญ: middleware ตัวนี้เป็นจุดเดียวในระบบที่แปลง error ทุกชนิด (ทั้งที่
// service throw เอง และที่ elysia framework throw เอง) ให้กลายเป็น HTTP
// response รูปแบบเดียวกัน ({success, error, message}) — ทุกโมดูลที่เทสไปก่อน
// หน้านี้เทสแค่ "throw ประเภทถูกไหม" แต่ไม่เคยเทสว่า "แปลงเป็น HTTP response
// ถูกไหม" เลยสักที่ ไฟล์นี้จึงปิดช่องว่างนั้น
// ---------------------------------------------------------------------------

function buildApp() {
  return new Elysia()
    .use(errorMiddleware)
    .get("/app-error/not-found", () => {
      throw new NotFoundError("ไม่พบข้อมูล");
    })
    .get("/app-error/conflict", () => {
      throw new ConflictError("ข้อมูลซ้ำ");
    })
    .get("/app-error/bad-request", () => {
      throw new BadRequestError("คำขอไม่ถูกต้อง");
    })
    .get("/unexpected-error", () => {
      throw new Error("something exploded internally with a stack trace");
    })
    .post("/validated", ({ body }) => body, {
      body: t.Object({ name: t.String({ minLength: 1 }) }),
    });
}

describe("errorMiddleware", () => {
  it("แปลง AppError subclass (NotFoundError) เป็น response ตาม statusCode/errorKey ของมันเอง", async () => {
    const app = buildApp();

    const response = await app.handle(
      new Request("http://localhost/app-error/not-found"),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({
      success: false,
      error: "NOT_FOUND",
      message: "ไม่พบข้อมูล",
    });
  });

  it("แปลง ConflictError เป็น 409 และ BadRequestError เป็น 400 ถูกต้องตาม subclass ที่ throw", async () => {
    const app = buildApp();

    const conflictRes = await app.handle(
      new Request("http://localhost/app-error/conflict"),
    );
    expect(conflictRes.status).toBe(409);
    expect((await conflictRes.json()).error).toBe("CONFLICT");

    const badReqRes = await app.handle(
      new Request("http://localhost/app-error/bad-request"),
    );
    expect(badReqRes.status).toBe(400);
    expect((await badReqRes.json()).error).toBe("BAD_REQUEST");
  });

  it("แปลง route ที่ไม่มีอยู่จริง (NOT_FOUND จาก elysia เอง) เป็น response รูปแบบเดียวกัน", async () => {
    const app = buildApp();

    const response = await app.handle(
      new Request("http://localhost/this-route-does-not-exist"),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({
      success: false,
      error: "NOT_FOUND",
      message: "Route not found",
    });
  });

  it("แปลง JSON ที่ parse ไม่ได้ (PARSE) เป็น 400 BadRequestError", async () => {
    const app = buildApp();

    const response = await app.handle(
      new Request("http://localhost/validated", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{invalid json",
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({
      success: false,
      error: "BAD_REQUEST",
      message: "Invalid JSON format",
    });
  });

  it("แปลง validation ที่ elysia เช็คเอง (VALIDATION) เป็น 422 พร้อมแยก field/message ไว้ใน details", async () => {
    const app = buildApp();

    const response = await app.handle(
      new Request("http://localhost/validated", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}), // ขาด field "name" ที่บังคับ
      }),
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("VALIDATION_ERROR");
    expect(body.details).toEqual([
      expect.objectContaining({ field: "name" }),
    ]);
  });

  it("ตัด '/' นำหน้าออกจากชื่อ field ใน validation details (path -> field ที่อ่านง่าย)", async () => {
    const app = buildApp();

    const response = await app.handle(
      new Request("http://localhost/validated", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "" }), // ผ่าน type แต่ไม่ผ่าน minLength
      }),
    );

    const body = await response.json();
    // path จริงจาก TypeBox คือ "/name" -> ต้องถูกตัด "/" ออกเหลือ "name"
    expect(body.details[0].field).not.toContain("/");
  });

  it("คืน 500 InternalServerError แบบข้อความทั่วไป โดยไม่รั่วรายละเอียด error ดิบออกไปให้ client", async () => {
    const app = buildApp();

    const response = await app.handle(
      new Request("http://localhost/unexpected-error"),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("INTERNAL_SERVER_ERROR");
    expect(body.message).not.toContain("stack trace");
    expect(body.message).toBe("Something went wrong. Please try again later.");
  });
});
