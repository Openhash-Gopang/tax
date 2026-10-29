import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const T = require('../assets/tax.js');
const docs = JSON.parse(readFileSync(new URL('../data/docs.json', import.meta.url), 'utf8'));

test('pdvKind: 의뢰인 칸', () => {
  for (const [l, k] of [['성명', 'name'], ['성 명', 'name'], ['납세자 성명', 'name'], ['대표자', 'name'], ['대표자 성명', 'name'],
    ['주소', 'addr'], ['납세자 주소', 'addr'], ['전화번호', 'tel'], ['연락처', 'tel'], ['휴대전화', 'tel'], ['이메일', 'email'], ['주민등록번호', 'rrn']]) {
    assert.equal(T.pdvKind(l), k, l);
  }
});
test('pdvKind: 의뢰인 값으로 채우지 않는 칸', () => {
  for (const l of ['상대방 성명', '상호', '사업자등록번호', '사업장 소재지', '사업장 주소', '법인명', '관할 세무서', '세무대리인 성명', '대리인 주소',
    '공급자 성명', '임대인 성명', '부동산 소재지', '세무사 성명', '공인회계사 성명', '감사인 성명', '배우자 성명']) {
    assert.equal(T.pdvKind(l), null, l);
  }
});
test('search: 한 글자·별칭·제목', () => {
  assert.equal(T.search(docs, '부가', 5)[0].t.startsWith('부가가치세'), true);
  assert.equal(T.search(docs, '종소세')[0].t, '종합소득세 과세표준확정신고 및 납부계산서');
  assert.equal(T.search(docs, '감사계약서')[0].t, '감사계약서');
  assert.deepEqual(T.search(docs, ''), []);
});
test('extractDraft / partialDraft', () => {
  const full = '안내\n~~~markdown\n# 제목\n\n## 의뢰인\n| 성명 | [확인 필요: 성명] |\n~~~\n끝';
  assert.match(T.extractDraft(full), /^# 제목/);
  const part = '~~~markdown\n# 제목\n## 의뢰인\n| 성명 | [확인';
  assert.equal(T.extractDraft(part), null);
  assert.equal(T.partialDraft(part), '# 제목\n## 의뢰인');
  assert.equal(T.partialDraft('~~~markdown\n일반 문장\n둘째'), null);
});
test('renderMd: 제목 한 번만, 빈 칸은 입력 칸, 표', () => {
  const h = T.renderMd('# 제목\n## 의뢰인\n| 항목 | 내용 |\n|---|---|\n| 성명 | [확인 필요: 성명] |\n| 성명 | [확인 필요: 성명] |', { inputs: true, skipTitle: true });
  assert.ok(!h.includes('제목</h'));
  assert.equal((h.match(/class="fld"/g) || []).length, 2);
  assert.ok(h.includes('data-k="성명#2"'));
  assert.ok(h.includes('<th>항목</th>'));
  assert.ok(T.renderMd('<script>x</script>', {}).includes('&lt;script&gt;'));
});
test('fillMd: 민감 항목은 본문에 싣지 않음', () => {
  const md = '성명 [확인 필요: 성명]\n주민 [확인 필요: 주민등록번호]\n전화 [확인 필요: 전화번호]';
  const r = T.fillMd(md, { '성명#1': '홍길동', '주민등록번호#1': '000000-1******' });
  assert.match(r, /홍길동/);
  assert.match(r, /\(민감 항목 제외\)/);
  assert.match(r, /\[확인 필요: 전화번호\]/);
});
test('attachmentsOf', () => {
  assert.deepEqual(T.attachmentsOf('# a\n## 첨부서류\n- 재무제표\n- **사업자등록증** 사본\n## 기타\n- 무관'), ['재무제표', '사업자등록증 사본']);
});
test('parseReview: 판정·확신도, 마지막 줄 제거', () => {
  const r = T.parseReview('결론\n[REVIEW_RESULT: verdict=보정 요청 예상; confidence=7]');
  assert.equal(r.verdict, '보정 요청 예상');
  assert.equal(r.confidence, 7);
  assert.ok(!r.body.includes('REVIEW_RESULT'));
  assert.equal(T.parseReview('결과 없음').verdict, '판단 불가');
  assert.equal(T.parseReview('[REVIEW_RESULT: verdict=승인 예상; confidence=12]').confidence, 9);
  assert.equal(T.parseReview('[REVIEW_RESULT: verdict=엉터리; confidence=5]').verdict, '판단 불가');
});
test('kstLabel: 한국 표준시 날짜', () => {
  assert.equal(T.kstLabel(new Date('2026-10-29T16:00:00Z')), '2026년 10월 30일');
  assert.equal(T.kstLabel(new Date('2026-10-29T14:59:00Z')), '2026년 10월 29일');
});
test('docs.json 형식', () => {
  assert.ok(docs.length > 30);
  for (const d of docs) {
    assert.ok(d.t && d.p && d.pid && d.c && d.d && Array.isArray(d.a), d.t);
  }
  assert.equal(new Set(docs.map((d) => d.t)).size, docs.length);
});
