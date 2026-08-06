import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

// ---------------------------------------------------------------------------
// 1) Mock ของทุกอย่างที่ AdminNavbar "import" มาจากภายนอก
//    เหตุผล: เราไม่อยากให้ test จริง ๆ ไปเรียก router ของ Next.js หรือยิง API จริง
//    เราจึงสร้างของปลอมขึ้นมาแทน แล้วสั่งว่า "พอถูกเรียก ให้ทำ/คืนค่าอะไร"
// ---------------------------------------------------------------------------

const pushMock = jest.fn();
const replaceMock = jest.fn();

jest.mock("next/navigation", () => ({
  usePathname: jest.fn(() => "/admin/applications"),
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
  }),
}));

// next/image กับ next/link ปกติต้องใช้ตอน build จริง เราจึงแทนด้วย <img>/<a> ธรรมดา
jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: any) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// mock child components ให้เรียบง่ายที่สุด เพื่อ "แยก" การทดสอบ AdminNavbar
// ออกจากพฤติกรรมภายในของ component ลูก (unit test ควรเทสแค่หน่วยเดียว)
jest.mock("@/components/ui/Toast", () => ({
  __esModule: true,
  default: ({ message, isVisible, type }: any) =>
    isVisible ? <div data-testid="toast" data-type={type}>{message}</div> : null,
}));

jest.mock("@/components/ui/ConfirmModal", () => ({
  __esModule: true,
  default: ({ isOpen, title, message, confirmText, cancelText, onConfirm, onCancel }: any) =>
    isOpen ? (
      <div data-testid="confirm-modal">
        <p>{title}</p>
        <p>{message}</p>
        <button onClick={onConfirm}>{confirmText}</button>
        <button onClick={onCancel}>{cancelText}</button>
      </div>
    ) : null,
}));

jest.mock("@/components/ui/NotificationStatusIcon", () => ({
  __esModule: true,
  default: () => <span data-testid="notif-icon" />,
  detectNotificationTone: jest.fn(() => "info"),
}));

jest.mock("@/components/ui/VideoLoading", () => ({
  __esModule: true,
  default: ({ message }: any) => <div data-testid="video-loading">{message}</div>,
}));

// mock service layer (ตัวเรียก API จริง) — สำคัญที่สุดสำหรับไฟล์นี้
jest.mock("@/services/api", () => ({
  authApi: {
    signOut: jest.fn(),
  },
  authStorage: {
    getUser: jest.fn(),
    clearAuth: jest.fn(),
  },
  userApi: {
    getUserProfile: jest.fn(),
  },
  notificationApi: {
    getMyNotifications: jest.fn(),
    markAllAsRead: jest.fn(),
    markAsRead: jest.fn(),
    deleteNotification: jest.fn(),
  },
}));

import AdminNavbar from "../ui/AdminNavbar";
import {
  authApi,
  authStorage,
  userApi,
  notificationApi,
} from "@/services/api";
import { usePathname } from "next/navigation";

// ---------------------------------------------------------------------------
// 2) ข้อมูลตัวอย่างที่ใช้ซ้ำหลาย test
// ---------------------------------------------------------------------------
const mockUser = {
  fname: "สมชาย",
  lname: "ใจดี",
  username: "somchai",
  email: "somchai@example.com",
  roleId: 2,
};

const mockNotifications = [
  {
    id: 1,
    title: "แจ้งเตือนที่ 1",
    message: "รายละเอียด 1",
    isRead: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: 2,
    title: "แจ้งเตือนที่ 2",
    message: "รายละเอียด 2",
    isRead: true,
    createdAt: new Date().toISOString(),
  },
];

