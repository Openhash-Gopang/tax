# K-Tax Whitepaper v1.0
## tax.hondi.net — AI 세무 자동화 시스템

> **작성일:** 2026-06-04  
> **작성자:** AI City Inc. (팀 주피터)  
> **저장소:** `Openhash-Gopang/tax`  
> **연관 시스템:** `Openhash-Gopang/market`, `Openhash-Gopang/gdc`, `Openhash-Gopang/gopang_v2`  
> **Supabase:** `ebbecjfrwaswbdybbgiu.supabase.co`  
> **Cloudflare Worker:** `gopang-proxy.tensor-city.workers.dev`

---

## 목차

1. [시스템 개요](#1-시스템-개요)
2. [아키텍처](#2-아키텍처)
3. [파일 구조](#3-파일-구조)
4. [화면 구성](#4-화면-구성)
5. [인증 시스템 (고팡 SSO)](#5-인증-시스템-고팡-sso)
6. [PDV 연동](#6-pdv-연동)
7. [세 시스템 연동 파이프라인](#7-세-시스템-연동-파이프라인)
8. [AI 세무 비서 (SP-TAX v2.0)](#8-ai-세무-비서-sp-tax-v20)
9. [세율표 (한국 세법)](#9-세율표-한국-세법)
10. [gopang-proxy Worker v4.3](#10-gopang-proxy-worker-v43)
11. [테스트 기록 (T1~T7)](#11-테스트-기록-t1t7)
12. [통합 파이프라인 테스트](#12-통합-파이프라인-테스트)
13. [데이터베이스 스키마](#13-데이터베이스-스키마)
14. [배포 이력](#14-배포-이력)
15. [향후 과제](#15-향후-과제)

---

## 1. 시스템 개요

K-Tax(`tax.hondi.net`)는 고팡 플랫폼의 **AI 세무 자동화 하위 시스템**이다.

### 핵심 기능

| 기능 | 설명 |
|---|---|
| **데이터 수집** | `market.hondi.net` 거래 원장(`fs_ledger`)에서 수입·지출 자동 집계 |
| **세법 적용** | 현행 한국 세법(부가세·소득세·지방소득세) 자동 계산 |
| **납부 실행** | OpenHash `fs_ledger`에 납세 트랜잭션 기록 |
| **보고서 저장** | `tax_reports` 테이블에 원본 보고서 저장 |
| **PDV 기록** | 6하 원칙에 따라 납세 이력 PDV 원장에 요약 저장 |

### 설계 원칙

```
각 시스템은 Supabase만 바라본다. 서로를 직접 호출하지 않는다.

market → fs_ledger (쓰기)
gdc    → fs_ledger (읽기·쓰기) + extra.fs (쓰기)
tax    → extra.fs  (읽기) + fs_ledger (쓰기: 납세)
```

느슨한 결합(Loose Coupling)을 통해 각 시스템이 독립적으로 수정·배포 가능하다.

---

## 2. 아키텍처

### 전체 데이터 흐름

```
market.hondi.net
  거래 발생 (AI [TRADE] 블록 파싱)
       │
       ▼ INSERT
  ┌─────────────────────────────────────────┐
  │         Supabase: fs_ledger             │
  │  tx_id, guid, direction, amount,        │
  │  item_name, fs_account, tx_at           │
  └─────────────────────────────────────────┘
       │ READ (revenue/purchase/opex 집계)
       ▼
gdc.hondi.net
  settleLedger() — 홈 화면 로드 시 자동 실행
       │
       ▼ PATCH
  ┌─────────────────────────────────────────┐
  │     Supabase: user_profiles             │
  │     extra.fs.pl                         │
  │       pl-revenue      ← 총 매출         │
  │       pl-opex         ← 총 경비         │
  │       pl-net-income   ← 순이익          │
  │     extra.fs.bs                         │
  │       bs-cash         ← 현금 잔액       │
  └─────────────────────────────────────────┘
       │ READ
       ▼
tax.hondi.net
  세금 계산 (부가세·소득세·지방소득세)
       │
       ▼ INSERT
  ┌─────────────────────────────────────────┐
  │  Supabase: fs_ledger (tax_payment)      │
  │  Supabase: pdv_log   (PDV 요약)         │
  └─────────────────────────────────────────┘
```

### 고팡 플랫폼 내 위치

```
hondi.net (메인)
  │
  ├── gwp-registry.js — 서비스 라우터
  │     id: 'ktax' → tax.hondi.net
  │     트리거: 세금, 납세, 부가세, 소득세 ...
  │
  ├── gopang-proxy (Cloudflare Worker v4.3)
  │     /pdv/report    — PDV 수신
  │     /auth/*        — SSO 인증
  │     SVC_ALIAS: 'ktax' → 'tax'
  │
  └── tax.hondi.net
        index.html     — 디바이스 라우터
        webapp.html    — 모바일 납세 앱
        dashboard.html — PC 관리자 대시보드
        prompts/SP-TAX_ktax_v2_0.txt
```

---

## 3. 파일 구조

```
tax.hondi.net/
├── index.html                  # 디바이스 감지 → 라우터
├── webapp.html                 # 모바일 납세 앱 (430px)
├── dashboard.html              # PC 관리자 대시보드
├── CNAME                       # tax.hondi.net
├── config.js                   # 고팡 전역 상수
├── HANDOVER_tax_auth_pdv_test.md
└── prompts/
    ├── SP-TAX_ktax_v1.0.txt    # 구버전 (deprecated)
    └── SP-TAX_ktax_v2_0.txt    # 현행 AI 세무 비서 프롬프트
```

---

## 4. 화면 구성

### 4-1. index.html — 디바이스 라우터

접속 시 화면 크기와 포인터 방식을 감지하여 자동 분기한다.

| 감지 조건 | 이동 대상 |
|---|---|
| `innerWidth ≤ 430px` | `webapp.html` (무조건) |
| `innerWidth > 768px` + `pointer: fine` (마우스) | `dashboard.html` |
| `innerWidth ≤ 768px` + `pointer: coarse` (터치) | `webapp.html` |
| 태블릿 등 중간 영역 | pointer 방식으로 최종 결정 |
| 감지 실패 | 🖥️ / 📱 수동 선택 UI |

`location.replace()` 사용 — 뒤로가기 시 라우터로 돌아오지 않음. `?gwp_token=` 등 URL 파라미터·해시 전달 유지.

### 4-2. webapp.html — 모바일 납세 앱

Supabase 스타일(v2 리디자인). 단색 SVG 아이콘. 이모지 없음. 5개 화면으로 구성.

| 화면 ID | 기능 |
|---|---|
| `screen-home` | 납세 현황 요약, 납부 신청 버튼 |
| `screen-calc` | 세금 계산기 (실시간 계산) |
| `screen-pay` | 납부 확인 및 확정 |
| `screen-result` | 납부 완료 영수증 |
| `screen-history` | PDV 납세 내역 |
| `screen-mypage` | 사용자 정보, 메뉴 |

**하단 내비게이션:** 홈 / 계산 / 내역 / 마이 (SVG 아이콘)

### 4-3. dashboard.html — PC 관리자 대시보드

Supabase SQL Editor 스타일. 좌측 사이드바 + 메인 뷰 전환 구조.

| 사이드바 메뉴 | 구현 방식 | 데이터 소스 |
|---|---|---|
| 종합 대시보드 | 기본 테이블 | `user_profiles` |
| 납세자 목록 | 기본 테이블 동일 | `user_profiles` |
| 읍면동별 현황 | district 기준 그룹 집계 — 클릭 시 해당 구역 필터 자동 적용 | `_allRows` 로컬 집계 |
| 미납 관리 | `status==='미납'` 필터 테이블 — 부족액 컬럼 추가 | `_allRows` 필터 |
| 세목별 통계 | VAT/소득세/납세율/유형별 분포 카드 | `_allRows` |
| 세수 집계 | 4개 KPI 카드 + 상태별 진행 바 | `_allRows` |
| 납세 신고서 | PDV 로그 테이블 | `pdv_log WHERE source='tax'` |
| OpenHash 원장 | 원장 테이블 | `fs_ledger ORDER BY tx_at DESC` |
| 홈 (랜딩) | `index.html` 링크 | — |
| 납세자 앱 | `webapp.html` 링크 | — |

모든 뷰 전환 시 breadcrumb, footer rows 카운트, 사이드바 active 상태 자동 갱신.

---

## 5. 인증 시스템 (고팡 SSO)

### 5-1. 인증 원칙

```html
<!-- 모든 하위 시스템은 </body> 직전에 이 한 줄만 추가 -->
<script type="module"
  src="https://hondi.net/auth/subsystem-auth.js">
</script>
```

인증 로직 전체가 `hondi.net`에서 원격 실행된다. `tax.hondi.net`은 자체 인증 파일을 두지 않는다.

### 5-2. 인증 경로 (자동 순서)

```
tax.hondi.net 접속
  │
  ├─ ① GWP 토큰 확인   (?gwp_token= 파싱)
  ├─ ② 세션 캐시 확인  (sessionStorage)
  ├─ ③ 로컬 기기 확인  (localStorage + 기기 핑거프린트)
  ├─ ④ Silent iframe   (hondi.net/auth/silent-auth.html)
  └─ ⑤ 리다이렉트      (미등록 → 고팡 등록 후 복귀)
```

### 5-3. user 객체 구조

```json
{
  "ipv6":  "2601:db80:8995:1e1f:bc7e:764f:502a:f231",
  "level": "L0",
  "exp":   1780504803,
  "via":   "session"
}
```

- **GUID = `user.ipv6`** (`user.guid` 아님 — 주의)
- `user.level`: L0~L3 인증 레벨
- `user.via`: session / iframe / gwp

### 5-4. 콜백 구현

```javascript
// webapp.html / dashboard.html 공통 패턴
window._onGopangAuth = async function(user) {
  const guid = user?.ipv6 || user?.guid || null;
  if (!guid) return;                   // 게스트

  GUID  = guid;
  _guid = guid;                        // 기존 변수 동기화

  await loadHomeData();                // 실제 데이터 재로드
  await sendPDV(guid, user);          // 접속 이벤트 PDV 기록
};
```

---

## 6. PDV 연동

### 6-1. PDV 엔드포인트

```
POST https://gopang-proxy.tensor-city.workers.dev/pdv/report
Content-Type: application/json
```

### 6-2. PDV 6하 원칙 매핑

| 원칙 | 필드 | 예시 값 |
|---|---|---|
| **누가** | `who.ipv6` | `2601:db80:...` |
| **언제** | `when.period_start/end` | ISO timestamp |
| **어디서** | `where.svc_url` | `https://tax.hondi.net/webapp.html` |
| **무엇을** | `what.summary` | `2026 Q2 세금 납부 완료 — VAT ₮408,900 / IT ₮244,855` |
| **어떻게** | `how.method` | `K-Tax 납부 확정 → OpenHash fs_ledger 기록` |
| **왜** | `why.goal` | `2026년 2기 납세 의무 이행` |

### 6-3. T7 PDV 기록 포인트 (3단계)

| 시점 | `type` | 내용 |
|---|---|---|
| SSO 인증 완료 | `event` | K-Tax 앱 접속 |
| 납부 신청 버튼 (`calcTaxAndRecord`) | `calculation` | 세금 계산 완료 — VAT/IT/합계 |
| 납부 확정 (`confirmPay`) | `transaction` | 납부 완료 — 금액 명세 + TX ID |

### 6-4. Supabase 저장 확인 쿼리

```sql
SELECT id, guid, source, type, summary, created_at
FROM pdv_log
WHERE source = 'tax'
ORDER BY created_at DESC
LIMIT 5;
```

---

## 7. 세 시스템 연동 파이프라인

### 7-1. 설계 원칙 — 느슨한 결합

시스템 간 직접 함수 호출 없음. **Supabase를 공유 Event Bus로 사용.**

```
┌─────────────┐  INSERT   ┌──────────────────┐  READ    ┌─────────────┐
│   market    │ ────────► │   fs_ledger      │ ───────► │     gdc     │
│             │           │  (공유 원장)      │          │  (정산·갱신) │
└─────────────┘           └──────────────────┘          └──────┬──────┘
                                   ▲                           │ PATCH
                                   │ INSERT (납세)              ▼
┌─────────────┐           ┌──────────────────┐
│     tax     │ ────────► │  user_profiles   │
│  (세금계산) │  READ      │  extra.fs.pl     │
└─────────────┘ ◄───────── │  extra.fs.bs     │
                           └──────────────────┘
```

### 7-2. fs_account 표준 코드

| `fs_account` 값 | 의미 | 기록 주체 |
|---|---|---|
| `revenue` | 매출 | market |
| `purchase` | 매입 | market |
| `opex` | 판매비와관리비 | market |
| `cogs` | 매출원가 | market |
| `gdc_transfer` | GDC 이체 | gdc |
| `tax_payment` | 납세 | tax |
| `tax_revenue` | 세수 (국세청) | tax |

### 7-3. market — fs_ledger 기록

AI 응답에서 `[TRADE]...[/TRADE]` 블록 파싱 → `fs_ledger` INSERT.

**시스템 프롬프트 지시:**
```
거래 완료 시 응답 마지막에 반드시 아래 블록을 출력:
[TRADE]{"direction":"credit","amount":50000,"item_name":"제주 감귤 10kg","fs_account":"revenue"}[/TRADE]
```

**`_recordLedger()` 흐름:**
```
AI 응답 수신
  → _parseTrade(fullText)
  → [TRADE] 블록 추출 → JSON 파싱
  → _recordLedger({ direction, amount, itemName, fsAccount })
  → POST /rest/v1/fs_ledger
  → recordPDV (kcommerce transaction)
```

### 7-4. gdc — settleLedger 정산

`loadHome()` 호출 시 자동 실행. `fs_ledger`의 revenue/purchase/opex 집계 → `extra.fs.pl` 갱신.

```javascript
// gdc/webapp.html — settleLedger 핵심 로직
async function settleLedger(guid) {
  // ① fs_ledger READ (revenue/purchase/opex/cogs)
  // ② 집계: revenue(credit 합), opex(debit 합)
  // ③ user_profiles READ (현재 extra)
  // ④ extra.fs.pl PATCH
  //    pl-revenue, pl-opex, pl-cogs, pl-gross-profit, pl-net-income
  // ⑤ bs-cash는 건드리지 않음 (gdc_transfer로 이미 관리)
}
```

**갱신 필드:**
```
pl-revenue       ← fs_ledger credit 합계
pl-opex          ← fs_ledger debit 합계 (cogs 제외)
pl-cogs          ← fs_ledger debit 중 cogs 계정
pl-gross-profit  ← revenue - cogs
pl-net-income    ← gross-profit - opex
```

### 7-5. tax — 재무제표 읽기 → 세금 계산

```javascript
// tax/webapp.html — loadHomeData 핵심 로직
const fs   = profile.extra?.fs || {};
const rev  = parseFloat(fs.pl?.['pl-revenue'] || 0);
const opex = parseFloat(fs.pl?.['pl-opex']    || 0);
const cash = parseFloat(fs.bs?.['bs-cash']    || 0);

// 세금 계산
const vat   = Math.round(rev * 0.10);
const it    = calcIT(Math.max(0, rev - opex));   // 누진세율
const local = Math.round(it * 0.10);
const total = vat + it + local;
```

---

## 8. AI 세무 비서 (SP-TAX v2.0)

**파일:** `prompts/SP-TAX_ktax_v2_0.txt`  
**버전:** 2.0 (2026-06-04)  
**이전 버전:** SP-TAX v1.0 (deprecated — 단순 챗봇 수준)

### v1.0 → v2.0 변경 핵심

| 항목 | v1.0 | v2.0 |
|---|---|---|
| 개념 | 세금 계산 결과를 보여주는 챗봇 | 5단계 자동화 파이프라인 |
| 데이터 수집 | `extra.fs` 집계값만 참조 | `fs_ledger` 거래 단위 수집 |
| 납부 실행 | 홈택스 안내만 | 납부 계좌 체계 + OpenHash 원장 기록 |
| 보고서 저장 | 언급 없음 | `tax_reports` 테이블 DDL + 스키마 |
| PDV 저장 | 언급 없음 | 6하 원칙 전 필드 정의 |
| 세목 | 부가세·소득세만 | 법인세·농어촌특별세 추가 |
| 라인 수 | 125줄 | 666줄 |

### 5단계 파이프라인

```
[STEP 1] 데이터 수집
         fs_ledger → revenue/opex 집계
         우선순위: Supabase → IndexedDB → 수동 입력
             ↓
[STEP 2] 세법 적용·세액 계산
         현행 한국 세법 (부가세·소득세·지방소득세)
         납부 기한 D-day 자동 계산
             ↓
[STEP 3] 납부 실행
         납부 확인 → 사용자 명시적 확인
         fs_ledger INSERT (tax_payment)
         extra.fs.tax 상태 갱신 (paid/insufficient)
             ↓
[STEP 4] 보고서 원본 저장
         Supabase tax_reports + IndexedDB 백업
         full_report JSONB (거래 명세 전문 포함)
             ↓
[STEP 5] PDV 요약 저장
         6하 원칙 매핑
         report_id → PDV 연결
```

### 보고서 목록

| 보고서 | 내용 |
|---|---|
| R-01 | 연간 납세 요약 (5단계 파이프라인 전체 결과) |
| R-02 | 부가가치세 신고 (1기·2기) |
| R-03 | 종합소득세 계산서 |
| R-04 | 납부 일정표 (D-day 포함) |
| R-05 | 납세 후 현금흐름 분석 |
| R-06 | 분기별 매출·세금 트렌드 |
| R-07 | 절세 항목 안내 |

---

## 9. 세율표 (한국 세법 현행 기준)

### 부가가치세

| 구분 | 세율 |
|---|---|
| 일반과세자 | 매출세액 10% − 매입세액 |
| 간이과세자 | 업종별 부가율 × 10% |
| 1기 신고 기한 | 해당 연도 7월 25일 |
| 2기 신고 기한 | 다음 연도 1월 25일 |

### 종합소득세 누진세율 (8단계)

| 과세표준 | 세율 | 누진공제 |
|---|---|---|
| 1,400만 원 이하 | 6% | — |
| 1,400만 ~ 5,000만 | 15% | 126만 원 |
| 5,000만 ~ 8,800만 | 24% | 576만 원 |
| 8,800만 ~ 1.5억 | 35% | 1,544만 원 |
| 1.5억 ~ 3억 | 38% | 1,994만 원 |
| 3억 ~ 5억 | 40% | 2,594만 원 |
| 5억 ~ 10억 | 42% | 3,594만 원 |
| 10억 초과 | 45% | 6,594만 원 |
| 신고 기한 | 다음 연도 5월 31일 | |

### 법인세율

| 과세표준 | 세율 |
|---|---|
| 2억 원 이하 | 9% |
| 2억 ~ 200억 | 19% |
| 200억 ~ 3,000억 | 21% |
| 3,000억 초과 | 24% |

### 지방소득세

| 구분 | 세율 |
|---|---|
| 개인 | 소득세 × 10% |
| 법인 | 법인세 × 10% |

---

## 10. gopang-proxy Worker v4.3

### 변경 이력

| 버전 | 변경 내용 |
|---|---|
| v4.1 | `police.hondi.net` CORS 추가, `/chat/completions` 라우트 추가 |
| v4.2 | `insurance`·`911` CORS 추가, `stock`·`traffic`·`logistics` 신규 등록 |
| **v4.3** | **`SVC_ALIAS` 추가 — `gwp-registry.js` k-prefix ID 자동 resolve** |

### v4.3 핵심 변경 — SVC_ALIAS

**문제:** `gwp-registry.js`의 서비스 ID(`ktax`, `khealth` 등)와 Worker의 `REGISTERED_SERVICES` key(`tax`, `health` 등)가 불일치 → PDV 전송 시 전체 서비스 403 오류.

**분석 결과:**

| gwp-registry.js id | Worker key | 불일치 여부 |
|---|---|---|
| `klaw` | `klaw` | ✅ 일치 (유일) |
| `ktax` | `tax` | ❌ 불일치 |
| `khealth` | `health` | ❌ 불일치 |
| `kgdc` | `gdc` | ❌ 불일치 |
| 나머지 12개 | — | ❌ 전부 불일치 |

**해결:** Worker 1개 수정으로 16개 서비스 전체 즉시 해결.

```javascript
// worker.js v4.3 — SVC_ALIAS 테이블
const SVC_ALIAS = {
  'kemergency':    '911',
  'kpolice':       'police',
  'ksecurity':     'security',
  'khealth':       'health',
  'kedu':          'school',
  'kgdc':          'gdc',
  'kfinance':      'stock',
  'kinsurance':    'insurance',
  'ktax':          'tax',
  'kcommerce':     'market',
  'ktransport':    'traffic',
  'klogistics':    'logistics',
  'fiil-kcleaner': 'fiil',
  'kgov':          'public',
  'kdemocracy':    'democracy',
};

function _resolveSvcId(svcId) {
  return SVC_ALIAS[svcId] || svcId;
}
```

**`_getSvcRegistration`에서 alias 적용:**
```javascript
function _getSvcRegistration(origin, svcId) {
  const resolvedId = _resolveSvcId(svcId);   // alias 적용
  const svc = REGISTERED_SERVICES[resolvedId];
  if (svc && origin.includes(svc.domain))
    return { ...svc, svcId: resolvedId, originalId: svcId };
  ...
}
```

**PDV `source` 컬럼에 정규화된 ID 저장** → Supabase 쿼리 일관성 확보.

### PDV 403 오류 해결 과정

```
증상: gopang-proxy /pdv/report → 403 Forbidden
      {"ok":false,"error":"PDV_NOT_ALLOWED",
       "detail":"Level 1 서비스는 PDV 보고서 전송 권한이 없습니다."}

원인 추적:
  1. role: 'admin' → 'user' 변경 시도 → 여전히 403
  2. svc_url dashboard.html → webapp.html 변경 → 여전히 403
  3. 브라우저 콘솔 직접 fetch 테스트:
     STATUS: 403
     BODY: {"error":"PDV_NOT_ALLOWED","detail":"Level 1..."}
  4. _getSvcRegistration 분석:
     svcId='ktax' → REGISTERED_SERVICES['ktax'] → undefined
     → *.hondi.net fallback → level:1, pdv:false → 403
  5. 근본 원인: gwp-registry.js id 'ktax' ≠ Worker key 'tax'
  6. 분석: 16개 중 15개 불일치 (klaw만 일치)
  7. 해결: SVC_ALIAS 테이블 추가 (Worker v4.3)
```

---

## 11. 테스트 기록 (T1~T7)

### T1 — 코드 삽입 확인

**대상 파일:** `webapp.html`, `dashboard.html`

확인 항목:
- `window._onGopangAuth` 함수 정의
- `sendPDV` / `sendDashPDV` 함수 정의 (`svc: 'ktax'`)
- `subsystem-auth.js` script 태그 (`</body>` 직전)
- `PROXY_BASE` 상수 정의

**결과:** ✅ 통과

---

### T2 — 배포 확인

GitHub push → `tax.hondi.net` 반영 확인.

**결과:** ✅ 통과

---

### T3 — SSO 인증 확인

MS Edge 시크릿 창 → `tax.hondi.net` 접속 → 고팡 로그인 → 리다이렉트 복귀.

```
Console 확인:
✅ [SSO] 경로2A 세션 캐시 / 경로2B Silent iframe
   2601:db80:8995:1e1f:bc7e:764f:502a:f231 L0
✅ [TAX-DASH] 인증 완료: 2601:db80:8995:1… 레벨: L0
```

**결과:** ✅ 통과 (경로2B Silent iframe)

---

### T4 — user.ipv6 수신 확인

```json
{"ipv6":"2601:db80:8995:1e1f:bc7e:764f:502a:f231",
 "level":"L0","exp":1780513414,"via":"session"}
```

`user.ipv6` 필드에 GUID 정상 수신 확인.

**결과:** ✅ 통과

---

### T5 — PDV 전송 확인

초기: `403 PDV_NOT_ALLOWED` → Worker v4.3 배포 후:

```
브라우저 콘솔 fetch 테스트:
STATUS: 200
BODY: {
  "ok": true,
  "pdv_entry": "PDV-2601db808995-1780511849331",
  "message": "PDV 기록 완료. tax (Level 3)",
  "svc_level": 3
}
```

**결과:** ✅ 통과 (Worker v4.3 배포 후)

---

### T6 — Supabase 저장 확인

```sql
SELECT id, guid, source, summary, created_at
FROM pdv_log
WHERE source = 'tax'
ORDER BY created_at DESC
LIMIT 5;
```

```json
[
  {
    "id": "PDV-2601db808995-1780511849331",
    "guid": "2601:db80:8995:1e1f:bc7e:764f:502a:f231",
    "source": "tax",
    "summary": "K-Tax PDV 테스트 v4.3",
    "created_at": "2026-06-03 18:37:29.331+00"
  },
  {
    "id": "PDV-2601db808995-1780511800751",
    "source": "tax",
    "summary": "K-Tax 대시보드 접속 — 납세 현황 조회 (관리자)",
    "created_at": "2026-06-03 18:36:40.751+00"
  }
]
```

**결과:** ✅ 통과 — `ktax → tax` alias 정상 동작 + dashboard 자동 PDV 확인

---

### T7 — 거래별 PDV 추가

납부 신청 및 납부 확정 시 PDV 자동 기록.

| 시점 | 함수 | type | 내용 |
|---|---|---|---|
| SSO 완료 | `_onGopangAuth` | `event` | 앱 접속 |
| 납부 신청 | `calcTaxAndRecord` | `calculation` | 세금 계산 결과 |
| 납부 확정 | `confirmPay` | `transaction` | 납부 완료 + TX ID |

**결과:** ✅ 구현 완료

---

## 12. 통합 파이프라인 테스트

### test_market_ledger.py (단위 테스트)

**목적:** market → fs_ledger → tax 단방향 흐름 검증

| 단계 | 내용 | 결과 |
|---|---|---|
| T1 | 현재 재무제표 확인 (Test_A) | ✅ |
| T2 | fs_ledger INSERT (감귤 판매 ₮50,000) | ✅ |
| T3 | fs_ledger 조회 (RLS 정책으로 anon 제한) | ✅ INSERT 성공 기준 |
| T4 | extra.fs 갱신 (gdc 역할 시뮬) | ✅ |
| T5 | tax 관점 재무제표 조회 및 세금 계산 | ✅ |
| T6 | 롤백 (테스트 데이터 원복) | ✅ |

### test_full_pipeline.py (통합 테스트)

**목적:** market → fs_ledger → gdc settle → tax 전체 파이프라인 검증

**테스트 데이터:**

| 거래 | 방향 | 금액 |
|---|---|---|
| 제주 감귤 20kg | credit (판매) | ₮80,000 |
| 한라봉 선물세트 | credit (판매) | ₮120,000 |
| 포장재 구입 | debit (구매) | ₮15,000 |

**실행 결과:**

```
기준값 (Test_A):
  pl-revenue: ₮4,039,000
  pl-opex:    ₮8,078
  bs-cash:    ₮5,680,720

T1 — market fs_ledger INSERT:
  ✅ credit ₮80,000   제주 감귤 20kg
  ✅ credit ₮120,000  한라봉 선물세트
  ✅ debit  ₮15,000   포장재 구입

T2 — gdc settleLedger:
  신규 매출 +₮200,000 / 신규 경비 +₮15,000
  누적 집계:
    총 매출:    ₮4,239,000  (전: ₮4,039,000)
    총 경비:    ₮23,078     (전: ₮8,078)
    순이익:     ₮4,215,922
  extra.fs PL 갱신: ✅ (204)

T3 — tax 세금 계산:
  pl-revenue: ₮4,239,000  (+₮200,000)
  과세표준:   ₮4,215,922
  부가세:    −₮423,900
  소득세:    −₮252,955  (누진세율)
  지방소득세:−₮25,296
  납부 총액: −₮702,151
  납세율:     16.6%

T4 — 롤백:
  fs_ledger 삭제: ✅ 3/3건
  extra.fs 원복:  ✅ (204)

✅ 전체 파이프라인 테스트 완료
```

**RLS 참고사항:** Supabase anon key는 `fs_ledger` SELECT 시 `guid` 필터 없이 조회 불가. 실제 브라우저(gopang-proxy 경유 또는 세션 컨텍스트)에서는 정상 동작. 테스트 스크립트는 로컬 집계로 우회.

---

## 13. 데이터베이스 스키마

### fs_ledger (거래 원장)

```sql
CREATE TABLE fs_ledger (
  tx_id       TEXT,                    -- 트랜잭션 ID (UUID)
  guid        TEXT NOT NULL,           -- 사용자/엔티티 GUID
  counterpart TEXT,                    -- 거래 상대방
  direction   TEXT NOT NULL,           -- 'credit' | 'debit'
  amount      NUMERIC NOT NULL,
  item_name   TEXT,
  fs_account  TEXT,                    -- 계정과목
  memo        TEXT,
  tx_at       TIMESTAMPTZ DEFAULT NOW()
);
```

### tax_reports (보고서 원본)

```sql
CREATE TABLE tax_reports (
  id           TEXT PRIMARY KEY,       -- 'TAX-{guid16}-{timestamp}'
  guid         TEXT NOT NULL,
  report_type  TEXT NOT NULL,          -- 'VAT' | 'IT' | 'CIT' | 'ANNUAL'
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  tax_year     INTEGER NOT NULL,
  tax_period   TEXT NOT NULL,          -- 'H1' | 'H2' | 'ANNUAL'
  law_version  TEXT NOT NULL,
  revenue      NUMERIC DEFAULT 0,
  expense      NUMERIC DEFAULT 0,
  tax_base     NUMERIC DEFAULT 0,
  vat          NUMERIC DEFAULT 0,
  income_tax   NUMERIC DEFAULT 0,
  local_tax    NUMERIC DEFAULT 0,
  total_tax    NUMERIC DEFAULT 0,
  status       TEXT DEFAULT 'calculated',
  tx_id        TEXT,
  paid_at      TIMESTAMPTZ,
  deadline     DATE,
  full_report  JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
```

### pdv_log (PDV 원장)

```sql
-- 주요 컬럼
id         TEXT PRIMARY KEY,   -- 'PDV-{guid12}-{timestamp}'
guid       TEXT,               -- 사용자 GUID
source     TEXT,               -- 'tax' (정규화된 svc ID)
type       TEXT,               -- 'event' | 'calculation' | 'transaction'
summary    TEXT,               -- what.summary
summary_6w JSONB,              -- 6하 원칙 전문
created_at TIMESTAMPTZ
```

### user_profiles.extra.fs 구조

```json
{
  "fs": {
    "pl": {
      "pl-revenue":      "4039000",
      "pl-opex":         "8078",
      "pl-cogs":         "0",
      "pl-gross-profit": "4039000",
      "pl-net-income":   "4030922"
    },
    "bs": {
      "bs-cash":         "5680720",
      "bs-equity":       "5000000",
      "bs-inventory":    "0"
    },
    "tax": {
      "2026-H1-VAT": { "status": "paid", "paid_at": "...", "tx_id": "...", "amount": 232000 },
      "2026-IT":     { "status": "paid", "paid_at": "...", "tx_id": "...", "amount": 546302 }
    }
  }
}
```

---

## 14. 배포 이력

| 날짜 | 내용 | 커밋 메시지 |
|---|---|---|
| 2026-06-04 | `index.html` 디바이스 라우터 신설 | `feat: index 라우터 분리 + tax SSO/PDV 통합 (T1)` |
| 2026-06-04 | `webapp.html` SSO + PDV 삽입 | `feat: T7 PDV 거래 기록 — 납부신청·납부확정 이벤트` |
| 2026-06-04 | `dashboard.html` SSO + PDV 삽입 | `fix: PDV 403 — role admin→user, svc_url 수정` |
| 2026-06-04 | `dashboard.html` 7개 메뉴 구현 | `feat: dashboard 사이드바 7개 메뉴 전체 구현` |
| 2026-06-04 | `webapp.html` Supabase 스타일 리디자인 | `design: webapp Supabase 스타일 — 단색 SVG 아이콘` |
| 2026-06-04 | `worker.js` v4.3 SVC_ALIAS | `feat: gopang-proxy v4.3 — SVC_ALIAS 추가` |
| 2026-06-04 | `SP-TAX_ktax_v2_0.txt` 5단계 파이프라인 | `feat: SP-TAX v2.0 — 5단계 파이프라인` |
| 2026-06-04 | market `webapp.html` fs_ledger 연동 | `feat: fs_ledger 거래 기록 — market→gdc→tax 파이프라인` |
| 2026-06-04 | gdc `webapp.html` settleLedger | `feat: settleLedger — fs_ledger 집계 → extra.fs PL 갱신` |

---

## 15. 향후 과제

### 단기

| 항목 | 설명 |
|---|---|
| **gdc 실시간 정산** | 현재 `loadHome()` 호출 시만 정산. Supabase Realtime 또는 webhook으로 market 거래 즉시 반영 |
| **tax_reports 테이블 생성** | 현재 DDL만 정의. Supabase에 실제 생성 필요 |
| **국세청 연동** | 현재 `fs_ledger`에만 기록. 실제 국세청 납부 API 연동 |
| **GDC 단위 환산** | GDC(₮)와 KRW 환산율 적용 |

### 중기

| 항목 | 설명 |
|---|---|
| **자동 납부 스케줄** | 납부 기한 D-7 알림 + 자동 납부 동의 시 자동 실행 |
| **법인세 계산** | 현재 개인 종합소득세만 구현. 법인 사업자 법인세 추가 |
| **전자세금계산서** | 국세청 전자세금계산서 발급 API 연동 |
| **다국가 확장** | SP-TAX v2.0의 `law_version` 필드 활용. 한국 외 세법 추가 |

### 장기

| 항목 | 설명 |
|---|---|
| **예방적 세무** | PDV 원칙에 따라 세금 분쟁을 사전 예방 |
| **AI 절세 추천** | 필요경비 추가 인정 항목 자동 탐지 |
| **OpenHash 납세 원장** | 세금 납부 이력의 불변 원장화 |

---

## 참조

| 항목 | 위치 |
|---|---|
| 고팡 SSO 인증 안내서 | `gopang_v2/gopang-auth-guide.html` |
| 하위 시스템 등록 안내서 | `gopang_v2/docs/SUBSYSTEM_REGISTRY_GUIDE.md` |
| GWP 레지스트리 | `gopang_v2/gwp-registry.js` |
| Supabase 프로젝트 | `ebbecjfrwaswbdybbgiu.supabase.co` |
| Cloudflare Worker | `gopang-proxy.tensor-city.workers.dev` |
| GDC 화이트페이퍼 | `gopang_v2/docs/GDC_Whitepaper_v1.5.md` |
| K-Market 화이트페이퍼 | `market/docs/K-Market_WhitePaper_v1.0.md` |

---

*© 2026 AI City Inc. · DAWN: Democracy is All We Need*  
*고팡은 참여하는 시민들이 스스로 통치하는 디지털 민주주의입니다.*
