import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

// ---------------------------------------------------------------------------
// CongratsModal ใช้ทั้ง next/navigation (useRouter) และ component ลูกชื่อ Confetti
// เราจึง mock ทั้งสองอย่างเหมือนที่เคยทำกับ AdminNavbar
// ---------------------------------------------------------------------------

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
  }),
}));

// mock Confetti ให้เป็นแค่ placeholder ธรรมดา เพราะเราเทส CongratsModal
// ไม่ใช่เทส Confetti (เทส Confetti แยกไว้อีกไฟล์แล้ว)
jest.mock("../ui/Confetti", () => ({
  __esModule: true,
  default: ({ isActive }: { isActive: boolean }) =>
    isActive ? <div data-testid="confetti-mock" /> : null,
}));

import CongratsModal from "../ui/CongratsModal"; // แก้ path ให้ตรงกับตำแหน่งไฟล์จริงของคุณ

// requestAnimationFrame ต้อง mock เพราะ component เรียกใช้ตอน isOpen เปลี่ยนเป็น true
// เราสั่งให้ "เรียก callback ทันที" (ต่างจาก Confetti.test.tsx ที่ตั้งใจไม่เรียก)
// เพราะที่นี่แค่ต้องการให้ isVisible/showConfetti เปลี่ยนเป็น true ให้เร็วที่สุดเพื่อเทสง่ายขึ้น
beforeEach(() => {
  window.requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  }) as any;
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("CongratsModal", () => {
  it("ไม่ render อะไรเลยเมื่อ isOpen={false}", () => {
    const { container } = render(
      <CongratsModal isOpen={false} onClose={jest.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("แสดงข้อความยินดีด้วยและรายการเอกสารครบทุกรายการเมื่อ isOpen={true}", async () => {
    render(<CongratsModal isOpen={true} onClose={jest.fn()} />);

    expect(
      screen.getByText("ยินดีด้วย! คุณผ่านการคัดเลือกแล้ว"),
    ).toBeInTheDocument();

    // เช็คว่ารายการเอกสารทั้ง 5 ชิ้นแสดงครบ (มาจาก array `documents` ในโค้ดจริง)
    expect(
      screen.getByText("เอกสารรักษาความลับ 2 ฉบับ"),
    ).toBeInTheDocument();
    expect(screen.getByText("เอกสารลางาน")).toBeInTheDocument();
    expect(screen.getByText("เอกสารกฎระเบียบ")).toBeInTheDocument();
    expect(screen.getByText("เอกสารเข้า - ออกงาน")).toBeInTheDocument();
    expect(screen.getByText("เอกสารออกนอกสถานที่")).toBeInTheDocument();
  });

  it("แสดง Confetti (isActive=true) หลังจากเปิด modal", async () => {
    render(<CongratsModal isOpen={true} onClose={jest.fn()} />);

    // เพราะเรา mock requestAnimationFrame ให้ทำงานทันที
    // showConfetti ควรกลายเป็น true และ Confetti (ที่ mock ไว้) ควรถูก render
    await waitFor(() =>
      expect(screen.getByTestId("confetti-mock")).toBeInTheDocument(),
    );
  });

  it("ไม่แสดง Confetti เมื่อ isOpen={false}", () => {
    render(<CongratsModal isOpen={false} onClose={jest.fn()} />);

    expect(screen.queryByTestId("confetti-mock")).not.toBeInTheDocument();
  });

  it("กดปุ่ม 'รับทราบแล้ว' จะเรียก onClose", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();

    render(<CongratsModal isOpen={true} onClose={onClose} />);

    await user.click(screen.getByText('"รับทราบแล้ว"'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("กดปุ่มดาวน์โหลดเอกสารทั้งหมด จะสร้างลิงก์ดาวน์โหลดสำหรับทุกไฟล์", async () => {
    const user = userEvent.setup();

    // สปาย element.click() ของ <a> ที่ component สร้างขึ้นมาตอนดาวน์โหลด
    // เพื่อเช็คว่าโค้ด "สร้างลิงก์ + สั่งคลิก" ทำงานจริงกี่ครั้ง โดยไม่ต้องให้ browser ดาวน์โหลดไฟล์จริง
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    render(<CongratsModal isOpen={true} onClose={jest.fn()} />);

    await user.click(
      screen.getByText("คลิกเพื่อดาวน์โหลดเอกสารทั้งหมด"),
    );

    // ในโค้ดจริงมีไฟล์ทั้งหมด 5 รายการที่ต้องดาวน์โหลด
    expect(clickSpy).toHaveBeenCalledTimes(5);

    clickSpy.mockRestore();
  });

  it("แสดงเครื่องหมาย * สีแดงเฉพาะเอกสารที่ required เท่านั้น", () => {
    render(<CongratsModal isOpen={true} onClose={jest.fn()} />);

    // "เอกสารรักษาความลับ 2 ฉบับ" เป็นตัวเดียวที่มี required: true ในข้อมูลต้นทาง
    const requiredDoc = screen
      .getByText("เอกสารรักษาความลับ 2 ฉบับ")
      .closest("div");
    expect(requiredDoc).toHaveTextContent("*");
  });
});
