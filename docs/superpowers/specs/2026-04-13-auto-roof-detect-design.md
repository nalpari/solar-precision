# 자동 지붕 인식 (Auto Roof Detection) 설계

**날짜:** 2026-04-13
**프로젝트:** solar-precision
**상태:** 승인됨

## 목표

`/detect` 페이지에서 사용자가 "자동 지붕 인식" 버튼을 클릭하면, 현재 지도의 중앙 건물 지붕 윤곽선을 AI가 인식하여 지도 위에 폴리곤 마스크로 시각화한다.

## 접근 방식

**Anthropic Claude Vision API 기반 세그먼테이션**
- Google 위성 지도 타일을 `html2canvas`로 캡처
- 캡처 이미지를 Claude(vision) 모델에 전달
- 모델이 반환한 정규화 폴리곤 좌표를 SVG로 오버레이

별도의 ML 서버/모델 배포가 불필요하며, 단일 Next.js 앱으로 완결되는 것이 장점이다.

## 데이터 흐름

```
[사용자 클릭]
  → 프론트: html2canvas로 지도 중앙 640×640 영역 캡처
  → POST /api/detect-roof { imageDataUrl, bounds: { sw, ne } }
  → 서버: Anthropic Messages API 호출 (claude-sonnet-4-6, vision)
      prompt: "중심 건물 지붕 윤곽선을 0~1 정규화 좌표 JSON으로만 반환"
  → 응답: { polygons: [{ points: [[x,y], ...], label, confidence }] }
  → 프론트: 캡처 영역 위에 SVG <polygon> 오버레이 렌더
```

## 구성 요소

### 신규 파일

| 경로 | 역할 |
|------|------|
| `src/components/AutoDetectButton.tsx` | 캡처 트리거, fetch 호출, 로딩/에러 상태 관리 |
| `src/components/RoofMaskOverlay.tsx` | SVG polygon 오버레이. 정규화 좌표 → 픽셀 매핑 |
| `src/components/DetectionContext.tsx` | 감지 결과·상태를 페이지 내부에서 공유하는 컨텍스트 |
| `src/app/api/detect-roof/route.ts` | Next.js Route Handler. Anthropic SDK 호출, JSON 검증 |
| `src/lib/detect/schema.ts` | 응답 스키마(zod) 및 타입 정의 |
| `src/lib/detect/prompt.ts` | 프롬프트 상수 및 시스템 메시지 |

### 수정 파일

| 경로 | 변경 내용 |
|------|-----------|
| `src/components/SiteMap.tsx` | 지도 컨테이너 ref 외부 공개 (캡처 대상) |
| `src/app/detect/page.tsx` | 기존 버튼을 `AutoDetectButton`으로 교체, `RoofMaskOverlay`·`DetectionContext` 연결 |
| `package.json` | `html2canvas`, `@anthropic-ai/sdk`, `zod` 의존성 추가 |
| `.env` | `ANTHROPIC_API_KEY` 추가 (사용자가 직접 입력) |

## 핵심 결정 사항

- **모델:** `claude-sonnet-4-6` (vision 지원 + 비용/지연 균형)
- **캡처 크기:** 지도 화면 중앙 고정 640×640 px (좌표 매핑 단순화, 모델 입력 안정화)
- **지붕 개수:** MVP에서는 중앙 건물 1개만 감지. 다중 건물은 v2로 보류
- **출력 스키마:** Claude에게 JSON-only 응답을 강제하고 서버에서 zod로 검증
- **API 키 보안:** `ANTHROPIC_API_KEY`는 서버 env only. `NEXT_PUBLIC_` 접두사 금지
- **캡처 방식:** 화면 중앙 고정 박스 (solar-pv-system의 드래그 크롭 UI는 v2로 보류)

## 응답 스키마

```ts
type DetectResponse = {
  polygons: Array<{
    points: Array<[number, number]>; // 0.0~1.0 정규화 좌표, 최소 3개
    label: string;                   // 예: "primary_roof"
    confidence: number;              // 0.0~1.0
  }>;
};
```

- `points`가 3개 미만이거나 좌표가 [0,1] 범위를 벗어나면 거부
- 폴리곤은 반시계/시계 방향 상관 없이 그대로 렌더

## 에러 처리

| 시나리오 | 처리 |
|----------|------|
| html2canvas CORS 오류 | `useCORS: true`로 기본 시도, 실패 시 토스트 + 재시도 버튼 |
| Anthropic 4xx/5xx | 사용자에게 에러 메시지 표시 + 재시도 버튼 |
| JSON 파싱 실패 | 서버에서 1회 자동 재시도 후 실패 시 400 반환 |
| 폴리곤 검증 실패 (점 3개 미만, 좌표 범위 밖) | 400 반환, "지붕을 찾지 못했습니다" 안내 |
| API 키 미설정 | 서버 500, 콘솔에 명시적 경고 |

## UI 상태 흐름

```
idle → (클릭) → capturing → calling → rendering → success
                  ↓            ↓          ↓
                  error ←──────┴──────────┘
                  ↓
                  (재시도 버튼)
```

- `capturing`, `calling` 단계는 기존 `DetectionStatusModule`의 LATENCY 바를 실제 진행률(추정치)로 교체
- `success` 시 폴리곤과 함께 "신뢰도: X%" 표시

## 테스트 전략

- **수동 QA:** 도표타워 초기 좌표로 한번, 주소 검색 후 다른 건물로 한번
- **서버 검증:** 잘못된 JSON을 반환하는 목업으로 스키마 거부 동작 확인
- **빌드:** `pnpm lint && pnpm build` 통과 필수

## 범위 외 (v2)

- 다중 건물 감지
- 감지 결과 폴리곤 편집 UI
- 드래그 크롭 영역 선택
- 결과 저장/이력 관리
- 지붕 방향·기울기 추정
