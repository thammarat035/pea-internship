import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

// ---------------------------------------------------------------------------
// SearchSection ไม่เรียก API และไม่ใช้ next/navigation เลย จึงไม่ต้อง jest.mock อะไรทั้งนั้น
// จุดที่ต้องระวังเป็นพิเศษคือ:
//   1) มี useEffect ที่ "auto-search" ทุกครั้งที่ keyword หรือ selectedJobTypes เปลี่ยน
//      -> onSearch จะถูกเรียกเองอัตโนมัติแม้ไม่ได้กด Enter หรือปุ่มค้นหาใดๆ
//   2) มี useEffect ที่ทำงานตอน mount ครั้งแรกด้วย (เพราะ dependency [keyword, selectedJobTypes]
//      เปลี่ยนจาก "ไม่มีค่า" เป็นค่าเริ่มต้นตอน mount) จึงต้องคาดหวังว่า onSearch ถูกเรียก
//      อย่างน้อย 1 ครั้งตั้งแต่ render เสร็จ ก่อนที่ผู้ใช้จะพิมพ์อะไรเลยด้วยซ้ำ
// ---------------------------------------------------------------------------

import SearchSection from "../ui/SearchSection"; // แก้ path ให้ตรงกับตำแหน่งไฟล์จริงของคุณ

const jobTypeOptions = [
  { value: "it", label: "เทคโนโลยีสารสนเทศ" },
  { value: "hr", label: "ทรัพยากรบุคคล" },
  { value: "acc", label: "บัญชี" },
];

