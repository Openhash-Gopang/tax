# 인수인계 지시서
## tax.gopang.net — 고팡 SSO 인증 및 PDV 저장 테스트

> **작성일:** 2026-06-03  
> **작성자:** AI City Inc. (팀 주피터)  
> **참조:** `Openhash-Gopang/gopang_v2`, `Openhash-Gopang/gdc`  
> **선행 완료:** gdc.gopang.net T1~T9 전체 통과

---

## § 1. 핵심 원칙 — 단 한 줄

모든 고팡 하위 시스템의 인증은 HTML `</body>` 직전에 **한 줄**만 추가하면 됩니다.

```html
<script type="module"
  src="https://gopang.net/auth/subsystem-auth.js">
</script>
```

인증 로직 전체가 `gopang.net`에서 원격으로 실행됩니다.  
`tax.gopang.net`은 자체 인증 파일을 두지 않습니다.

---

## § 2. 배경 지식

### 2-1. 인증 경로 (자동 순서)

```
tax.gopang.net 접속
        │
        ├─ ① GWP 토큰 확인     (?gwp_token= 파싱)
        ├─ ② 세션 캐시 확인    (sessionStorage)
        ├─ ③ 로컬 기기 확인    (localStorage + 기기 핑거프린트)
        ├─ ④ Silent iframe     (gopang.net/auth/silent-auth.html)
        └─ ⑤ 리다이렉트        (미등록 사용자 → 고팡 등록 후 복귀)
```

### 2-2. user 객체 구조

`subsystem-auth.js`가 반환하는 `user` 객체:

```json
{
  "ipv6":  "2601:db80:8995:1e1f:bc7e:764f:502a:f231",
  "level": "L0",
  "exp":   1780504803,
  "via":   "session"
}
```

- **GUID = `user.ipv6`** (`user.guid`가 아님 — 주의)
- `user.level`: L0~L3 인증 레벨
- `user.via`: 인증 경로 (session / iframe / gwp)

### 2-3. PDV 엔드포인트

```
POST https://gopang-proxy.tensor-city.workers.dev/pdv/report
Content-Type: application/json
```

- `tax.gopang.net`은 `gopang-proxy`의 `REGISTERED_SERVICES`에 이미 등록됨
- `minAuth: 'L0'`, `pdv: true`, Level 3 서비스

---

## § 3. 구현 — tax.gopang.net HTML 수정

### 3-1. 추가할 코드 (2개 블록)

`tax.gopang.net`의 메인 HTML 파일 (`webapp.html` 또는 `index.html`)에 아래를 추가합니다.

**① `</script>` 닫기 직전 (기존 JS 블록 내부):**

```javascript
const PROXY_BASE = 'https://gopang-proxy.tensor-city.workers.dev';
let GUID = null;

/* ── 고팡 SSO 인증 콜백 ──────────────────────────────── */
window._onGopangAuth = async function(user) {
  console.log('[TAX] _onGopangAuth raw user:', JSON.stringify(user));

  const guid = user?.ipv6 || user?.guid || null;

  if (!guid) {
    console.log('[TAX] 게스트 접속');
    return;
  }

  GUID = guid;
  console.log('[TAX] 인증 완료:', guid.slice(0,16)+'…', '레벨:', user.level);

  // 앱 초기화 (기존 로직 실행)
  // initTaxApp(guid);

  // PDV 기록 — 접속 이벤트
  await sendPDV(guid, user);
};

/* ── PDV 전송 ────────────────────────────────────────── */
async function sendPDV(ipv6, user, reportOverride = null) {
  try {
    const now = new Date().toISOString();
    const report = reportOverride || {
      svc:  'ktax',
      type: 'event',
      who: {
        ipv6:       ipv6,
        role:       'user',
        level:      user?.level || 'L0',
        recipients: ['gopang-pdv'],
      },
      when:  { period_start: now, period_end: now },
      where: { svc_url: 'https://tax.gopang.net/webapp.html' },
      what:  { summary: 'K-Tax 앱 접속 — 세금 신고·세무 서비스 이용' },
      how:   { method: '고팡 SSO 자동 인증 (경로: ' + (user?.via || 'session') + ')' },
      why:   { goal: '세금 신고 및 세무 자동화 서비스 이용' },
    };

    const res = await fetch(PROXY_BASE + '/pdv/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report })
    });
    const data = await res.json();
    console.log('[TAX PDV]', data.pdv_entry, data.message);
    return data.pdv_entry;
  } catch(e) {
    console.warn('[TAX PDV] 전송 실패:', e.message);
  }
}
```

**② `</body>` 직전:**

```html
<!-- 고팡 SSO 인증 — 이 한 줄이 전부 -->
<script type="module"
  src="https://gopang.net/auth/subsystem-auth.js">
</script>
```

---

## § 4. 테스트 체크리스트 (T1~T6)