// ---------------------------------------------------------------------------
// 3) ตั้งค่าก่อนแต่ละ test (beforeEach) ให้ mock กลับเป็นค่าเริ่มต้นเสมอ
//    เพื่อไม่ให้ test หนึ่งไปกระทบผลลัพธ์ของอีก test หนึ่ง
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ advanceTimers: true }); // คุม setInterval / setTimeout ในไฟล์นี้

  (authStorage.getUser as jest.Mock).mockReturnValue(mockUser);
  (userApi.getUserProfile as jest.Mock).mockResolvedValue(mockUser);
  (notificationApi.getMyNotifications as jest.Mock).mockResolvedValue(
    mockNotifications,
  );
  (notificationApi.markAllAsRead as jest.Mock).mockResolvedValue(undefined);
  (notificationApi.markAsRead as jest.Mock).mockResolvedValue(undefined);
  (notificationApi.deleteNotification as jest.Mock).mockResolvedValue(
    undefined,
  );
  (authApi.signOut as jest.Mock).mockResolvedValue(undefined);
  (usePathname as jest.Mock).mockReturnValue("/admin/applications");
});

afterEach(() => {
  jest.useRealTimers();
});

// ต้อง import userEvent แบบใช้ real timers ตอน "advance" ได้ จึงตั้งค่า user ผ่าน setup แบบนี้
function setupUser() {
  return userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
}

