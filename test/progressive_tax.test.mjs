import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

// dashboard.html의 calcTax()/calcProgressiveIncomeTax()를 vm으로 로드해
// 실제 브라우저에서 실행되는 것과 동일한 함수를 그대로 테스트한다.
const html = fs.readFileSync(new URL('../dashboard.html', import.meta.url), 'utf-8');
const lines = html.split('\n');
const start = lines.findIndex(l => l.startsWith('const INCOME_TAX_BRACKETS'));
const end   = lines.findIndex((l, i) => i > start && l.startsWith('function calcTax'));
const calcTaxEnd = lines.findIndex((l, i) => i > end && l.trim() === '}');
if (start < 0 || end < 0 || calcTaxEnd < 0) {
  throw new Error('dashboard.html 구조가 바뀌어 대상 코드를 못 찾음 — 테스트 갱신 필요');
}
const target = lines.slice(start, calcTaxEnd + 1).join('\n');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(target, sandbox);
const calcTax = vm.runInContext('calcTax', sandbox);
const calcProgressiveIncomeTax = vm.runInContext('calcProgressiveIncomeTax', sandbox);
const INCOME_TAX_BRACKETS = vm.runInContext('INCOME_TAX_BRACKETS', sandbox);

describe('calcProgressiveIncomeTax — 실제 8단계 누진세율 계산', () => {
  test('취약점 수정 확인: 소득이 커지면 실효세율도 실제로 올라간다(이전엔 항상 6% 고정)', () => {
    const low  = calcProgressiveIncomeTax(10_000_000);   // 1구간
    const high = calcProgressiveIncomeTax(2_000_000_000); // 최고구간(45%)
    const lowRate  = low  / 10_000_000;
    const highRate = high / 2_000_000_000;
    assert.ok(lowRate < 0.10, `저소득 실효세율이 너무 높음: ${lowRate}`);
    assert.ok(highRate > 0.40, `고소득 실효세율이 6%대에 머물러선 안 됨(이전 버그 재현 방지): ${highRate}`);
  });

  test('1구간(1,400만원 이하): 단순 6%, 누진공제 없음', () => {
    assert.equal(calcProgressiveIncomeTax(14_000_000), 14_000_000 * 0.06);
  });

  test('경계값(1,400만원)과 그 직후(1,400만원+1원)이 연속적이다(불연속 점프 없음)', () => {
    const atBoundary = calcProgressiveIncomeTax(14_000_000);
    const justAbove  = calcProgressiveIncomeTax(14_000_001);
    assert.ok(Math.abs(justAbove - atBoundary) < 1,
      `구간 경계에서 세액이 갑자기 뛰면 안 됨: ${atBoundary} vs ${justAbove}`);
  });

  test('모든 구간 경계에서 두 인접 구간 공식이 정확히 같은 세액을 산출한다(누진공제액 정합성)', () => {
    for (let i = 0; i < INCOME_TAX_BRACKETS.length - 1; i++) {
      const boundary = INCOME_TAX_BRACKETS[i].upTo;
      const atThis = boundary * INCOME_TAX_BRACKETS[i].rate - INCOME_TAX_BRACKETS[i].deduction;
      const atNext = boundary * INCOME_TAX_BRACKETS[i+1].rate - INCOME_TAX_BRACKETS[i+1].deduction;
      assert.ok(Math.abs(atThis - atNext) < 1,
        `구간 경계(${boundary})에서 세액 불일치: ${atThis} vs ${atNext}`);
    }
  });

  test('과세표준 3,000만원 예시(국세청 공표 예시와 일치): 15% 구간, 세액 324만원', () => {
    const tax = calcProgressiveIncomeTax(30_000_000);
    assert.equal(tax, 3_240_000);
  });

  test('소득이 0 이하이면 세금도 0', () => {
    assert.equal(calcProgressiveIncomeTax(0), 0);
    assert.equal(calcProgressiveIncomeTax(-5000), 0);
  });
});

describe('calcTax — VAT + 소득세 + 지방소득세 통합', () => {
  test('지방소득세가 이제 포함된다(이전엔 아예 없었음) — 소득세의 정확히 10%', () => {
    const t = calcTax(100_000_000, 40_000_000); // income = 60,000,000
    assert.equal(t.localTax, Math.round(t.incomeTax * 0.10 * 100) / 100);
    assert.ok(t.localTax > 0);
  });

  test('총 세금 = VAT + 소득세 + 지방소득세', () => {
    const t = calcTax(100_000_000, 40_000_000);
    assert.equal(Math.round((t.vat + t.incomeTax + t.localTax) * 100) / 100, t.total);
  });

  test('VAT는 여전히 매출의 10%(변경 없음)', () => {
    const t = calcTax(50_000_000, 10_000_000);
    assert.equal(t.vat, 5_000_000);
  });
});
