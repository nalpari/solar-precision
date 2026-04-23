# Gemini 지붕 감지 파이프라인 응답 지연(~1분) 원인 및 개선안 조사

- **작성일**: 2026-04-23
- **대상 엔드포인트**: [`src/app/api/detect-roof/route.ts`](../../src/app/api/detect-roof/route.ts)
- **사용 모델**: `gemini-3.1-pro-preview`
- **관측 증상**: 1회 감지 요청당 **약 60초** 응답 지연
- **관련 문서**: [2026-04-23-gemini-detect-502-analysis.md](./2026-04-23-gemini-detect-502-analysis.md)

---

## 1. 관측된 증상

- 사용자 실측: `/api/detect-roof` 호출 시 응답까지 **약 1분**
- 클라이언트 UI는 "AI 분석 중..." 상태로 장시간 대기
- 성공 시에도 지연이 동일하게 발생 → 네트워크/재시도 이슈가 아닌 **파이프라인 고유 지연**

---

## 2. 지연 구조 분석

### 2.1 파이프라인 단계별 예상 소요

[route.ts:271](../../src/app/api/detect-roof/route.ts) `runTwoStageDetection` 함수를 단계별로 분해:

| 단계 | 예상 소요 | 주된 원인 |
|---|---|---|
| Stage 1 — bbox 감지 | 15~25초 | Gemini 3 Pro의 thinking 토큰 + 전체 이미지 전송 |
| sharp crop | < 0.1초 | 로컬 이미지 크롭, 무시 가능 |
| Stage 2 — polygon 추적 | 25~40초 | thinking 시간이 더 길어지고 JSON 출력 크기(최대 8K 토큰) 생성 |
| **합계** | **~40~65초** | 두 호출이 **직렬** 실행 (Stage 2가 Stage 1 bbox 의존) |

### 2.2 주된 지연 원인 3가지

1. **Gemini 3 Pro의 extended thinking 모드**
   - 3 Pro 계열은 "답하기 전 추론" 과정이 기본 활성이며, 이 시간이 응답 전체 지연에 직접 기여
   - `maxOutputTokens`에 thinking 토큰이 포함되므로 단순 토큰 수로는 체감 지연을 설명하기 어려움
   - preview 티어이므로 GA 대비 latency가 더 높을 수 있음

2. **두 단계 직렬 호출**
   - Stage 2는 Stage 1의 bbox 결과에 의존 → 병렬 처리 불가
   - 네트워크 왕복 2회 × 모델 inference 2회

3. **Pro 티어 선택**
   - Pro는 Flash 대비 3~5배 느리지만 시각 추론 품질이 높음
   - 현재 요구 정확도 대비 과도한 선택일 가능성

---

## 3. 속도 개선 옵션

### 🥇 옵션 A — `thinkingConfig.thinkingBudget: 0` 추가 (권장, 즉시 적용 가능)

**변경 범위**: [route.ts:78](../../src/app/api/detect-roof/route.ts) `config` 객체에 한 줄 추가

```ts
config: {
  systemInstruction: systemPrompt,
  responseMimeType: "application/json",
  responseSchema,
  maxOutputTokens,
  thinkingConfig: { thinkingBudget: 0 },  // 추가
},
```

**예상 효과**:
- 각 호출 **50~70% 단축**
- 전체 **~60초 → ~20~25초**

**리스크**:
- 복잡한 지붕(L자형, 다중 dormer, 비정형)에서 **폴리곤 정확도 하락** 가능
- 단순 박공/단일 사각 지붕에는 영향 거의 없음

**부가 효과**:
- [502 조사 문서](./2026-04-23-gemini-detect-502-analysis.md)의 가설 H1(thinking 토큰이 `maxOutputTokens` 소진)도 동시 해소
- 응답이 잘려 `JSON.parse` 실패하는 케이스 감소 기대

### 🥈 옵션 B — Gemini 3.1 Flash로 모델 변경 (가장 빠름)

**변경 범위**: [prompt.ts:58](../../src/lib/detect/prompt.ts) `DETECT_MODEL` 교체

```ts
export const DETECT_MODEL = "gemini-3.1-flash-preview";
```

**예상 효과**:
- Pro 대비 **3~5배 빠름**
- 전체 **~60초 → ~15초**
- 옵션 A와 조합 시 **~8~12초** 가능 (Flash는 기본적으로 thinking이 짧음)

**리스크**:
- 시각 추론 정확도가 Pro보다 낮음
- 고도로 회전된 건물이나 복잡 지붕에서 **품질 저하** 가능성 큼
- 프롬프트의 "rotation-aware" 요구사항([prompt.ts:29-33](../../src/lib/detect/prompt.ts))을 Flash가 충분히 따라갈지 검증 필요

### 🥉 옵션 C — 단일 단계로 통합 (구조 변경)

현재 bbox → crop → polygon 2단계를 "전체 이미지에서 바로 polygon" 1단계로 축소.

**예상 효과**: 호출 1회 제거 → 약 **40% 단축**

**리스크**:
- 커밋 `16f4171` ("feat: 감지 정확도 개선 — Opus 4.6 + 2단계 추론(bbox→폴리곤)…")에서 정확도 개선 목적으로 2단계로 전환한 이력 있음
- **회귀 위험 큼** — 이전 정확도 문제 재발 가능
- 별도 벤치마크 및 프롬프트 재작성 필요
- **지금 권장하지 않음**

### 옵션 D — `maxOutputTokens` 정교화

