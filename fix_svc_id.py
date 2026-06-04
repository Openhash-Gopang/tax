#!/usr/bin/env python3
# fix_svc_id.py — svc 'ktax' → 'tax' 일괄 패치
# 실행: python fix_svc_id.py
# 위치: C:\Users\주피터\Downloads\tax\

import re
from pathlib import Path

BASE = Path(__file__).parent
RESULTS = []

def patch(filepath, replacements):
    """replacements: list of (old_str, new_str, description)"""
    p = BASE / filepath
    if not p.exists():
        RESULTS.append(f"  ⚠️  파일 없음: {filepath}")
        return

    text = p.read_text(encoding='utf-8')
    original = text

    for old, new, desc in replacements:
        count = text.count(old)
        if count == 0:
            RESULTS.append(f"  ⚠️  [{filepath}] '{desc}' — 대상 없음 (이미 적용됐거나 위치 다름)")
        else:
            text = text.replace(old, new)
            RESULTS.append(f"  ✅ [{filepath}] '{desc}' — {count}곳 교체")

    if text != original:
        p.write_text(text, encoding='utf-8')

# ── 1. gwp-registry.js ───────────────────────────────────────
patch('gwp-registry.js', [
    (
        "id:          'ktax',",
        "id:          'tax',",
        "id: ktax → tax"
    ),
])

# ── 2. webapp.html ────────────────────────────────────────────
patch('webapp.html', [
    (
        "svc:  'ktax',",
        "svc:  'tax',",
        "svc: ktax → tax"
    ),
])

# ── 3. dashboard.html ─────────────────────────────────────────
patch('dashboard.html', [
    (
        "svc:  'ktax',",
        "svc:  'tax',",
        "svc: ktax → tax"
    ),
])

# ── 4. config.js — EXPERT_SP_MAP + SP 파일명 ─────────────────
patch('config.js', [
    (
        "TAX: 'prompts/SP-TAX_ktax_v1.0.txt',",
        "TAX: 'prompts/SP-TAX_ktax_v2_0.txt',",
        "SP-TAX 버전 v1.0 → v2.0"
    ),
])

# ── 5. SP 파일 복사 (v1.0 → v2.0) ────────────────────────────
src = BASE / 'SP-TAX_ktax_v2_0.txt'
dst = BASE / 'prompts' / 'SP-TAX_ktax_v2_0.txt'
if src.exists():
    dst.write_text(src.read_text(encoding='utf-8'), encoding='utf-8')
    RESULTS.append(f"  ✅ SP-TAX_ktax_v2_0.txt → prompts/ 복사 완료")
else:
    RESULTS.append(f"  ⚠️  SP-TAX_ktax_v2_0.txt 루트에 없음 — prompts/ 복사 생략")

# ── 결과 출력 ─────────────────────────────────────────────────
print("\n" + "="*55)
print("  fix_svc_id.py 패치 결과")
print("="*55)
for r in RESULTS:
    print(r)
print("="*55)
print("\n다음 명령어로 커밋하세요:\n")
print("  git add gwp-registry.js webapp.html dashboard.html config.js prompts/SP-TAX_ktax_v2_0.txt")
print('  git commit -m "fix: svc id ktax→tax, SP-TAX v2.0 적용"')
print("  git push origin main\n")
