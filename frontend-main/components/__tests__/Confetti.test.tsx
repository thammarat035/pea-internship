import React from "react";
import { render, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";

// ---------------------------------------------------------------------------
// ทำไมไฟล์นี้ต้อง mock เยอะกว่า AdminNavbar?
// เพราะ Confetti ใช้ของที่ "jsdom" (สภาพแวดล้อมจำลอง browser ของ Jest) ไม่รองรับจริง ๆ:
//   1) Canvas 2D API (ctx.fillRect, ctx.arc, ...) -> jsdom ไม่ได้วาดภาพจริง ต้องปลอมเอง
//   2) requestAnimationFrame / cancelAnimationFrame -> เราต้อง "คุม" การเรียกเอง
//      ไม่งั้น animate() จะวนเรียกตัวเองไม่รู้จบในเทส (เพราะไม่มีจริงๆ ว่าเวลาผ่านไปเท่าไหร่)
// ---------------------------------------------------------------------------

import Confetti from "../ui/Confetti"; // แก้ path ให้ตรงกับตำแหน่งไฟล์จริงของคุณ

// -----------------------------
// 1) ปลอม Canvas 2D Context
// -----------------------------
// getContext("2d") ปกติคืน object ที่มีเมธอดวาดรูปมากมาย เราปลอมแค่ตัวที่ component เรียกใช้จริง
function createFakeCtx() {
  return {
    clearRect: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    translate: jest.fn(),
    rotate: jest.fn(),
    beginPath: jest.fn(),
    arc: jest.fn(),
    fill: jest.fn(),
    fillRect: jest.fn(),
    fillStyle: "",
    globalAlpha: 1,
  };
}

let fakeCtx: ReturnType<typeof createFakeCtx>;

beforeEach(() => {
  fakeCtx = createFakeCtx();

  // แทนที่เมธอด getContext ของ <canvas> ทุกตัวในหน้าเทสด้วยของปลอมข้างบน
  HTMLCanvasElement.prototype.getContext = jest.fn(() => fakeCtx) as any;

  // -----------------------------
  // 2) ปลอม requestAnimationFrame / cancelAnimationFrame
  // -----------------------------
  // เราไม่ auto-เรียก callback ให้ (ปล่อยว่างไว้) เพื่อไม่ให้ animate() วนเรียกตัวเองไม่หยุด
  // แค่ต้องการเช็คว่า "ถูกเรียก" และ "ถูกยกเลิกตอน unmount" ก็พอสำหรับ unit test ระดับนี้
  window.requestAnimationFrame = jest.fn(() => 1) as any;
  window.cancelAnimationFrame = jest.fn();

  // performance.now ต้องมีไว้เพราะ component เรียกใช้ตอนเริ่ม animate
  jest.spyOn(performance, "now").mockReturnValue(0);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("Confetti", () => {
  it("ไม่ render canvas เลยเมื่อ isActive={false}", () => {
    const { container } = render(<Confetti isActive={false} />);

    // component เขียนไว้ว่า `if (!isActive) return null;`
    // ดังนั้นใน DOM ต้องไม่มี <canvas> โผล่มาเลย
    expect(container.querySelector("canvas")).not.toBeInTheDocument();
  });

  it("render <canvas> เต็มจอเมื่อ isActive={true}", () => {
    const { container } = render(<Confetti isActive={true} />);

    const canvas = container.querySelector("canvas");
    expect(canvas).toBeInTheDocument();
    expect(canvas).toHaveClass("fixed", "inset-0", "pointer-events-none");
    expect(canvas).toHaveStyle({ zIndex: "100" });
  });

  it("เรียก canvas.getContext('2d') เพื่อเริ่มวาดตอน mount", () => {
    render(<Confetti isActive={true} />);

    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith("2d");
  });

  it("ตั้งขนาด canvas ให้เท่ากับขนาดหน้าจอตอนเริ่มทำงาน", () => {
    // จำลองขนาดหน้าจอ
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      value: 1024,
    });
    Object.defineProperty(window, "innerHeight", {
      writable: true,
      value: 768,
    });

    const { container } = render(<Confetti isActive={true} />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;

    expect(canvas.width).toBe(1024);
    expect(canvas.height).toBe(768);
  });

  it("เริ่ม animation loop ด้วย requestAnimationFrame", () => {
    render(<Confetti isActive={true} />);

    // อย่างน้อยต้องถูกเรียก 1 ครั้งตอนเริ่ม (เฟรมแรก)
    expect(window.requestAnimationFrame).toHaveBeenCalled();
  });

  it("ผูก event listener 'resize' ไว้กับ window ตอน active", () => {
    const addSpy = jest.spyOn(window, "addEventListener");
    render(<Confetti isActive={true} />);

    expect(addSpy).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("เคลียร์ animation frame และ resize listener ตอน unmount", () => {
    const removeSpy = jest.spyOn(window, "removeEventListener");
    const { unmount } = render(<Confetti isActive={true} />);

    unmount();

    expect(window.cancelAnimationFrame).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("ไม่เรียก getContext ซ้ำโดยไม่จำเป็นเมื่อ isActive ไม่เปลี่ยนค่า (re-render ปกติ)", () => {
    const { rerender } = render(<Confetti isActive={true} duration={4000} />);
    const callsAfterFirstRender = (
      HTMLCanvasElement.prototype.getContext as jest.Mock
    ).mock.calls.length;

    // re-render ด้วย props เดิมทุกอย่าง ไม่ควรทำให้ effect ทำงานใหม่
    // (useEffect ใน component ผูกกับ [isActive, duration] เท่านั้น)
    rerender(<Confetti isActive={true} duration={4000} />);

    expect(
      (HTMLCanvasElement.prototype.getContext as jest.Mock).mock.calls.length,
    ).toBe(callsAfterFirstRender);
  });

  it("เมื่อ isActive เปลี่ยนจาก true เป็น false จะเอา canvas ออกจาก DOM และยกเลิก animation", () => {
    const { container, rerender } = render(<Confetti isActive={true} />);
    expect(container.querySelector("canvas")).toBeInTheDocument();

    rerender(<Confetti isActive={false} />);

    expect(container.querySelector("canvas")).not.toBeInTheDocument();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });

  it("ยอมรับค่า duration ที่กำหนดเอง โดยไม่ทำให้ component พัง", () => {
    const { container } = render(<Confetti isActive={true} duration={1000} />);
    expect(container.querySelector("canvas")).toBeInTheDocument();
  });
});
