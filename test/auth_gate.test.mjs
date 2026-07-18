import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

describe('tax/dashboard.html — loadData() 인증 게이트 확인', () => {
  let dom, fetchCalled;

  function setup(loggedIn) {
    fetchCalled = false;
    dom = new JSDOM(`<!doctype html><body><table><tbody id="tax-tbody"></tbody></table></body>`, {
      runScripts: 'outside-only', url: 'https://tax.hondi.net/dashboard.html',
    });
    dom.window.fetch = async () => { fetchCalled = true; return { json: async () => [] }; };
    dom.window.S = 'https://ebbecjfrwaswbdybbgiu.supabase.co';
    dom.window.H = {};

    const html = fs.readFileSync(new URL('../dashboard.html', import.meta.url), 'utf-8');
    const lines = html.split('\n');
    const start = lines.findIndex(l => l.startsWith('async function loadData'));
    if (start < 0) throw new Error('dashboard.html 구조가 바뀌어 loadData를 못 찾음');
    // 중첩 try/catch가 있어 "줄 시작이 }"인 첫 지점만으론 진짜 끝을 못 찾는다 —
    // 중괄호 깊이를 직접 세어 함수 끝을 정확히 찾는다.
    let depth = 0, end = -1;
    for (let i = start; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end >= 0) break;
    }
    if (end < 0) throw new Error('loadData 함수 끝을 못 찾음');
    const snippet = ['let _dashGuid = ' + (loggedIn ? "'test-guid'" : 'null') + ';', ...lines.slice(start, end + 1)].join('\n');
    dom.window.eval(snippet);
  }

  after(() => { dom?.window.close(); });

  test('취약점 수정 확인: 비로그인 상태면 전체 사용자 데이터 fetch 자체가 실행되지 않는다', async () => {
    setup(false);
    await dom.window.loadData();
    assert.equal(fetchCalled, false, '이전엔 인증 여부와 무관하게 fetch가 실행됐음');
    assert.match(dom.window.document.getElementById('tax-tbody').innerHTML, /로그인이 필요/);
  });

  test('로그인 상태면 정상적으로 데이터를 조회한다(기능 자체는 유지)', async () => {
    setup(true);
    await dom.window.loadData();
    assert.equal(fetchCalled, true);
  });
});