describe("SearchSection", () => {
  it("render ช่องค้นหาและปุ่มเลือกสาขาวิชา", () => {
    render(<SearchSection jobTypeOptions={jobTypeOptions} />);

    expect(
      screen.getByPlaceholderText("ค้นหาตำแหน่ง..."),
    ).toBeInTheDocument();
    expect(screen.getByText("สาขาวิชาทั้งหมด")).toBeInTheDocument();
  });

  it("เรียก onSearch อัตโนมัติตอน mount ด้วยค่าเริ่มต้น (keyword ว่าง, ยังไม่เลือกสาขา)", async () => {
    const onSearch = jest.fn();
    render(<SearchSection onSearch={onSearch} jobTypeOptions={jobTypeOptions} />);

    await waitFor(() => expect(onSearch).toHaveBeenCalledWith("", []));
  });

  it("พิมพ์ในช่องค้นหาแล้วเรียก onSearch อัตโนมัติด้วยคำที่พิมพ์ (auto-search)", async () => {
    const user = userEvent.setup();
    const onSearch = jest.fn();

    render(<SearchSection onSearch={onSearch} jobTypeOptions={jobTypeOptions} />);
    onSearch.mockClear(); // ล้างการเรียกตอน mount ออกก่อน จะได้เช็คเฉพาะที่เกิดจากการพิมพ์

    const input = screen.getByPlaceholderText("ค้นหาตำแหน่ง...");
    await user.type(input, "นักพัฒนา");

    await waitFor(() =>
      expect(onSearch).toHaveBeenLastCalledWith("นักพัฒนา", []),
    );
  });

  it("กด Enter ในช่องค้นหาจะเรียก onSearch ด้วย (เผื่อกรณีอยากค้นหาทันทีโดยไม่รอ auto-search)", async () => {
    const user = userEvent.setup();
    const onSearch = jest.fn();

    render(<SearchSection onSearch={onSearch} jobTypeOptions={jobTypeOptions} />);

    const input = screen.getByPlaceholderText("ค้นหาตำแหน่ง...");
    await user.type(input, "ครู{Enter}");

    expect(onSearch).toHaveBeenLastCalledWith("ครู", []);
  });

  it("คลิกปุ่มสาขาวิชาแล้วเปิด dropdown แสดงตัวเลือกครบทุกสาขา", async () => {
    const user = userEvent.setup();
    render(<SearchSection jobTypeOptions={jobTypeOptions} />);

    await user.click(screen.getByText("สาขาวิชาทั้งหมด"));

    expect(screen.getByText("เทคโนโลยีสารสนเทศ")).toBeInTheDocument();
    expect(screen.getByText("ทรัพยากรบุคคล")).toBeInTheDocument();
    expect(screen.getByText("บัญชี")).toBeInTheDocument();
  });

  it("แสดงข้อความ 'ไม่พบข้อมูลสาขาวิชา' เมื่อไม่มี jobTypeOptions ส่งเข้ามาเลย", async () => {
    const user = userEvent.setup();
    render(<SearchSection jobTypeOptions={[]} />);

    await user.click(screen.getByText("สาขาวิชาทั้งหมด"));

    expect(screen.getByText("ไม่พบข้อมูลสาขาวิชา")).toBeInTheDocument();
  });

  it("เลือกสาขาวิชา 1 อันแล้วป้ายชื่อปุ่มเปลี่ยนเป็นชื่อสาขานั้น และเรียก onSearch", async () => {
    const user = userEvent.setup();
    const onSearch = jest.fn();

    render(<SearchSection onSearch={onSearch} jobTypeOptions={jobTypeOptions} />);

    const jobTypeButton = screen.getByRole("button");
    await user.click(jobTypeButton);
    await user.click(screen.getByLabelText("เทคโนโลยีสารสนเทศ"));

    // เช็คเฉพาะข้อความ "ข้างใน" ปุ่ม ไม่ไปปนกับตัวเลือกใน dropdown ที่ยังเปิดค้างอยู่
    expect(within(jobTypeButton).getByText("เทคโนโลยีสารสนเทศ")).toBeInTheDocument();
    await waitFor(() =>
      expect(onSearch).toHaveBeenLastCalledWith("", ["it"]),
    );
  });

  it("เลือกสาขาวิชามากกว่า 1 อัน ป้ายชื่อปุ่มต้องขึ้นว่า 'เลือก N สาขา'", async () => {
    const user = userEvent.setup();
    render(<SearchSection jobTypeOptions={jobTypeOptions} />);

    await user.click(screen.getByText("สาขาวิชาทั้งหมด"));
    await user.click(screen.getByLabelText("เทคโนโลยีสารสนเทศ"));
    await user.click(screen.getByLabelText("ทรัพยากรบุคคล"));

    expect(screen.getByText("เลือก 2 สาขา")).toBeInTheDocument();
  });

  it("คลิกเลือกสาขาที่เลือกอยู่แล้วซ้ำอีกครั้ง จะเป็นการยกเลิกเลือก (toggle)", async () => {
    const user = userEvent.setup();
    render(<SearchSection jobTypeOptions={jobTypeOptions} />);

    const jobTypeButton = screen.getByRole("button");
    await user.click(jobTypeButton);
    const checkbox = screen.getByLabelText("เทคโนโลยีสารสนเทศ");

    await user.click(checkbox); // เลือก
    expect(within(jobTypeButton).getByText("เทคโนโลยีสารสนเทศ")).toBeInTheDocument();

    await user.click(checkbox); // ยกเลิกเลือก
    expect(within(jobTypeButton).getByText("สาขาวิชาทั้งหมด")).toBeInTheDocument();
  });

  it("พิมพ์ค้นหาในกล่องค้นหาสาขาวิชา จะกรองตัวเลือกที่แสดงในรายการ", async () => {
    const user = userEvent.setup();
    render(<SearchSection jobTypeOptions={jobTypeOptions} />);

    await user.click(screen.getByText("สาขาวิชาทั้งหมด"));
    const searchBox = screen.getByPlaceholderText("ค้นหาสาขาวิชา...");
    await user.type(searchBox, "บัญชี");

    expect(screen.getByText("บัญชี")).toBeInTheDocument();
    expect(screen.queryByText("ทรัพยากรบุคคล")).not.toBeInTheDocument();
    expect(screen.queryByText("เทคโนโลยีสารสนเทศ")).not.toBeInTheDocument();
  });

  it("แสดงข้อความ 'ไม่พบสาขาวิชาที่ค้นหา' เมื่อกรองแล้วไม่มีตัวเลือกเหลือ", async () => {
    const user = userEvent.setup();
    render(<SearchSection jobTypeOptions={jobTypeOptions} />);

    await user.click(screen.getByText("สาขาวิชาทั้งหมด"));
    const searchBox = screen.getByPlaceholderText("ค้นหาสาขาวิชา...");
    await user.type(searchBox, "ไม่มีสาขานี้แน่นอน");

    expect(
      screen.getByText("ไม่พบสาขาวิชาที่ค้นหา"),
    ).toBeInTheDocument();
  });

  it("คลิกนอกกล่อง dropdown แล้ว dropdown ต้องปิด", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <SearchSection jobTypeOptions={jobTypeOptions} />
        <button>อยู่นอกกล่อง</button>
      </div>,
    );

    await user.click(screen.getByText("สาขาวิชาทั้งหมด"));
    expect(screen.getByText("เทคโนโลยีสารสนเทศ")).toBeInTheDocument();

    await user.click(screen.getByText("อยู่นอกกล่อง"));

    expect(
      screen.queryByText("เทคโนโลยีสารสนเทศ"),
    ).not.toBeInTheDocument();
  });

  it("เมื่อ resetKey เปลี่ยนค่า (มากกว่า 0) จะล้างคำค้นหาและสาขาที่เลือกทั้งหมด", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <SearchSection jobTypeOptions={jobTypeOptions} resetKey={0} />,
    );

    const input = screen.getByPlaceholderText(
      "ค้นหาตำแหน่ง...",
    ) as HTMLInputElement;
    await user.type(input, "ทดสอบ");
    await user.click(screen.getByText("สาขาวิชาทั้งหมด"));
    await user.click(screen.getByLabelText("เทคโนโลยีสารสนเทศ"));

    const jobTypeButton = screen.getByRole("button");
    expect(input.value).toBe("ทดสอบ");
    expect(within(jobTypeButton).getByText("เทคโนโลยีสารสนเทศ")).toBeInTheDocument();

    // เปลี่ยน resetKey จาก 0 เป็น 1 (มากกว่า 0) เพื่อจำลองว่า parent สั่งให้ล้างค่า
    rerender(<SearchSection jobTypeOptions={jobTypeOptions} resetKey={1} />);

    await waitFor(() => expect(input.value).toBe(""));
    expect(within(jobTypeButton).getByText("สาขาวิชาทั้งหมด")).toBeInTheDocument();
  });

  it("ไม่พังเมื่อไม่ได้ส่ง onSearch เข้ามาเลย (onSearch เป็น optional prop)", async () => {
    const user = userEvent.setup();
    render(<SearchSection jobTypeOptions={jobTypeOptions} />);

    const input = screen.getByPlaceholderText("ค้นหาตำแหน่ง...");
    // ต้องไม่ throw error แม้ไม่มี onSearch ให้เรียก
    await expect(user.type(input, "ลองพิมพ์")).resolves.not.toThrow();
  });
});