- Stage 2의 8192는 thinking 포함이라 실제 출력 여유가 적음
- 옵션 A와 조합 시 재조정 필요 (thinking 비활성 시 8192는 출력만으로 사용되므로 여유가 생김, 오히려 줄여도 됨)
- **단독 효과는 작음** — A와 함께만 의미 있음

### 옵션 E — 클라이언트 UX 개선 (근본 해결 아님)

- 스트리밍 응답으로 진행률 표시
- "AI 분석 중..." 상태에 예상 시간 또는 진행 바 표시
- **체감 속도 개선** — 실제 시간은 동일

**리스크**: structured output(`responseMimeType: application/json`)은 스트리밍이 어려움. JSON 유효성 검증과 파싱이 최종 시점에만 가능하여 UX 효과가 제한적.

---

## 4. 옵션 비교 요약

| 옵션 | 예상 시간 | 정확도 영향 | 수정 규모 | 리스크 |
|---|---|---|---|---|
| 현재 | ~60초 | 기준 | — | — |
| **A** (thinking 0) | ~20~25초 | 복잡 지붕 약간 ↓ | 1줄 × 2곳 | 낮음 |
| **B** (Flash) | ~15초 | 복잡 지붕 ↓↓ | 상수 1줄 | 중간 |
| **A + B** | ~8~12초 | 복잡 지붕 ↓↓ | 2줄 | 중간 |
| C (단일 단계) | ~35~40초 | 전반적 ↓↓ | 라우트 재작성 | 높음 |
| D (토큰 조정) | 미미 | 영향 없음 | 상수 변경 | 낮음 |
| E (UX) | 실제 동일 | 영향 없음 | 컴포넌트 추가 | 낮음 |

---

## 5. 권장 실행 계획

### 1단계 (즉시, 저위험)
**옵션 A 적용** — `thinkingConfig: { thinkingBudget: 0 }`
- 변경 범위: [route.ts](../../src/app/api/detect-roof/route.ts)의 `callGeminiJson` 내부 `config` 객체
- **함께 수행**: 502 조사 문서(§5.2)의 진단 계측도 같이 추가 → 변경 효과와 502 감소 여부를 동시 측정
- 효과 측정 후 만족스러우면 그대로 유지

### 2단계 (A 결과 부족 시)
**옵션 B 병행 시험** — `?model=flash` 쿼리 토글 도입
- 클라이언트에서 쿼리로 Flash/Pro 전환
- 동일 지역·건물 5종에 대해 A/B 비교
- 허용 정확도 범위면 Flash를 기본으로 승격

### 3단계 (구조적 개선, 별도 스프린트)
- 옵션 C는 별도 프로토타입 브랜치에서 정확도 벤치 후 결정
- 옵션 E는 사용자 만족도 피드백 누적 후 판단

---

## 6. 테스트 방법

변경 전후 비교를 위한 표준 샘플셋:

| 샘플 | 유형 | 체크 포인트 |
|---|---|---|
| S1 | 단순 박공(gable) 2면 | 기본 케이스, 속도만 확인 |
| S2 | 박공 + dormer | 정확도 저하 여부 확인 |
| S3 | 힙(hip) 4면 | 회전된 지붕 처리 |
| S4 | L자형 6면 | 복잡 케이스, 옵션 A/B 정확도 비교 핵심 |
| S5 | 평지붕 | azimuth=0, tilt=0 반환 확인 |

각 샘플에 대해 기록할 지표:
- 응답 시간(ms)
- 폴리곤 개수 및 points 수
- bbox confidence, 각 polygon confidence
- azimuth/tilt 합리성(시각 판단)
- JSON 잘림·파싱 실패 여부

---

## 7. 관련 근거 및 참고

- [Gemini API — thinking 설정 가이드](https://ai.google.dev/gemini-api/docs/models) (thinkingBudget 동작 방식)
- [Gemini 3.1 Flash-Lite Preview 소개](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-1-pro/) (Flash 계열 성능/비용 특성)
- 관련 이력 커밋:
  - `16f4171` — 2단계 추론 도입 (Stage 1 bbox → Stage 2 polygon) **정확도 개선 목적**
  - `09c3ea3` — 회전된 건물 처리 개선 (프롬프트 + 크롭 패딩 25%)
  - `39ff502` — 64점 한도·줌인 캡처 도입
- 관련 파일:
  - [`src/app/api/detect-roof/route.ts`](../../src/app/api/detect-roof/route.ts) — Gemini 호출부 (`callGeminiJson`, `runTwoStageDetection`)
  - [`src/lib/detect/prompt.ts`](../../src/lib/detect/prompt.ts) — `DETECT_MODEL`, `BBOX_CROP_PADDING`
  - [`src/components/AutoDetectButton.tsx`](../../src/components/AutoDetectButton.tsx) — 호출 트리거, UX 상태 관리

---

## 8. 팀 검토 포인트

1. **허용 가능한 정확도 손실 범위**: 옵션 A/B가 복잡 지붕에서 정확도를 낮출 경우, 어느 정도까지 수용 가능한가? (예: L자형에서 면 개수를 1~2개 놓치는 수준은 허용?)
2. **Flash 프리뷰 안정성**: Flash 모델의 preview 티어 가용성·할당량 확인 필요
3. **벤치마크 샘플**: §6의 S1~S5 외에 실제 운영 데이터에서 추가해야 할 건물 유형이 있는지
4. **측정 인프라**: 응답 시간을 서버 로그에 기록하고 대시보드화할 필요성 (변경 효과 추적용)
5. **단계적 롤아웃**: 옵션 A 적용 시 전체 배포 vs 쿼리 파라미터 토글로 A/B 테스트 중 어느 방식을 선호하는지
