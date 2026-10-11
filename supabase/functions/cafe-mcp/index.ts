// cafe-mcp — 골목카페의 숫자를 AI 도구(Claude 등)가 읽어 갈 수 있게 해 주는 MCP 서버.
// Supabase 문서 "Deploy MCP servers"의 방법대로 만들었다: supabase.com/docs/guides/getting-started/byo-mcp
// 도구는 읽기만 두 개다. 데이터를 바꾸는 도구는 넣지 않는다.
//   today_summary : 한국 시간 오늘 매출 · 주문 수 · 평균 별점
//   low_stock     : 재고 5개 이하 메뉴
// 로그인 확인(verify_jwt)은 꺼져 있다. 주소를 아는 사람은 누구나 부를 수 있다.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createMcpHandler, McpServer } from "npm:@modelcontextprotocol/server@^2.0.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@^4.3.6";

// 대시보드 화면과 같은 publishable key로 읽는다. 화면이 할 수 있는 것보다 더 많은 일을 하지 못한다.
const SUPABASE_KEY = "sb_publishable_NwDpUc3O_dfJvOt9tA_Dhw_McmOYcMV";
const db = createClient(Deno.env.get("SUPABASE_URL")!, SUPABASE_KEY);

const LOW_STOCK = 5; // 재고가 이 개수 이하면 "재고 부족" (PRD 8장)
const KST = 9 * 60 * 60 * 1000;

// Supabase는 한 번에 1,000줄까지만 준다. 끝까지 받아야 합계가 맞는다.
// deno-lint-ignore no-explicit-any
async function fetchAll<T>(query: () => any): Promise<T[]> {
  const size = 1000, rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await query().order("id").range(from, from + size - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < size) return rows;
  }
}

/* ───── 오늘 매출 · 주문 수 · 평균 별점 (계산 방법은 홈 화면과 같다, PRD 8장) ───── */
async function todaySummary() {
  const date = new Date(Date.now() + KST).toISOString().slice(0, 10);          // 지금의 한국 날짜 '2026-10-11'
  const since = new Date(Date.parse(date + "T00:00:00Z") - KST).toISOString(); // 그 날짜가 한국에서 시작하는 순간
  const [sales, reviews] = await Promise.all([
    fetchAll<{ amount: number }>(() => db.from("sales").select("amount").gte("sold_at", since)),
    fetchAll<{ rating: number }>(() => db.from("reviews").select("rating")),
  ]);
  const rated = reviews.reduce((sum, r) => sum + r.rating, 0);
  return {
    date,                                                // 한국 시간 기준 오늘
    sales_won: sales.reduce((sum, s) => sum + s.amount, 0), // 오늘 매출(원)
    orders: sales.length,                                // 판매 기록 한 줄을 주문 한 건으로 센다
    avg_rating: reviews.length ? Number((rated / reviews.length).toFixed(1)) : null, // 모든 리뷰의 평균
    review_count: reviews.length,
  };
}

/* ───── 재고 5개 이하 메뉴 (재고를 세지 않는 메뉴는 stock이 비어 있어 빠진다) ───── */
async function lowStock() {
  const menus = await fetchAll<{ name: string; category: string; stock: number }>(
    () => db.from("menus").select("name, category, stock").lte("stock", LOW_STOCK).order("stock"),
  );
  return {
    threshold: LOW_STOCK,
    count: menus.length,
    menus: menus.map((m) => ({ ...m, status: m.stock === 0 ? "품절" : "재고 부족" })),
  };
}

// 도구의 답은 JSON 글 한 덩어리로 돌려준다. 읽지 못하면 쉬운 말로 알린다.
async function answer(read: () => Promise<unknown>) {
  try {
    return { content: [{ type: "text" as const, text: JSON.stringify(await read()) }] };
  } catch (err) {
    console.error("숫자 읽기 오류", err);
    return {
      content: [{ type: "text" as const, text: "가게 숫자를 불러오지 못했어요. 잠시 뒤에 다시 해 주세요." }],
      isError: true,
    };
  }
}

// Edge Function은 요청마다 새로 시작하므로 서버도 요청마다 새로 만든다
const handler = createMcpHandler(() => {
  const server = new McpServer({ name: "cafe-mcp", version: "0.1.0" });

  server.registerTool(
    "today_summary",
    {
      title: "오늘 요약",
      description:
        "골목카페의 한국 시간 기준 오늘 매출(원), 주문 수, 평균 별점을 돌려준다. 평균 별점은 모든 리뷰의 평균이고, 리뷰가 없으면 null이다.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    () => answer(todaySummary),
  );

  server.registerTool(
    "low_stock",
    {
      title: "재고 부족 메뉴",
      description:
        "골목카페에서 재고가 5개 이하인 메뉴를 적게 남은 순서로 돌려준다. 재고 0은 품절이다. 재고를 세지 않는 메뉴는 들어가지 않는다.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    () => answer(lowStock),
  );

  return server;
});

Deno.serve((req) => handler.fetch(req));