### T1 — 코드 삽입 확인

```
tax.gopang.net HTML에:
□ window._onGopangAuth 함수 정의
□ sendPDV 함수 정의 (svc: 'ktax')
□ subsystem-auth.js script 태그 (</body> 직전)
□ PROXY_BASE 상수 정의
```

### T2 — 배포 확인

```
□ 수정된 파일을 GitHub에 push
□ tax.gopang.net 접속 시 변경사항 반영 확인
□ F12 → Console 탭 열기
```

### T3 — SSO 인증 확인

`https://tax.gopang.net` 접속 후 Console에서:

```
✅ [SSO] 경로2A 세션 캐시 ✅   또는
✅ [SSO] 경로2B Silent iframe ✅
   2601:db80:xxxx:... L0
✅ [TAX] 인증 완료: 2601:db80:xx… 레벨: L0
```

**고팡 미로그인 상태라면:**
→ `gopang.net/auth/silent-auth.html`로 자동 이동
→ 로그인 후 `tax.gopang.net`으로 자동 복귀

### T4 — user.ipv6 수신 확인

```
[TAX] _onGopangAuth raw user:
{"ipv6":"2601:db80:...","level":"L0","exp":...,"via":"session"}
```

`user.ipv6` 필드에 GUID가 있는지 확인합니다.  
(`user.guid`가 아닌 `user.ipv6`임에 주의)

### T5 — PDV 전송 확인

```
✅ [TAX PDV] PDV-2601db80xxxx-xxxxxxxxxx
   PDV 기록 완료. ktax (Level 3)
```

403 Forbidden이 뜨면:
- `svc: 'ktax'`가 `REGISTERED_SERVICES`에 있는지 확인
- `report.who.ipv6` 필드가 올바른지 확인

### T6 — Supabase 저장 확인

Supabase SQL Editor에서:

```sql
SELECT id, guid, source, type, summary, created_at
FROM pdv_log
WHERE source = 'ktax'
ORDER BY created_at DESC
LIMIT 5;
```

예상 결과:
```json
{
  "id":         "PDV-2601db80xxxx-xxxxxxxxxx",
  "guid":       "2601:db80:...",
  "source":     "ktax",
  "type":       "event",
  "summary":    "K-Tax 앱 접속 — 세금 신고·세무 서비스 이용",
  "created_at": "2026-06-03 ..."
}
```

---

## § 5. 거래별 PDV 추가 (T7~)

접속 이벤트 이후, 세금 신고·계산 등 주요 거래에도 PDV를 기록합니다.

```javascript
// 예: 세금 신고 완료 시
await sendPDV(GUID, { ipv6: GUID, level: 'L0', via: 'tax' }, {
  svc:  'ktax',
  type: 'transaction',
  who: {
    ipv6: GUID, role: 'user',
    level: 'L0', recipients: ['gopang-pdv'],
  },
  when:  { period_start: now, period_end: now },
  where: { svc_url: 'https://tax.gopang.net/webapp.html' },
  what:  { summary: '종합소득세 신고 완료 (2025년 귀속)' },
  how:   { method: 'K-Tax AI 자동 신고' },
  why:   { goal: '연간 소득세 신고' },
});
```

---

## § 6. 자주 발생하는 오류 및 해결

| 오류 | 원인 | 해결 |
|------|------|------|
| `user.guid is null` | `user.ipv6` 필드 사용해야 함 | `user?.ipv6 \|\| user?.guid`로 수정 |
| PDV 403 Forbidden | `report.who.ipv6` 누락 또는 `svc` 미등록 | `svc: 'ktax'`, `who.ipv6` 확인 |
| 고팡 인증 후 복귀 안됨 | `file://` 로컬 파일로 테스트 | 반드시 `https://tax.gopang.net`으로 접속 |
| Console 로그 없음 | `subsystem-auth.js` 미로드 | `</body>` 직전 script 태그 확인 |
| `Cannot read 'slice' of null` | GUID null인 채로 함수 실행 | `if (!guid) return` 가드 추가 |

---

## § 7. 참조

| 항목 | 위치 |
|------|------|
| GDC 테스트 완료 기록 | `Openhash-Gopang/gdc/docs/GDC_WHITEPAPER_v1_0.md` §13 |
| 하위 시스템 등록 안내서 | `Openhash-Gopang/gopang_v2/docs/SUBSYSTEM_REGISTRY_GUIDE.md` |
| GWP 레지스트리 | `Openhash-Gopang/gopang_v2/gwp-registry.js` |
| 고팡 인증 백서 | `gopang-auth-guide.html` |
| Supabase 프로젝트 | `ebbecjfrwaswbdybbgiu.supabase.co` |
| Cloudflare Worker | `gopang-proxy.tensor-city.workers.dev` |

---

*AI City Inc. (팀 주피터) · 2026-06-03*  
*DAWN: Democracy is All We Need*
