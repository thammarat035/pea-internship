import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

const mockFindById = mock();

mock.module("../service", () => ({
  InstitutionTicketService: class {
    findById = mockFindById;
  },
}));

const { institutionTicketRoutes } = await import("../route");

describe("institution_ticket routes", () => {
  beforeEach(() => {
    mockFindById.mockReset();
  });

  it("GET /institution_ticket/:id เรียก service.findById ด้วย id (ตัวเลข) และตั้ง Cache-Control header", async () => {
    mockFindById.mockResolvedValue({ id: 1, name: "ม.เกษตรศาสตร์" });

    const response = await institutionTicketRoutes.handle(
      new Request("http://localhost/institution_ticket/1"),
    );

    expect(response.status).toBe(200);
    expect(mockFindById).toHaveBeenCalledWith(1);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
  });
});

afterAll(() => {
  mock.restore();
});
