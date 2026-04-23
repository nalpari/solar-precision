# Gemini 지붕 감지 파이프라인 502 실패 원인 조사

- **작성일**: 2026-04-23
- **대상 엔드포인트**: [`src/app/api/detect-roof/route.ts`](../../src/app/api/detect-roof/route.ts)
- **사용 모델**: `gemini-3.1-pro-preview` (이전: `gemini-3-pro-preview`, 2026-03-26 단종)
- **조사 단계**: Phase 1 (근본 원인 조사) — 수정 전 증거 수집 단계
- **상태**: 🟡 최종 원인 확정 대기 (서버 로그 필요)

---

## 1. 관측된 증상

### 클라이언트 콘솔 로그
```
[detect] /api/detect-roof 오류 응답 {
  body: { error: '분석에 일시적으로 실패했습니다. 잠시 후 다시 시도하세요.' },
  httpStatus: 502
}
```

### 사용자 체감
- Gemini 모델 사용 시 **실패가 자주 발생**
- UI에는 동일한 메시지("분석에 일시적으로 실패했습니다. 잠시 후 다시 시도하세요.")가 표시됨

---

## 2. 전체 실패 경로 매핑

### 2.1 Input 검증 구간
| # | 위치 | 조건 | 응답 |
|---|---|---|---|
| 1 | `route.ts:308` | `GEMINI_API_KEY` 미설정 | 500 |
| 2 | `route.ts:317` | Content-Length > 5 MB | 413 |
| 3 | `route.ts:328` | 잘못된 JSON body | 400 |
| 4 | `route.ts:345` | data URL 형식 불일치 | 400 |

### 2.2 Gemini 호출 경계 (핵심 의심 구간)
| # | 위치 | 실패 유형 | 최종 상태 |
|---|---|---|---|
| 5 | `route.ts:86-88` | `response.text`가 null/빈 문자열 | 502 (generic) |
| 6 | `route.ts:90-92` | `extractJsonPayload` null | 502 (generic) |
| 7 | `route.ts:94` | `JSON.parse` throw (잘린 JSON) | 502 (generic) |
| 8 | `route.ts:95-98` | Zod 스키마 검증 실패 | 502 (generic) |
| 9 | `route.ts:167` | bbox 좌표 비정상 | 502 (generic) |
| 10 | `ApiError` (`route.ts:372`) | 429/401/403/5xx | 429 or 502 (upstream) |

### 2.3 의도된 "빈 결과" 경로 (실패로 오인 가능)
| # | 위치 | 조건 | UI 메시지 |
|---|---|---|---|
| 11 | `route.ts:276` | bbox confidence < 0.2 | "지붕을 찾지 못했습니다. (신뢰도 미달)" |
| 12 | `route.ts:288` | tracePolygon polygons.length === 0 | "지붕을 찾지 못했습니다. (지붕 면을 식별하지 못함)" |

---

## 3. 관측 증상으로 배제된 원인

관측된 502 + "분석에 일시적으로 실패했습니다" 메시지 조합은 [route.ts:362](../../src/app/api/detect-roof/route.ts)의 **generic catch 경로**에서만 발생합니다. 따라서 다음은 **배제**됩니다:

- ❌ **Rate limit (429)**: 429 응답이면 메시지는 "요청이 일시적으로 많습니다…"
- ❌ **Auth 오류 (401/403)**: 메시지는 "서비스 설정 오류로 분석할 수 없습니다…"
- ❌ **Input 검증 (400/413)**: HTTP 상태가 다름
- ❌ **의도된 빈 결과 (신뢰도 미달 등)**: 이 경우 HTTP 200 + `polygons: []`로 응답됨

즉 **서버 측에서 JS 예외가 throw되어 `respondWithUpstreamError`가 아닌 generic 502 핸들러로 빠진 상황**이 확정됩니다.

---

## 4. 근본 원인 가설 (우선순위 순)