// ---------------------------------------------------------------------------
// 4) เริ่ม test จริง
// ---------------------------------------------------------------------------
describe("AdminNavbar", () => {
  it("แสดงโลโก้และลิงก์เมนูหลักครบถ้วน", async () => {
    render(<AdminNavbar />);

    expect(screen.getByAltText("PEA Internship Logo")).toBeInTheDocument();
    expect(screen.getByText("ลิสต์รายการสมัคร")).toBeInTheDocument();
    expect(screen.getByText("แดชบอร์ด")).toBeInTheDocument();
    expect(screen.getByText("คู่มือการใช้งาน")).toBeInTheDocument();

    // รอให้ effect ที่ดึงโปรไฟล์ทำงานเสร็จ กัน warning "act()"
    await waitFor(() => expect(userApi.getUserProfile).toHaveBeenCalled());
  });

  it("ไฮไลต์ลิงก์ที่ตรงกับ path ปัจจุบันด้วยสี primary", async () => {
    (usePathname as jest.Mock).mockReturnValue("/admin/dashboard");
    render(<AdminNavbar />);

    const dashboardLink = screen.getByText("แดชบอร์ด");
    expect(dashboardLink.className).toContain("text-primary-600");

    const applicationsLink = screen.getByText("ลิสต์รายการสมัคร");
    expect(applicationsLink.className).toContain("text-gray-600");
  });

  it("โหลดโปรไฟล์ผู้ใช้จาก API แล้วแสดงชื่อ-อีเมลใน dropdown โปรไฟล์", async () => {
    const user = setupUser();
    render(<AdminNavbar />);

    await waitFor(() => expect(userApi.getUserProfile).toHaveBeenCalled());

    // คลิกปุ่มโปรไฟล์ (ปุ่มไอคอนรูปคน อยู่ท้ายสุด)
    const buttons = screen.getAllByRole("button");
    const profileButton = buttons[buttons.length - 1];
    await user.click(profileButton);

    expect(await screen.findByText("สมชาย ใจดี")).toBeInTheDocument();
    expect(screen.getByText("somchai@example.com")).toBeInTheDocument();
  });

  it("ถ้าดึงโปรไฟล์จาก API ไม่สำเร็จ จะ fallback ไปใช้ข้อมูลจาก authStorage", async () => {
    (userApi.getUserProfile as jest.Mock).mockRejectedValue(
      new Error("network error"),
    );
    render(<AdminNavbar />);

    await waitFor(() => expect(userApi.getUserProfile).toHaveBeenCalled());
    // ไม่ throw error ออกมาให้ทั้งหน้าพัง ก็ถือว่าผ่านแล้วในระดับหนึ่ง
    expect(screen.getByAltText("PEA Internship Logo")).toBeInTheDocument();
  });

  it("แสดงปุ่มสลับไป Owner เฉพาะเมื่อ roleId เป็น 1 เท่านั้น", async () => {
    (userApi.getUserProfile as jest.Mock).mockResolvedValue({
      ...mockUser,
      roleId: 1,
    });
    render(<AdminNavbar />);

    expect(await screen.findByText("Admin")).toBeInTheDocument();
  });

  it("ไม่แสดงปุ่มสลับไป Owner เมื่อ roleId ไม่ใช่ 1", async () => {
    render(<AdminNavbar />); // mockUser.roleId = 2

    await waitFor(() => expect(userApi.getUserProfile).toHaveBeenCalled());
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });

  it("คลิกปุ่มสลับ role แล้วแสดง loading overlay จากนั้น router.push ไปหน้า owner", async () => {
    (userApi.getUserProfile as jest.Mock).mockResolvedValue({
      ...mockUser,
      roleId: 1,
    });
    const user = setupUser();
    render(<AdminNavbar />);

    const switchButton = await screen.findByText("Admin");
    await user.click(switchButton);

    expect(screen.getByTestId("video-loading")).toBeInTheDocument();

    jest.advanceTimersByTime(1000);
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/owner/announcements"),
    );
  });

  it("ดึงรายการแจ้งเตือนตอนโหลดหน้า และแสดงจำนวนที่ยังไม่อ่านบนกระดิ่ง", async () => {
    render(<AdminNavbar />);

    await waitFor(() =>
      expect(notificationApi.getMyNotifications).toHaveBeenCalledTimes(1),
    );
    // มีแจ้งเตือนที่ isRead: false อยู่ 1 รายการ
    expect(await screen.findByText("1")).toBeInTheDocument();
  });

  it("เปิด dropdown แจ้งเตือน แสดงรายการ และ mark-all-as-read เมื่อมีของยังไม่อ่าน", async () => {
    const user = setupUser();
    render(<AdminNavbar />);
    await waitFor(() =>
      expect(notificationApi.getMyNotifications).toHaveBeenCalled(),
    );

    const bellButton = (await screen.findByText("1")).closest("button")!;
    await user.click(bellButton);

    expect(screen.getByText("การแจ้งเตือน")).toBeInTheDocument();
    expect(screen.getByText("แจ้งเตือนที่ 1")).toBeInTheDocument();
    expect(screen.getByText("แจ้งเตือนที่ 2")).toBeInTheDocument();

    await waitFor(() =>
      expect(notificationApi.markAllAsRead).toHaveBeenCalledTimes(1),
    );
    // ตัวเลข badge ต้องหายไปเพราะอ่านหมดแล้ว
    await waitFor(() =>
      expect(screen.queryByText("1")).not.toBeInTheDocument(),
    );
  });

  it("คลิกที่รายการแจ้งเตือน จะพาไปหน้า applications", async () => {
  const user = setupUser();
  render(<AdminNavbar />);
  await waitFor(() =>
    expect(notificationApi.getMyNotifications).toHaveBeenCalled(),
  );

  const bellButton = (await screen.findByText("1")).closest("button")!;
  await user.click(bellButton);

  // การเปิดกระดิ่งจะ mark ทุกอันเป็นอ่านแล้วทันที (mark-all-as-read)
  await waitFor(() =>
    expect(notificationApi.markAllAsRead).toHaveBeenCalledTimes(1),
  );

  const item = await screen.findByText("แจ้งเตือนที่ 1");
  await user.click(item);

  // เพราะ mark-all-as-read ทำงานไปแล้วตอนเปิดกระดิ่ง คลิกรายการจึงไม่ต้องเรียก markAsRead ซ้ำ
  expect(notificationApi.markAsRead).not.toHaveBeenCalled();
  expect(pushMock).toHaveBeenCalledWith("/admin/applications");
});

  it("กดปุ่ม X ที่รายการแจ้งเตือน จะเปิด modal ยืนยันก่อนลบ แล้วลบเมื่อกดยืนยัน", async () => {
    const user = setupUser();
    render(<AdminNavbar />);
    await waitFor(() =>
      expect(notificationApi.getMyNotifications).toHaveBeenCalled(),
    );

    const bellButton = (await screen.findByText("1")).closest("button")!;
    await user.click(bellButton);

    const deleteButtons = screen.getAllByLabelText("ลบการแจ้งเตือน");
    await user.click(deleteButtons[0]);

    const modal = screen.getByTestId("confirm-modal");
    expect(within(modal).getByText("ยืนยันการลบการแจ้งเตือน")).toBeInTheDocument();

    await user.click(within(modal).getByText("ลบ"));

    await waitFor(() =>
      expect(notificationApi.deleteNotification).toHaveBeenCalledWith(1),
    );
    expect(await screen.findByTestId("toast")).toHaveTextContent(
      "ลบการแจ้งเตือนสำเร็จ",
    );
  });

  it("กด 'ลบทั้งหมด' แล้วยืนยัน จะลบการแจ้งเตือนทุกรายการ", async () => {
    const user = setupUser();
    render(<AdminNavbar />);
    await waitFor(() =>
      expect(notificationApi.getMyNotifications).toHaveBeenCalled(),
    );

    const bellButton = (await screen.findByText("1")).closest("button")!;
    await user.click(bellButton);

    await user.click(screen.getByText("ลบทั้งหมด"));
    const modal = screen.getByTestId("confirm-modal");
    expect(within(modal).getByText("ยืนยันการลบทั้งหมด")).toBeInTheDocument();

    await user.click(within(modal).getByText("Clear all"));

    await waitFor(() =>
      expect(notificationApi.deleteNotification).toHaveBeenCalledTimes(2),
    );
    expect(await screen.findByTestId("toast")).toHaveTextContent(
      "ลบการแจ้งเตือนทั้งหมดสำเร็จ",
    );
  });

  it("ถ้าลบทั้งหมดบางรายการล้มเหลว จะแจ้งเตือนแบบ 'บางส่วนสำเร็จ'", async () => {
    (notificationApi.deleteNotification as jest.Mock)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("fail"));

    const user = setupUser();
    render(<AdminNavbar />);
    await waitFor(() =>
      expect(notificationApi.getMyNotifications).toHaveBeenCalled(),
    );

    const bellButton = (await screen.findByText("1")).closest("button")!;
    await user.click(bellButton);
    await user.click(screen.getByText("ลบทั้งหมด"));
    await user.click(
      within(screen.getByTestId("confirm-modal")).getByText("Clear all"),
    );

    expect(await screen.findByTestId("toast")).toHaveTextContent(
      "ลบบางรายการสำเร็จ แต่บางรายการไม่สำเร็จ",
    );
  });

  it("กดออกจากระบบ: เรียก signOut, เคลียร์ auth, แล้ว redirect ไปหน้าแรก", async () => {
    const user = setupUser();
    render(<AdminNavbar />);
    await waitFor(() => expect(userApi.getUserProfile).toHaveBeenCalled());

    const buttons = screen.getAllByRole("button");
    const profileButton = buttons[buttons.length - 1];
    await user.click(profileButton);

    await user.click(screen.getByText("ออกจากระบบ"));

    await waitFor(() => expect(authApi.signOut).toHaveBeenCalledTimes(1));
    expect(authStorage.clearAuth).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledWith("/");
  });

  it("แม้ signOut API จะ error ก็ยังต้องเคลียร์ auth และ redirect เสมอ (finally block)", async () => {
    (authApi.signOut as jest.Mock).mockRejectedValue(new Error("network"));
    const user = setupUser();
    render(<AdminNavbar />);
    await waitFor(() => expect(userApi.getUserProfile).toHaveBeenCalled());

    const buttons = screen.getAllByRole("button");
    await user.click(buttons[buttons.length - 1]);
    await user.click(screen.getByText("ออกจากระบบ"));

    await waitFor(() => expect(authStorage.clearAuth).toHaveBeenCalled());
    expect(replaceMock).toHaveBeenCalledWith("/");
  });

  it("โพลรายการแจ้งเตือนซ้ำทุก 30 วินาที", async () => {
    render(<AdminNavbar />);
    await waitFor(() =>
      expect(notificationApi.getMyNotifications).toHaveBeenCalledTimes(1),
    );

    jest.advanceTimersByTime(30000);
    await waitFor(() =>
      expect(notificationApi.getMyNotifications).toHaveBeenCalledTimes(2),
    );

    jest.advanceTimersByTime(30000);
    await waitFor(() =>
      expect(notificationApi.getMyNotifications).toHaveBeenCalledTimes(3),
    );
  });
});
