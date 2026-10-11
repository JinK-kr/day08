# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 이 저장소

동네 카페 사장님이 쓰는 "골목카페 운영 대시보드". 정적 HTML 5개와 Supabase(DB + Edge Function 하나)로 이루어진다.

- [PRD.md](PRD.md) — 무엇을 만드는지. 화면, 데이터, AI 규격의 기준 문서다. 동작을 바꾸려면 PRD를 먼저 고친다.
- [STEPS.md](STEPS.md) — 어떤 순서로 만들고 단계마다 무엇을 확인하는지. 어디까지 만들었는지는 이 문서 맨 위 표의 체크로 본다.

## 작업 방식

- STEPS.md 순서대로 **한 번에 한 단계만** 만든다. 다음 단계의 파일을 미리 만들지 않는다.
- 단계의 "확인할 것"이 전부 통과하면 STEPS.md 표에 체크하고 커밋한다. 통과하지 못한 항목이 있으면 그 단계에서 고친다.
- 사용자는 개발자가 아니다. 설명과 화면 글 모두 쉬운 우리말로 쓴다. 화면에 영어 오류 문장이나 개발 용어를 내보내지 않는다.

## 명령

빌드, 린트, 자동 테스트가 없다. 확인은 로컬 서버로 폴더를 띄우고 브라우저에서 STEPS.md의 확인 목록을 직접 눌러 보는 것이다.

```bash
npx serve .
```

- Claude의 브라우저 창으로 볼 때는 `.claude/launch.json`의 `cafe-dashboard`(포트 5500)를 쓴다.
- 이 PC에는 Node는 있고 Python은 없다.
- `npx serve`는 화면을 띄우는 도구일 뿐이다. 프로젝트에 `package.json`이나 `node_modules`를 만들지 않는다.

## 구조

- `index.html`은 틀이다. 왼쪽 메뉴와 가운데 iframe으로 되어 있고, **홈 화면은 별도 파일이 아니라 `index.html` 안에 있다.** 나머지 4개(`sales.html`, `menu.html`, `reviews.html`, `promo.html`)는 iframe에 띄운다. 현재 메뉴는 주소의 `#sales` 같은 해시로 기억한다.
- 페이지 하나는 HTML 파일 하나다. CSS와 JS를 같은 파일 안에 넣고, 공용 `.css` / `.js` 파일을 만들지 않는다. 각 페이지는 iframe 안에서도 혼자 열어도 동작해야 한다.
- 그래서 색과 글꼴 묶음(PRD 6장)이 다섯 파일의 `:root`에 **똑같이 복사돼** 있다. `index.html`이 원본이다. 값 하나를 바꾸면 다섯 파일을 모두 바꾼다.
- 페이지끼리 직접 값을 주고받지 않는다. 모든 페이지가 Supabase에서 다시 읽는다. (예: 리뷰에 답글을 저장하면 홈의 숫자는 홈을 다시 열 때 바뀐다.)
- 바깥에서 불러오는 것은 supabase-js(CDN)와 Pretendard 글꼴(CDN) 두 가지뿐이다. 그래프는 라이브러리 없이 SVG로 직접 그린다. npm, 빌드 도구, 프레임워크를 들이지 않는다.

## 데이터에서 틀리기 쉬운 것

- "오늘"과 날짜 묶음은 한국 시간 기준이다. `sold_at`은 시각(timestamptz)이므로 UTC 날짜로 자르면 자정부터 오전 9시 사이의 판매가 전날로 넘어간다.
- `sales.amount`는 판매 당시 가격 × 수량을 저장한 값이다. 매출을 `menu_items.price`로 다시 계산하지 않는다.
- `menu_items.stock`이 비어 있으면 "재고를 세지 않는 메뉴"다. 0과 다르다.
- 메뉴는 지우지 않고 `is_hidden`으로 숨긴다. 지난 판매 기록이 그 메뉴를 가리킨다.
- 판매해도 재고는 자동으로 줄지 않는다. (이번 범위 밖)

## AI

- AI 호출은 Edge Function `cafe-ai` 하나로 모으고, 요청의 `task`(`review_reply`, `promo_copy`)로 구분한다. AI가 필요해져도 함수를 새로 만들지 않고 `task`를 늘린다.
- AI가 쓴 글은 초안이다. 사용자가 저장을 눌러야 DB에 들어간다.
- AI 키는 Supabase의 Edge Function 비밀 값 `ANTHROPIC_API_KEY`에만 있고, 사용자가 대시보드에서 직접 넣는다. 채팅으로 키를 받지 않는다.

## 보안

- 이번 버전은 로그인이 없다. RLS는 켜되 PRD 10장 표에 있는 동작만 허용한다. 연습용 데이터로만 쓰는 전제이므로, 실제 가게 숫자를 넣는 작업이 나오면 로그인을 먼저 붙여야 한다고 알린다.
- HTML에는 publishable key만 넣는다.