### 🥇 H1 — Gemini 3 계열의 thinking 토큰 소진으로 JSON 출력 잘림 (가능성 높음)

**메커니즘:**
- Gemini 3 Pro / 3.1 Pro는 **extended thinking(추론 토큰)이 기본 활성**이며, 이 토큰이 `maxOutputTokens`에 포함됨
- Stage 2 ([route.ts:198](../../src/app/api/detect-roof/route.ts))의 `maxOutputTokens: 8192`는 복잡한 지붕(10면 × 64점)의 JSON 본문만으로도 4K~5K 토큰 필요
- thinking이 3K~6K 토큰을 쓰면 **본문이 잘린 채 종료** → `JSON.parse` 실패 (경로 #7)
- Stage 1(2048 토큰)에서도 thinking이 활성이라면 0토큰 응답이 나와 경로 #5로 빠질 수 있음

**예상 서버 로그:**
```
[detect-roof] 분석 실패: SyntaxError: Unexpected end of JSON input
```
또는
```
[detect-roof] 분석 실패: Error: Gemini가 텍스트 응답을 반환하지 않았습니다.
```

### 🥈 H2 — 빈 텍스트 응답 (SAFETY / RECITATION / MAX_TOKENS)

**메커니즘:**
- SDK의 `response.text` getter는 모든 text part를 이어붙임
- `candidates[0].finishReason`이 `SAFETY` / `RECITATION` / `MAX_TOKENS`이면 text part가 비어있을 수 있음
- 현재 코드는 `finishReason`을 로깅하지 않아 원인 식별 불가능 ([route.ts:88](../../src/app/api/detect-roof/route.ts))

**예상 서버 로그:**
```
[detect-roof] 분석 실패: Error: Gemini가 텍스트 응답을 반환하지 않았습니다.
```

### H3 — Zod 경계값 문제
- 모델이 `azimuth: 360.00001` 등 경계값을 살짝 초과 → Zod가 거부 ([schema.ts:12](../../src/lib/detect/schema.ts))
- "자주" 발생하는 수준은 아니지만 가능

### H4 — 모델 권한 이슈 (교체 직후에만 유효)
- `gemini-3.1-pro-preview`에 대해 API 키 권한이 없으면 403/404
- 단, 교체 전에도 실패가 있었다면 해당 없음

### H5 — Sharp 이미지 파싱 실패
- 브라우저 캡처 PNG의 특이 케이스에서 sharp 메타데이터 추출 실패 ([route.ts:220](../../src/app/api/detect-roof/route.ts))
- 드문 케이스

---

## 5. 확정을 위해 필요한 증거

### 5.1 서버 측 로그 확보 (1순위)

[route.ts:360](../../src/app/api/detect-roof/route.ts)의 로그 한 줄이 원인을 확정합니다:
```
[detect-roof] 분석 실패: <에러 객체>
```

**확인 위치:**
- **로컬 개발**: `pnpm dev` 터미널 stdout
- **Vercel 프로덕션**: 프로젝트 대시보드 → Functions / Logs → `/api/detect-roof` 호출

### 5.2 진단 계측 추가 (대안)

서버 로그를 확보할 수 없다면, [route.ts:86](../../src/app/api/detect-roof/route.ts) 바로 위에 **한 번만** 진단 로그를 추가하여 1~2회 실패를 재현하면 원인 확정 가능:

```ts
console.info("[detect-roof] gemini response", {
  model: DETECT_MODEL,
  finishReason: response.candidates?.[0]?.finishReason,
  usage: response.usageMetadata,  // thinkingTokenCount 포함
  textLength: response.text?.length ?? 0,
});
```

`finishReason`과 `usage.thinkingTokenCount`만 보면 H1 vs H2가 즉시 판별됩니다.

---

## 6. 권장 후속 조치 (가설별)

> ⚠️ **아직 수정 단계 아님.** 서버 로그 확인 후 해당 가설에 맞는 조치만 적용해야 합니다.

### H1이 확정된 경우 (JSON 잘림)
- `maxOutputTokens`를 Stage 2에서 32768 이상으로 증가
- `thinkingConfig: { thinkingBudget: N }`로 thinking 토큰 명시적 할당 또는 비활성화
- 파싱 실패 시 재시도 로직(exponential backoff) 1~2회 추가 고려

### H2가 확정된 경우 (빈 텍스트 응답)
- `thinkingConfig: { thinkingBudget: 0 }`로 thinking 비활성
- `finishReason`에 따라 분기: `SAFETY`면 사용자에게 다른 메시지, `MAX_TOKENS`면 재시도 등
- safety settings 조정 검토

### H3이 확정된 경우 (Zod 경계값)
- [schema.ts](../../src/lib/detect/schema.ts)의 `azimuth`를 `z.number().min(0).max(360).or(...)` 대신 `.refine()`으로 약간의 여유값 허용 또는 서버 측에서 값 clamping
- `points` 좌표도 동일하게 `Math.max(0, Math.min(1, v))` 적용

### H4가 확정된 경우 (모델 권한)
- Google Cloud 콘솔에서 `gemini-3.1-pro-preview` 액세스 확인
- 임시로 이전 모델이나 GA 모델(`gemini-3-pro`)로 롤백 검토

### H5가 확정된 경우 (Sharp)
- 입력 이미지 검증 강화 (`sharp(buffer).metadata()` 사전 호출)
- 브라우저 캡처 시 PNG 인코딩 옵션 재검토

---

## 7. 원칙: 왜 지금 고치지 않는가

[superpowers:systematic-debugging](https://github.com/obra/superpowers) 프로토콜에 따라:

> **NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST**
>
> Phase 1을 완료하지 않고 수정을 제안하면, 증상 수정에 그치고 오히려 새 버그를 만들 위험이 큼.

- H1과 H2는 증상은 비슷하지만 **수정 방법이 상반**됨 (토큰 증가 vs thinking 비활성)
- 잘못 고치면 성공 케이스를 오히려 망가뜨릴 수 있음 (예: thinking 비활성 → 복잡한 지붕 정확도 저하)
- 서버 로그 1줄이 확정의 핵심 — **5분 확인이 5시간 디버깅을 절약**

---

## 8. 팀 검토 포인트

팀원들께 확인/의견 요청드립니다:

1. **서버 로그**: 최근 실패 발생 시점의 `[detect-roof] 분석 실패:` 라인을 공유 부탁
2. **재현 조건**: 특정 지역/건물/줌 레벨에서 더 자주 발생하는지 (H1의 경우 복잡한 지붕일수록 더 잘 터짐)
3. **빈도**: 10회 중 몇 회 실패? 연속 호출 시에만? (연속이면 H2 rate limit 가능성 재검토 필요)
4. **모델 교체 전후**: `gemini-3-pro-preview` → `gemini-3.1-pro-preview` 교체(2026-04-23) **이전**에도 동일 실패가 있었는지 (H4 배제 가능)
5. **진단 계측 PR 승인**: 5.2의 진단 로그 추가를 임시 PR로 올려도 되는지

---

## 9. 참고

- 단종 공지: [Gemini 3 Pro Preview는 2026-03-26에 단종](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-pro), `gemini-3.1-pro-preview` 사용 권장
- Gemini 3.1 Pro 발표: [blog.google](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-1-pro/) (2026-02-19 출시)
- 관련 파일:
  - [`src/app/api/detect-roof/route.ts`](../../src/app/api/detect-roof/route.ts) — 감지 엔드포인트
  - [`src/lib/detect/prompt.ts`](../../src/lib/detect/prompt.ts) — 프롬프트 / `DETECT_MODEL` 상수
  - [`src/lib/detect/schema.ts`](../../src/lib/detect/schema.ts) — Zod 스키마
  - [`src/components/AutoDetectButton.tsx`](../../src/components/AutoDetectButton.tsx) — 클라이언트 호출부
