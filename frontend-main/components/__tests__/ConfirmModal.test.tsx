import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

// ---------------------------------------------------------------------------
// ConfirmModal เป็น "presentational component" ล้วน ๆ
//   - ไม่มี state ภายในตัวเอง
//   - ไม่มี API call, ไม่มี useEffect
//   - แค่รับ props เข้ามา แล้ว render ตามนั้น + เรียก callback ที่ parent ส่งมาให้ตอนคลิก
// เพราะแบบนี้ ไฟล์เทสจึงไม่ต้อง mock อะไรเลย (ไม่ต้อง mock API, ไม่ต้อง mock next/navigation)
// แค่ render แล้วเช็ค DOM + เช็คว่าฟังก์ชันถูกเรียกตอนคลิกถูกจุดไหม ก็เพียงพอ
// ---------------------------------------------------------------------------

import ConfirmModal from "../ui/ConfirmModal"; // แก้ path ให้ตรงกับตำแหน่งไฟล์จริงของคุณ

describe("ConfirmModal", () => {
  it("ไม่ render อะไรเลยเมื่อ isOpen={false}", () => {
    const { container } = render(
      <ConfirmModal
        isOpen={false}
        title="ยืนยันการลบ"
        message="คุณแน่ใจหรือไม่"
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    // component เขียนไว้ว่า `if (!isOpen) return null;`
    // ดังนั้นต้องไม่มี element ใด ๆ ถูก render ออกมาเลย
    expect(container).toBeEmptyDOMElement();
  });

  it("แสดง title และ message ที่ส่งเข้ามาเมื่อ isOpen={true}", () => {
    render(
      <ConfirmModal
        isOpen={true}
        title="ยืนยันการลบ"
        message="คุณแน่ใจหรือไม่ว่าต้องการลบรายการนี้"
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    expect(screen.getByText("ยืนยันการลบ")).toBeInTheDocument();
    expect(
      screen.getByText("คุณแน่ใจหรือไม่ว่าต้องการลบรายการนี้"),
    ).toBeInTheDocument();
  });

  it("ใช้ข้อความปุ่มค่าเริ่มต้น ('ยืนยัน' / 'ยกเลิก') เมื่อไม่ได้ส่ง confirmText/cancelText มา", () => {
    render(
      <ConfirmModal
        isOpen={true}
        title="ยืนยันการลบ"
        message="ข้อความ"
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "ยืนยัน" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ยกเลิก" }),
    ).toBeInTheDocument();
  });

  it("ใช้ข้อความปุ่มที่กำหนดเอง เมื่อส่ง confirmText/cancelText เข้ามา", () => {
    render(
      <ConfirmModal
        isOpen={true}
        title="ยืนยันการลบทั้งหมด"
        message="ข้อความ"
        confirmText="Clear all"
        cancelText="ปิด"
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Clear all" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ปิด" })).toBeInTheDocument();
    // ต้องไม่มีปุ่มข้อความ default หลงเหลืออยู่
    expect(
      screen.queryByRole("button", { name: "ยืนยัน" }),
    ).not.toBeInTheDocument();
  });

  it("เรียก onConfirm เมื่อกดปุ่มยืนยัน", async () => {
    const user = userEvent.setup();
    const onConfirm = jest.fn();
    const onCancel = jest.fn();

    render(
      <ConfirmModal
        isOpen={true}
        title="ยืนยันการลบ"
        message="ข้อความ"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole("button", { name: "ยืนยัน" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("เรียก onCancel เมื่อกดปุ่มยกเลิก", async () => {
    const user = userEvent.setup();
    const onConfirm = jest.fn();
    const onCancel = jest.fn();

    render(
      <ConfirmModal
        isOpen={true}
        title="ยืนยันการลบ"
        message="ข้อความ"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole("button", { name: "ยกเลิก" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("เรียก onCancel เมื่อคลิกที่พื้นหลังสีดำ (backdrop)", async () => {
    const user = userEvent.setup();
    const onConfirm = jest.fn();
    const onCancel = jest.fn();

    const { container } = render(
      <ConfirmModal
        isOpen={true}
        title="ยืนยันการลบ"
        message="ข้อความ"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    // backdrop คือ <div> ที่มีคลาส bg-black/50 ตามโค้ดจริง
    // เพราะไม่มี role/text ให้จับ เราจึงหาไว้ผ่าน CSS selector ตรง ๆ
    const backdrop = container.querySelector(".bg-black\\/50");
    expect(backdrop).not.toBeNull();

    await user.click(backdrop as Element);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("คลิกที่กล่องข้อความเนื้อหา (ไม่ใช่ backdrop) ต้องไม่เรียก onCancel", async () => {
    const user = userEvent.setup();
    const onConfirm = jest.fn();
    const onCancel = jest.fn();

    render(
      <ConfirmModal
        isOpen={true}
        title="ยืนยันการลบ"
        message="ข้อความสำคัญ"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    // คลิกที่ตัวข้อความ message ซึ่งอยู่ "ข้างใน" กล่อง ไม่ใช่ backdrop
    await user.click(screen.getByText("ข้อความสำคัญ"));

    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
