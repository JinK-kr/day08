// cafe-places — 지역이나 역 이름을 받아 카카오맵에서 그 근처 카페를 찾아 준다. (AI를 쓰지 않는다)
//   보내는 것: { "place": "정발산역" }
//   받는 것:   { "place": "정발산역", "cafes": [{ "name": "…", "address": "…", "kakao_map_url": "…" }] }  — 5곳까지
// 카카오 키는 Supabase Secrets의 KAKAO_REST_API_KEY에서만 읽는다. 코드와 저장소에는 넣지 않는다.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const KAKAO_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"; // 카카오의 "키워드로 장소 검색"
const CAFE = "CE7"; // 카카오의 장소 분류 가운데 "카페"
const HOW_MANY = 5;
const MAX_PLACE = 40;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body = Record<string, unknown>;

// 화면에 그대로 보여 줄 쉬운 안내 문장과 응답 상태
class Problem extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

// 카카오가 준 장소 한 곳 → 화면에 쓸 세 칸. 링크가 카카오맵의 장소 주소가 아니면 버린다
function toCafe(place: Body) {
  const name = text(place.place_name);
  const address = text(place.road_address_name) || text(place.address_name); // 도로명 주소가 없으면 지번 주소
  const link = text(place.place_url);
  if (!name || !/^https?:\/\/place\.map\.kakao\.com\/\d+$/.test(link)) return null;
  return { name, address, kakao_map_url: link };
}

/* ───── 카카오맵에 묻기 ───── */
async function searchCafes(place: string) {
  const key = Deno.env.get("KAKAO_REST_API_KEY");
  if (!key) {
    // 화면에는 쉬운 안내만 보내고, 무엇을 해야 하는지는 여기 로그에 남긴다
    console.error("카카오 키가 없음: Supabase의 Edge Functions → Secrets에 KAKAO_REST_API_KEY를 넣어야 한다");
    throw new Problem(500, "주변 카페를 찾을 준비가 아직 끝나지 않았어요. 대시보드를 설치한 분께 카카오 키를 등록해 달라고 알려 주세요.");
  }
  const url = new URL(KAKAO_URL);
  url.searchParams.set("query", place.includes("카페") ? place : `${place} 카페`);
  url.searchParams.set("category_group_code", CAFE);
  url.searchParams.set("size", String(HOW_MANY));

  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` }, signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    console.error("카카오맵에 연결하지 못함:", err);
    throw new Problem(504, "카카오맵이 답하는 데 너무 오래 걸려요. 잠시 뒤에 다시 시도해 주세요.");
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    console.error("카카오맵 오류:", res.status, detail);
    if (res.status === 429 || detail.includes("RequestThrottled")) {
      throw new Problem(429, "오늘은 카카오맵에서 찾을 수 있는 횟수를 다 썼어요. 내일 다시 해 주세요.");
    }
    // 키가 틀렸거나, 카카오 앱의 [카카오맵] 사용 설정이 꺼져 있거나, 키에 "호출 허용 IP 주소"가 걸려 있을 때
    if (res.status === 401 || res.status === 403) {
      throw new Problem(502, "등록된 카카오 키로는 찾을 수 없어요. 대시보드를 설치한 분께 카카오 키와 카카오맵 사용 설정을 확인해 달라고 알려 주세요.");
    }
    throw new Problem(502, "카카오맵이 답하지 못했어요. 잠시 뒤에 다시 해 주세요.");
  }

  const data = await res.json();
  const places: Body[] = Array.isArray(data?.documents) ? data.documents : [];
  return places.map(toCafe).filter((cafe) => cafe !== null).slice(0, HOW_MANY);
}

/* ───── 요청 받기 ───── */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new Problem(405, "POST로 보내 주세요.");
    const raw = await req.text();
    if (raw.length > 1_000) throw new Problem(413, "보낸 내용이 너무 길어요.");
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new Problem(400, "요청을 읽을 수 없어요. JSON으로 보내 주세요.");
    }
    const place = text((body as Body | null)?.place).replace(/\s+/g, " ");
    if (!place) throw new Problem(400, "지역이나 역 이름을 적어 주세요.");
    if (place.length > MAX_PLACE) throw new Problem(400, `지역이나 역 이름은 ${MAX_PLACE}자까지 적을 수 있어요.`);

    return json({ place, cafes: await searchCafes(place) });
  } catch (err) {
    if (err instanceof Problem) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: "알 수 없는 문제가 생겼어요. 잠시 뒤에 다시 시도해 주세요." }, 500);
  }
});
