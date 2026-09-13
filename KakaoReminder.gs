/**
 * 카카오톡 아침 알림 (나에게 보내기) - Google Apps Script
 *
 * 매일 아침 정해진 시각에 "오늘 할 일 + 곧 다가오는 일 + (선택)오늘 강의일정"을
 * 카카오톡 "나와의 채팅"으로 보내준다.
 *
 * 이 파일은 로비 안내 화면용 AppsScript_Code.gs와 같은 Apps Script 프로젝트
 * (= 같은 구글시트)에 나란히 넣으면 된다. 시트에 "Reminders" 탭이 자동으로 생긴다.
 *
 * 설정 방법은 KAKAO_REMINDER_설정.md 참고. 요약하면:
 *   1) 카카오 개발자 앱 만들고 REST API 키 확보 + 카카오 로그인/talk_message 동의항목 켜기
 *   2) Apps Script 편집기에서 kakaoSetRestKey('REST_API_키') 1회 실행
 *   3) kakaoAuthUrl() 실행 → 로그에 뜬 URL을 브라우저로 열어 동의 → 주소창의 code=... 복사
 *   4) kakaoExchangeCode('복사한_코드') 1회 실행  (여기까지 하면 토큰이 저장됨)
 *   5) installDailyTrigger() 1회 실행  (매일 아침 트리거 설치)
 *
 * ⚠️ 키/토큰은 절대 이 파일에 적지 말 것. 전부 스크립트 속성(Script Properties)에만 저장된다.
 *    이 저장소는 공개(Public)라서 커밋하면 그대로 노출된다. (CLAUDE.md 보안 항목 참고)
 */

var REMINDER_SHEET_NAME = 'Reminders';
var REMINDER_HEADERS = ['날짜', '할 일', '시간', '미리알림(일)', '반복', '완료', '메모'];

// 카카오 text 템플릿의 text 필드는 200자 제한이 있어서, 넘치면 여러 건으로 쪼개 보낸다.
var KAKAO_TEXT_LIMIT = 190;

var DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];

// ---------------------------------------------------------------------------
// 설정 값 (스크립트 속성)
// ---------------------------------------------------------------------------

function props_() {
  return PropertiesService.getScriptProperties();
}

function prop_(name, fallback) {
  var v = props_().getProperty(name);
  return (v === null || v === '') ? fallback : v;
}

/** 1회 실행: 카카오 REST API 키 저장 */
function kakaoSetRestKey(restApiKey) {
  if (!restApiKey) throw new Error('REST API 키를 인자로 넣어서 실행하세요. 예: kakaoSetRestKey("abcd1234...")');
  props_().setProperty('KAKAO_REST_KEY', String(restApiKey).trim());
  Logger.log('저장 완료. 다음으로 kakaoAuthUrl() 을 실행하세요.');
}

/** 아침 발송 시각(0~23)을 바꾼다. 바꾼 뒤 installDailyTrigger()를 다시 실행해야 적용됨 */
function setBriefHour(hour) {
  var h = parseInt(hour, 10);
  if (isNaN(h) || h < 0 || h > 23) throw new Error('0~23 사이의 숫자를 넣으세요.');
  props_().setProperty('BRIEF_HOUR', String(h));
  Logger.log('발송 시각을 ' + h + '시로 저장했습니다. installDailyTrigger() 를 다시 실행하세요.');
}

/** 아침 메시지에 오늘의 강의장 일정(Schedule 탭)도 붙일지 여부 */
function setIncludeLobbySchedule(on) {
  props_().setProperty('INCLUDE_LOBBY_SCHEDULE', on ? '1' : '0');
  Logger.log('오늘 강의일정 포함: ' + (on ? '켜짐' : '꺼짐'));
}

/** 카톡 메시지의 "자세히 보기" 버튼이 열 주소 (기본: 로비 안내 화면) */
function setBriefLink(url) {
  props_().setProperty('BRIEF_LINK_URL', String(url || '').trim());
  Logger.log('링크 저장: ' + url);
}

function briefLinkUrl_() {
  return prop_('BRIEF_LINK_URL', 'https://ktdscon.github.io/ktds_lobby/');
}

// ---------------------------------------------------------------------------
// 카카오 OAuth
// ---------------------------------------------------------------------------

// 카카오 개발자 콘솔 > 카카오 로그인 > Redirect URI 에 아래 값을 그대로 등록해두면 된다.
// (localhost 페이지는 실제로 안 열려도 된다. 주소창에 붙는 code= 값만 쓰면 됨)
var KAKAO_REDIRECT_URI = 'https://localhost';

/** 실행하면 로그에 "동의하러 가는 URL"이 찍힌다. 그 URL을 브라우저에 붙여넣어 열 것 */
function kakaoAuthUrl() {
  var key = prop_('KAKAO_REST_KEY', '');
  if (!key) throw new Error('먼저 kakaoSetRestKey("REST_API_키") 를 실행하세요.');
  var url = 'https://kauth.kakao.com/oauth/authorize'
    + '?client_id=' + encodeURIComponent(key)
    + '&redirect_uri=' + encodeURIComponent(KAKAO_REDIRECT_URI)
    + '&response_type=code'
    + '&scope=talk_message';
  Logger.log('아래 URL을 브라우저에서 열고 "동의하고 계속하기"를 누르세요.\n\n' + url
    + '\n\n그러면 화면은 "연결할 수 없음"처럼 보일 수 있지만, 주소창이\n'
    + KAKAO_REDIRECT_URI + '/?code=XXXXXXXX 형태가 됩니다.\n'
    + 'XXXXXXXX 부분만 복사해서 kakaoExchangeCode("XXXXXXXX") 를 실행하세요.');
  return url;
}

/** 1회 실행: 인가코드를 토큰으로 바꿔 저장 */
function kakaoExchangeCode(code) {
  var key = prop_('KAKAO_REST_KEY', '');
  if (!key) throw new Error('먼저 kakaoSetRestKey("REST_API_키") 를 실행하세요.');
  if (!code) throw new Error('인가코드를 인자로 넣어서 실행하세요. 예: kakaoExchangeCode("abc123")');

  var res = UrlFetchApp.fetch('https://kauth.kakao.com/oauth/token', {
    method: 'post',
    payload: {
      grant_type: 'authorization_code',
      client_id: key,
      redirect_uri: KAKAO_REDIRECT_URI,
      code: String(code).trim()
    },
    muteHttpExceptions: true
  });
  var data = JSON.parse(res.getContentText());
  if (!data.access_token) {
    throw new Error('토큰 발급 실패: ' + res.getContentText()
      + '\n(인가코드는 1회용이고 몇 분 안에 만료됩니다. kakaoAuthUrl()로 새 코드를 받아 다시 시도하세요.)');
  }
  saveAccessToken_(data.access_token, data.expires_in);
  if (data.refresh_token) props_().setProperty('KAKAO_REFRESH_TOKEN', data.refresh_token);
  Logger.log('토큰 저장 완료. sendTestKakao() 로 테스트해보고, installDailyTrigger() 로 매일 알림을 켜세요.');
}

function saveAccessToken_(token, expiresInSec) {
  var exp = Date.now() + (Math.max(60, (expiresInSec || 3600)) - 60) * 1000;
  props_().setProperty('KAKAO_ACCESS_TOKEN', token);
  props_().setProperty('KAKAO_ACCESS_TOKEN_EXP', String(exp));
}

/** 유효한 access token을 돌려준다 (만료됐으면 refresh token으로 자동 재발급) */
function kakaoAccessToken_() {
  var token = prop_('KAKAO_ACCESS_TOKEN', '');
  var exp = parseInt(prop_('KAKAO_ACCESS_TOKEN_EXP', '0'), 10) || 0;
  if (token && Date.now() < exp) return token;

  var refresh = prop_('KAKAO_REFRESH_TOKEN', '');
  var key = prop_('KAKAO_REST_KEY', '');
  if (!refresh || !key) {
    throw new Error('카카오 토큰이 없습니다. kakaoAuthUrl() → kakaoExchangeCode() 를 먼저 진행하세요.');
  }

  var res = UrlFetchApp.fetch('https://kauth.kakao.com/oauth/token', {
    method: 'post',
    payload: {
      grant_type: 'refresh_token',
      client_id: key,
      refresh_token: refresh
    },
    muteHttpExceptions: true
  });
  var data = JSON.parse(res.getContentText());
  if (!data.access_token) {
    throw new Error('토큰 갱신 실패: ' + res.getContentText()
      + '\n(refresh token이 만료됐을 수 있습니다. kakaoAuthUrl()부터 다시 진행하세요.)');
  }
  saveAccessToken_(data.access_token, data.expires_in);
  // 카카오는 refresh token도 갱신해줄 때가 있다. 주면 갈아끼운다 (매일 쓰면 사실상 만료 없음)
  if (data.refresh_token) props_().setProperty('KAKAO_REFRESH_TOKEN', data.refresh_token);
  return data.access_token;
}

// ---------------------------------------------------------------------------
// 카카오 메시지 전송 ("나에게 보내기")
// ---------------------------------------------------------------------------

/**
 * 긴 글을 카카오 200자 제한에 맞춰 쪼갠다.
 * 빈 줄로 나뉜 덩어리(오늘 할 일 / 주간 보고 / 주간 동향)를 먼저 통째로 담아보고,
 * 한 덩어리가 혼자서도 너무 길 때만 그 안에서 줄 단위로 자른다.
 * — 목록 한가운데가 잘려 다음 메시지로 넘어가면 읽기 나빠지기 때문.
 */
function chunkText_(text, limit) {
  var blocks = String(text).split(/\n{2,}/);
  var chunks = [];
  var cur = '';
  function flush() { if (cur) { chunks.push(cur); cur = ''; } }

  for (var b = 0; b < blocks.length; b++) {
    var block = blocks[b];
    if (block.length > limit) {
      flush();
      chunkLines_(block, limit).forEach(function (c) { chunks.push(c); });
      continue;
    }
    var joined = cur ? (cur + '\n\n' + block) : block;
    if (joined.length > limit) {
      flush();
      cur = block;
    } else {
      cur = joined;
    }
  }
  flush();
  return chunks.length ? chunks : [''];
}

/** 한 덩어리 안에서 줄 단위로 자르기 */
function chunkLines_(text, limit) {
  var lines = String(text).split('\n');
  var chunks = [];
  var cur = '';
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    // 한 줄 자체가 너무 길면 강제로 자른다
    while (line.length > limit) {
      if (cur) { chunks.push(cur); cur = ''; }
      chunks.push(line.substring(0, limit));
      line = line.substring(limit);
    }
    var next = cur ? (cur + '\n' + line) : line;
    if (next.length > limit) {
      if (cur) chunks.push(cur);
      cur = line;
    } else {
      cur = next;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [''];
}

/** 나에게 카카오톡 메시지 보내기. 200자를 넘으면 자동으로 여러 건으로 나눠 보낸다 */
function sendKakaoMemo_(text, linkOverride) {
  var token = kakaoAccessToken_();
  var link = linkOverride || briefLinkUrl_();
  var chunks = chunkText_(text, KAKAO_TEXT_LIMIT);

  for (var i = 0; i < chunks.length; i++) {
    var body = chunks[i];
    if (chunks.length > 1) body += '\n(' + (i + 1) + '/' + chunks.length + ')';

    var template = {
      object_type: 'text',
      text: body,
      link: { web_url: link, mobile_web_url: link }
    };
    if (i === chunks.length - 1) {
      template.button_title = (link === newsPageUrl_()) ? '기사 보기' : '안내화면 열기';
    }

    var res = UrlFetchApp.fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
      method: 'post',
      headers: { Authorization: 'Bearer ' + token },
      payload: { template_object: JSON.stringify(template) },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      throw new Error('카카오 전송 실패(' + res.getResponseCode() + '): ' + res.getContentText());
    }
    if (chunks.length > 1) Utilities.sleep(400); // 순서 보장용 짧은 간격
  }
  return chunks.length;
}

/** 설정이 제대로 됐는지 확인용 - 지금 당장 나에게 테스트 카톡을 보낸다 */
function sendTestKakao() {
  var n = sendKakaoMemo_('🔔 테스트 메시지입니다.\n이 메시지가 보이면 아침 알림 설정이 끝났습니다.');
  Logger.log('전송 성공 (' + n + '건). 카카오톡 "나와의 채팅"을 확인하세요.');
}

// ---------------------------------------------------------------------------
// Reminders 시트
// ---------------------------------------------------------------------------

function getReminderSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(REMINDER_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(REMINDER_SHEET_NAME);
    sheet.appendRow(REMINDER_HEADERS);
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(2, 320);
    sheet.getRange('A1:G1').setFontWeight('bold');
    seedReminders_(sheet);
  }
  return sheet;
}

/**
 * 시트를 처음 만들 때 들어가는 초기 데이터.
 * NOL티켓 예매 내역(2026-09-12 기준)에서 옮겨 적은 실제 일정 + 사용법 예시.
 * 필요 없으면 그냥 지우면 된다.
 */
function seedReminders_(sheet) {
  var rows = [
    // --- 예매해둔 공연/전시 (NOL티켓) ---
    ['2026-09-13', '와일드스미스 그림책 원화展 — 오늘이 마지막 날', '', '',
      '', '', '예술의전당 서예박물관 / 예매번호 T2983174670'],
    ['2026-10-24', '이자람 판소리 \'눈, 눈, 눈\' 관람', '16:00', '7,3,1',
      '', '', 'LG아트센터 서울 LG SIGNATURE 홀 / 예매번호 3314647816'],
    // 기간 전시는 "시작일"이 아니라 "마감일"만 걸어둔다. 시작은 놓쳐도 할 게 없고,
    // 정작 놓치는 건 마감이라 D-30부터 네 번 찔러주게 했다 (9/19부터 관람 가능)
    ['2026-12-18', '웨인 티보 전 관람 마감 (9/19부터 관람 가능)', '', '30,14,7,1',
      '', '', 'DDP 뮤지엄 / 예매번호 T3019478430'],
    // --- 해야 할 일 ---
    ['2026-09-14', '사내 대부 대출 신청', '', '3,1', '', '', '인사포털에서 신청'],
    // --- 작성법 예시. '완료' 칸에 표시가 있어서 알림은 오지 않는다. 필요 없으면 삭제 ---
    ['', '(예시) 매주 금요일 반복 항목은 이렇게', '17:00', '', '매주 금', '✔',
      '완료 칸을 비우면 그때부터 알림이 옵니다']
  ];
  rows.forEach(function (r) { sheet.appendRow(r); });
}

function ymd_(d) {
  return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
}

function tz_() {
  return Session.getScriptTimeZone() || 'Asia/Seoul';
}

/** 셀 값(Date 또는 문자열)을 yyyy-MM-dd 로 정규화 */
function reminderFormatDate_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return ymd_(v);
  var s = String(v).trim();
  // 2026.9.5 / 2026/9/5 / 9-5 같은 표기도 받아준다
  var m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (m) {
    return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  }
  m = s.match(/^(\d{1,2})[-./](\d{1,2})$/);
  if (m) {
    var y = new Date().getFullYear();
    return y + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  }
  return s;
}

/** 로비 백엔드(AppsScript_Code.gs)와 같은 프로젝트일 때만 SHARED_KEY를 공유한다 */
function sharedKey_() {
  if (typeof SHARED_KEY !== 'undefined' && SHARED_KEY) return SHARED_KEY;
  return prop_('SHARED_KEY', '');
}

function addDays_(d, n) {
  var x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

function lastDayOfMonth_(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/** 시트에서 할 일 목록을 읽는다 */
function readReminders_() {
  var sheet = getReminderSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, REMINDER_HEADERS.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var title = String(row[1] || '').trim();
    if (!title) continue;
    out.push({
      row: i + 2,
      date: row[0] ? reminderFormatDate_(row[0]) : '',
      title: title,
      time: row[2] ? String(row[2]).trim() : '',
      before: parseBeforeDays_(row[3]),
      repeat: String(row[4] || '').trim(),
      done: isTruthyCell_(row[5]),
      note: row[6] ? String(row[6]).trim() : ''
    });
  }
  return out;
}

/**
 * '완료' 칸 판정. 사람마다 ✔ / O / v / 완료 / done 등 아무거나 적기 때문에,
 * 비어있지 않으면 일단 완료로 보고 "아직 아니다"에 해당하는 표기만 예외로 둔다.
 */
function isTruthyCell_(v) {
  if (v === true) return true;
  if (v === false) return false;
  var s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return false;
  var negatives = ['false', 'n', 'no', 'x', '-', '0', '미완료', '아직', '진행중'];
  return negatives.indexOf(s) === -1;
}

/** "3,1" → [3,1] / 빈값 → [] */
function parseBeforeDays_(v) {
  var s = String(v || '').trim();
  if (!s) return [];
  var out = [];
  s.split(/[,\s]+/).forEach(function (p) {
    var n = parseInt(String(p).replace(/[^0-9]/g, ''), 10);
    if (!isNaN(n) && n > 0) out.push(n);
  });
  out.sort(function (a, b) { return a - b; });
  return out;
}

/**
 * 반복 규칙이 주어진 날짜에 해당하는지 판단한다.
 * 지원: 매일 / 평일 / 매주 월 / 매주 월,수 / 매월 15 / 매월 말 / 매년 09-15
 * (daily, weekday, weekly:MON, monthly:15, yearly:09-15 형태의 영문 표기도 허용)
 */
function repeatMatches_(rule, d) {
  var s = String(rule || '').trim();
  if (!s) return false;
  var lower = s.toLowerCase();

  if (s === '매일' || lower === 'daily') return true;
  if (s === '평일' || lower === 'weekday' || lower === 'weekdays') {
    var dow = d.getDay();
    return dow >= 1 && dow <= 5;
  }
  if (s === '주말' || lower === 'weekend') {
    var w = d.getDay();
    return w === 0 || w === 6;
  }

  // 매주 월 / 매주 월,수 / weekly:MON
  var weekly = s.match(/^(?:매주|weekly[:\s])\s*(.+)$/i);
  if (weekly) {
    var tokens = weekly[1].split(/[,\s/]+/);
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i].trim();
      if (!t) continue;
      var idx = DOW_KO.indexOf(t.charAt(0));
      if (idx === -1) {
        var en = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(t.substring(0, 3).toLowerCase());
        idx = en;
      }
      if (idx === d.getDay()) return true;
    }
    return false;
  }

  // 매월 15 / 매월 말 / monthly:15
  var monthly = s.match(/^(?:매월|매달|monthly[:\s])\s*(.+)$/i);
  if (monthly) {
    var spec = monthly[1].trim();
    if (spec === '말' || spec.toLowerCase() === 'last') {
      return d.getDate() === lastDayOfMonth_(d);
    }
    var day = parseInt(spec.replace(/[^0-9]/g, ''), 10);
    if (isNaN(day)) return false;
    // 31일 지정인데 그 달이 30일까지면 마지막 날에 알린다
    var last = lastDayOfMonth_(d);
    return d.getDate() === Math.min(day, last);
  }

  // 매년 09-15 / 매년 9/15 / yearly:09-15
  var yearly = s.match(/^(?:매년|yearly[:\s])\s*(\d{1,2})\s*[-/.월]\s*(\d{1,2})/);
  if (yearly) {
    return (d.getMonth() + 1) === parseInt(yearly[1], 10) && d.getDate() === parseInt(yearly[2], 10);
  }

  return false;
}

// ---------------------------------------------------------------------------
// 아침 브리핑 만들기
// ---------------------------------------------------------------------------

// 매일 알림에 밀린 일을 며칠까지 끌고 갈지. 이보다 오래된 건 주간 보고에서만 보인다
// (석 달 지난 전시를 매일 알려주면 그것 때문에 알림 전체를 안 보게 된다)
var OVERDUE_DAILY_WINDOW = 14;

/**
 * 날짜가 지났는데 완료 표시가 없는 항목 (오래된 것부터).
 * withinDays를 주면 그만큼 이내로 밀린 것만 — 매일 알림용. 생략하면 전부 — 주간 보고용.
 */
function overdueItems_(items, todayStr, withinDays) {
  var floor = withinDays ? ymd_(addDays_(new Date(todayStr.replace(/-/g, '/')), -withinDays)) : null;
  var out = items.filter(function (it) {
    if (it.done || !it.date || it.date >= todayStr) return false;
    return floor ? it.date >= floor : true;
  });
  out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  return out;
}

/** 밀린 일을 카톡 한 줄로 (최대 max건, 나머지는 "외 N건") */
function overdueLines_(overdue, max) {
  var lines = [];
  overdue.slice(0, max).forEach(function (it) {
    lines.push('· ' + it.title + ' (' + mdFromYmd_(it.date) + ' 지남)');
  });
  if (overdue.length > max) lines.push('· 외 ' + (overdue.length - max) + '건');
  return lines;
}

function bullet_(item) {
  var line = '· ' + item.title;
  if (item.time) line += ' (' + item.time + ')';
  if (item.note) line += ' — ' + item.note;
  return line;
}

/** 주어진 날짜(기본 오늘)의 브리핑 텍스트를 만든다. 보낼 게 없으면 '' */
function buildBriefing_(target) {
  var today = target || new Date();
  var todayStr = ymd_(today);
  var items = readReminders_();

  var todays = [];
  var upcoming = [];   // {days, item}
  // 놓친 일을 다음 주간 보고까지 일주일 내내 아무도 안 알려주면 그대로 묻힌다.
  // 매일 알림에도 넣되 3건까지만 보여줘서 잔소리가 되지 않게 한다.
  var overdue = overdueItems_(items, todayStr, OVERDUE_DAILY_WINDOW);

  items.forEach(function (item) {
    if (item.done) return;

    if (item.date === todayStr) {
      todays.push(item);
      return;
    }
    if (!item.date && repeatMatches_(item.repeat, today)) {
      todays.push(item);
      return;
    }
    // 미리알림(D-N)은 날짜가 확정된 항목에만 적용
    if (item.date && item.before.length) {
      for (var i = 0; i < item.before.length; i++) {
        if (ymd_(addDays_(today, item.before[i])) === item.date) {
          upcoming.push({ days: item.before[i], item: item });
          break;
        }
      }
    }
  });

  var header = '☀️ ' + Utilities.formatDate(today, tz_(), 'M월 d일')
    + ' (' + DOW_KO[today.getDay()] + ')';

  var lobby = prop_('INCLUDE_LOBBY_SCHEDULE', '0') === '1' ? todaysLobbySchedule_(todayStr) : [];

  if (!todays.length && !upcoming.length && !overdue.length && !lobby.length) return '';

  var parts = [header];

  if (todays.length) {
    parts.push('', '📌 오늘 할 일');
    todays.forEach(function (it) { parts.push(bullet_(it)); });
  }

  if (overdue.length) {
    parts.push('', '🔴 밀린 일 ' + overdue.length + '건');
    overdueLines_(overdue, 3).forEach(function (l) { parts.push(l); });
  }

  if (upcoming.length) {
    upcoming.sort(function (a, b) { return a.days - b.days; });
    parts.push('', '⏳ 다가오는 일');
    upcoming.forEach(function (u) {
      var d = u.item.date.split('-');
      parts.push('· ' + u.item.title + ' — D-' + u.days + ' (' + Number(d[1]) + '/' + Number(d[2]) + ')');
    });
  }

  if (lobby.length) {
    parts.push('', '📚 오늘 강의 ' + lobby.length + '건');
    lobby.forEach(function (line) { parts.push(line); });
  }

  if (!todays.length && (upcoming.length || lobby.length)) {
    parts.splice(1, 0, '', '오늘 등록된 할 일은 없습니다.');
  }

  return parts.join('\n');
}

/** 로비 Schedule 탭에서 오늘 강의 목록을 뽑는다 (같은 시트에 Schedule 탭이 있을 때만) */
function todaysLobbySchedule_(todayStr) {
  try {
    if (typeof SHEET_NAME === 'undefined' || typeof readAll !== 'function') return [];
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss.getSheetByName(SHEET_NAME)) return [];
    var items = readAll();   // AppsScript_Code.gs 의 함수 재사용
    var out = [];
    items.forEach(function (it) {
      if (it.date !== todayStr) return;
      var line = '· [' + it.room + '] ' + (it.title || '');
      if (it.session) line += ' (' + it.session + ')';
      out.push(line);
    });
    out.sort();
    return out;
  } catch (err) {
    return [];
  }
}

// ---------------------------------------------------------------------------
// 주간 동향 브리핑 (Claude가 매주 만들어 GitHub에 올린 것을 읽어온다)
// ---------------------------------------------------------------------------
//
// Claude Code가 매주 월요일 이른 아침에 기사를 검색·선별해서 저장소에
// news/latest.txt (카톡용 제목 목록) 와 news/latest.html (링크 달린 전체 목록) 을
// 커밋한다. Apps Script는 그 txt를 그대로 읽어 카톡에 붙이기만 하면 되므로
// 양쪽 어디에도 키나 토큰이 필요 없다 (저장소가 공개라서 가능).

function newsTxtUrl_() {
  return prop_('NEWS_TXT_URL',
    'https://raw.githubusercontent.com/ktdscon/ktds_lobby/main/news/latest.txt');
}

function newsPageUrl_() {
  return prop_('NEWS_PAGE_URL', 'https://ktdscon.github.io/ktds_lobby/news/latest.html');
}

/** 주간 동향을 안 받고 싶으면 setNewsBriefing(false) */
function setNewsBriefing(on) {
  props_().setProperty('NEWS_ENABLED', on ? '1' : '0');
  Logger.log('주간 동향 브리핑: ' + (on ? '켜짐' : '꺼짐'));
}

/**
 * news/latest.txt 를 읽어온다.
 * 첫 줄은 '#yyyy-MM-dd' (그 주 월요일) 마커다. 마커가 이번 주가 아니면
 * Claude 쪽 갱신이 실패한 것이므로 **지난 주 뉴스를 보내지 않고** 건너뛴다.
 * 네트워크 오류 등 어떤 문제가 나도 ''를 돌려준다 — 뉴스 때문에 주간 보고 전체가
 * 실패하면 안 되기 때문.
 */
function fetchNewsBriefing_(mondayStr) {
  if (prop_('NEWS_ENABLED', '1') !== '1') return '';
  try {
    var res = UrlFetchApp.fetch(newsTxtUrl_(), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      Logger.log('주간 동향 파일을 못 읽었습니다 (' + res.getResponseCode() + ') — 이번엔 건너뜁니다.');
      return '';
    }
    var body = res.getContentText().replace(/^\uFEFF/, '').trim();
    var m = body.match(/^#\s*(\d{4}-\d{2}-\d{2})\s*\n?/);
    if (!m) {
      Logger.log('주간 동향 파일에 날짜 마커(#yyyy-MM-dd)가 없습니다 — 건너뜁니다.');
      return '';
    }
    if (mondayStr && m[1] !== mondayStr) {
      Logger.log('주간 동향이 이번 주 것이 아닙니다 (' + m[1] + ' ≠ ' + mondayStr + ') — 건너뜁니다.');
      return '';
    }
    return body.substring(m[0].length).trim();
  } catch (err) {
    Logger.log('주간 동향 가져오기 실패: ' + err + ' — 건너뜁니다.');
    return '';
  }
}

// ---------------------------------------------------------------------------
// 주간 보고 (매주 월요일 아침)
// ---------------------------------------------------------------------------

/** 그 날짜가 속한 주의 월요일~일요일 */
function weekRange_(d) {
  var dow = d.getDay();                       // 0=일 … 6=토
  var mon = addDays_(d, dow === 0 ? -6 : 1 - dow);
  return { start: mon, end: addDays_(mon, 6) };
}

function mdLabel_(d) {
  return (d.getMonth() + 1) + '/' + d.getDate();
}

/** 'yyyy-MM-dd' → 'M/d' (mdLabel_과 표기를 맞춘다) */
function mdFromYmd_(ymd) {
  var p = String(ymd).split('-');
  return Number(p[1]) + '/' + Number(p[2]);
}

/** 반복 항목이 start~end 사이 어느 날에 걸리는지 (없으면 null) */
function firstRepeatHit_(rule, start, end) {
  for (var i = 0; i < 7; i++) {
    var d = addDays_(start, i);
    if (d > end) break;
    if (repeatMatches_(rule, d)) return d;
  }
  return null;
}

/**
 * 주간 보고 텍스트. 보고할 게 하나도 없으면 ''.
 * 구성: ① 밀린 일(날짜 지났는데 완료 안 됨) ② 이번 주 할 일 ③ 강의장 운영 현황
 */
function buildWeeklyReport_(target) {
  var today = target || new Date();
  var todayStr = ymd_(today);
  var range = weekRange_(today);
  var startStr = ymd_(range.start);
  var endStr = ymd_(range.end);

  var items = readReminders_();
  var overdue = overdueItems_(items, todayStr);
  var thisWeek = [];   // {date, label, item}

  items.forEach(function (item) {
    if (item.done) return;

    if (item.date) {
      if (item.date >= startStr && item.date <= endStr) {
        thisWeek.push({ date: item.date, label: mdFromYmd_(item.date), item: item });
      }
      return;
    }
    if (item.repeat) {
      var hit = firstRepeatHit_(item.repeat, range.start, range.end);
      if (hit) thisWeek.push({ date: ymd_(hit), label: mdLabel_(hit), item: item });
    }
  });

  var lobby = lobbyWeeklyStats_(range);

  if (!overdue.length && !thisWeek.length && !lobby.length) return '';

  var parts = ['📋 주간 보고 (' + mdLabel_(range.start) + '~' + mdLabel_(range.end) + ')'];

  // 주간 보고는 매일 알림과 달리 밀린 일을 전부 보여준다 (그게 보고의 목적)
  if (overdue.length) {
    parts.push('', '🔴 밀린 일 ' + overdue.length + '건');
    overdueLines_(overdue, overdue.length).forEach(function (l) { parts.push(l); });
  }

  if (thisWeek.length) {
    thisWeek.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    parts.push('', '📌 이번 주 할 일 ' + thisWeek.length + '건');
    thisWeek.forEach(function (w) {
      var line = '· ' + w.label + '(' + DOW_KO[new Date(w.date.replace(/-/g, '/')).getDay()] + ') ' + w.item.title;
      if (w.item.time) line += ' ' + w.item.time;
      parts.push(line);
    });
  } else if (!overdue.length) {
    parts.push('', '이번 주 등록된 할 일은 없습니다.');
  }

  if (lobby.length) {
    parts.push('', '📚 강의장 운영');
    lobby.forEach(function (line) { parts.push(line); });
  }

  return parts.join('\n');
}

/**
 * 로비 Schedule 탭 기준 이번 주/다음 주 현황.
 * 데이터가 통째로 빠진 날을 잡아내는 게 핵심 — 10~12월은 아직 "(테스트)" 임시 데이터라
 * 실제 데이터로 덮어써야 하는 상태다 (인수인계.md 참고).
 */
function lobbyWeeklyStats_(range) {
  if (prop_('INCLUDE_LOBBY_SCHEDULE', '0') !== '1') return [];
  try {
    if (typeof SHEET_NAME === 'undefined' || typeof readAll !== 'function') return [];
    if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME)) return [];

    var items = readAll();
    var byDate = {};
    var testFlag = {};
    items.forEach(function (it) {
      byDate[it.date] = (byDate[it.date] || 0) + 1;
      if (/\(테스트\)/.test(it.title || '')) testFlag[it.date] = true;
    });

    var thisCount = 0, nextCount = 0, empty = [], test = [];
    for (var i = 0; i < 14; i++) {
      var d = addDays_(range.start, i);
      var ds = ymd_(d);
      var n = byDate[ds] || 0;
      if (testFlag[ds]) test.push(mdLabel_(d));
      if (i < 7) {
        thisCount += n;
        // 다음 주 공백은 아직 데이터를 안 넣었을 수 있어 경고하지 않는다 (노이즈)
        var dow = d.getDay();
        if (n === 0 && dow >= 1 && dow <= 5) empty.push(mdLabel_(d) + '(' + DOW_KO[dow] + ')');
      } else {
        nextCount += n;
      }
    }

    var out = ['· 이번 주 ' + thisCount + '건 / 다음 주 ' + nextCount + '건'];
    if (empty.length) out.push('· ⚠️ 평일인데 일정 없음: ' + empty.join(', '));
    if (test.length) out.push('· ⚠️ "(테스트)" 임시 데이터 남아있음: ' + test.join(', '));
    return out;
  } catch (err) {
    return [];
  }
}

/** 트리거가 매주 월요일 아침 실행하는 함수 */
function sendWeeklyReport() {
  var text = buildWeeklyAndDaily_(new Date());
  if (!text) {
    Logger.log('이번 주는 보고할 내용이 없어 전송을 건너뜁니다.');
    return;
  }
  // 월요일 메시지의 버튼은 기사 목록 페이지로 — 카톡엔 제목만 가고 본문은 거기서 본다
  sendKakaoMemo_(text, newsPageUrl_());
  props_().setProperty('LAST_WEEKLY_SENT', new Date().toISOString());
  Logger.log('주간 보고 전송 완료:\n' + text);
}

/**
 * 주간 보고 날 실제로 나가는 전문 = 그날의 매일 브리핑 + 주간 보고.
 * (그날은 매일 알림이 따로 나가지 않으므로 여기에 합쳐서 보낸다)
 */
function buildWeeklyAndDaily_(target) {
  var today = target || new Date();
  var news = fetchNewsBriefing_(ymd_(weekRange_(today).start));
  return [buildBriefing_(today), buildWeeklyReport_(today), news]
    .filter(function (t) { return !!t; })
    .join('\n\n');
}

/** 실제 전송 없이 이번 주 보고 내용만 확인 */
function previewWeeklyReport() {
  var text = buildWeeklyAndDaily_(new Date());
  Logger.log(text || '(이번 주는 보고할 내용이 없습니다)');
  return text;
}

/** 주간 보고가 예정된 요일(0=일~6=토). 주간 보고를 안 쓰면 null */
function weeklyDay_() {
  var v = prop_('WEEKLY_DAY', '');
  if (v === '') return null;
  var n = parseInt(v, 10);
  return (isNaN(n) || n < 0 || n > 6) ? null : n;
}

/**
 * 트리거가 매일 아침 실행하는 함수.
 * 주간 보고가 오는 날에는 건너뛴다 — 거의 같은 내용의 카톡이 연달아 두 개 오면
 * 그때부터 알림을 안 보게 되기 때문. 그날은 주간 보고 하나에 합쳐서 나간다.
 */
function sendDailyBriefing() {
  var today = new Date();
  if (weeklyDay_() === today.getDay()) {
    Logger.log('오늘은 주간 보고가 나가는 날이라 매일 알림은 건너뜁니다.');
    return;
  }
  var text = buildBriefing_(today);
  if (!text) {
    Logger.log('오늘은 보낼 내용이 없어 전송을 건너뜁니다.');
    return;
  }
  sendKakaoMemo_(text);
  props_().setProperty('LAST_BRIEF_SENT', new Date().toISOString());
  Logger.log('전송 완료:\n' + text);
}

/** 실제 전송 없이 오늘 어떤 메시지가 갈지 로그로만 확인 */
function previewBriefing() {
  var text = buildBriefing_(new Date());
  Logger.log(text || '(오늘은 보낼 내용이 없습니다)');
  return text;
}

/** 내일 것을 미리 보기 (테스트용) */
function previewTomorrow() {
  var text = buildBriefing_(addDays_(new Date(), 1));
  Logger.log(text || '(내일은 보낼 내용이 없습니다)');
  return text;
}

// ---------------------------------------------------------------------------
// 트리거
// ---------------------------------------------------------------------------

/** 매일 아침 알림 켜기 (기본 8시, setBriefHour()로 변경 가능) */
function installDailyTrigger() {
  removeDailyTrigger();
  var hour = parseInt(prop_('BRIEF_HOUR', '8'), 10);
  ScriptApp.newTrigger('sendDailyBriefing')
    .timeBased()
    .atHour(hour)
    .everyDays(1)
    .inTimezone(tz_())
    .create();
  Logger.log('매일 ' + hour + '시(' + tz_() + ') 알림 트리거를 설치했습니다.'
    + '\n※ 구글 트리거는 정확히 정시가 아니라 해당 시간대(예: 8~9시) 안에서 실행됩니다.');
}

/** 매주 월요일 아침 주간 보고 켜기 */
function installWeeklyTrigger() {
  removeWeeklyTrigger();
  var hour = parseInt(prop_('WEEKLY_HOUR', prop_('BRIEF_HOUR', '8')), 10);
  ScriptApp.newTrigger('sendWeeklyReport')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(hour)
    .inTimezone(tz_())
    .create();
  props_().setProperty('WEEKLY_DAY', '1');   // 월요일. 그날은 매일 알림이 비켜준다
  Logger.log('매주 월요일 ' + hour + '시(' + tz_() + ') 주간 보고 트리거를 설치했습니다.'
    + '\n※ 그날 아침에는 매일 알림이 따로 오지 않고, 주간 보고 하나에 합쳐서 옵니다.');
}

/** 주간 보고 끄기 */
function removeWeeklyTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendWeeklyReport') { ScriptApp.deleteTrigger(t); n++; }
  });
  props_().deleteProperty('WEEKLY_DAY');
  if (n) Logger.log('기존 주간 트리거 ' + n + '개를 제거했습니다.');
}

/** 주간 보고 요일/시각 변경. 예: setWeeklySchedule('금', 17) */
function setWeeklySchedule(dayKo, hour) {
  var map = { '일': 'SUNDAY', '월': 'MONDAY', '화': 'TUESDAY', '수': 'WEDNESDAY',
              '목': 'THURSDAY', '금': 'FRIDAY', '토': 'SATURDAY' };
  var key = map[String(dayKo || '').charAt(0)];
  if (!key) throw new Error('요일은 월~일 중 하나로 넣으세요. 예: setWeeklySchedule("금", 17)');
  var h = parseInt(hour, 10);
  if (isNaN(h) || h < 0 || h > 23) throw new Error('시각은 0~23 사이 숫자로 넣으세요.');

  removeWeeklyTrigger();
  props_().setProperty('WEEKLY_HOUR', String(h));
  ScriptApp.newTrigger('sendWeeklyReport')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay[key])
    .atHour(h)
    .inTimezone(tz_())
    .create();
  props_().setProperty('WEEKLY_DAY', String(DOW_KO.indexOf(String(dayKo).charAt(0))));
  Logger.log('주간 보고를 매주 ' + dayKo + '요일 ' + h + '시로 설정했습니다.'
    + '\n※ 그날 아침에는 매일 알림이 따로 오지 않고, 주간 보고 하나에 합쳐서 옵니다.');
}

/** 매일 아침 알림 끄기 */
function removeDailyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var n = 0;
  triggers.forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyBriefing') {
      ScriptApp.deleteTrigger(t);
      n++;
    }
  });
  if (n) Logger.log('기존 트리거 ' + n + '개를 제거했습니다.');
}

// ---------------------------------------------------------------------------
// 폰에서 빠르게 할 일 추가하기 (선택 기능)
// ---------------------------------------------------------------------------

/**
 * AppsScript_Code.gs 의 doGet 이 모르는 action을 여기로 넘겨준다.
 * 예: <웹앱URL>?action=addReminder&key=<SHARED_KEY>&title=대출신청&date=2026-09-21&before=3,1
 *     <웹앱URL>?action=addReminder&key=<SHARED_KEY>&title=주간보고&repeat=매주 금&time=17:00
 *     <웹앱URL>?action=briefNow&key=<SHARED_KEY>          (지금 당장 카톡 받기)
 * 처리할 수 없는 action이면 null을 돌려준다.
 */
function reminderDoGet_(e) {
  var p = e && e.parameter ? e.parameter : {};
  var action = p.action || '';
  if (action !== 'addReminder' && action !== 'briefNow') return null;

  var key = sharedKey_();
  if (key && p.key !== key) {
    return { ok: false, error: 'unauthorized' };
  }

  try {
    if (action === 'briefNow') {
      var text = buildBriefing_(new Date());
      if (!text) return { ok: true, sent: false, message: '보낼 내용이 없습니다' };
      sendKakaoMemo_(text);
      return { ok: true, sent: true };
    }

    var title = String(p.title || '').trim();
    if (!title) return { ok: false, error: 'title이 필요합니다' };
    getReminderSheet().appendRow([
      String(p.date || '').trim(),
      title,
      String(p.time || '').trim(),
      String(p.before || '').trim(),
      String(p.repeat || '').trim(),
      '',
      String(p.note || '').trim()
    ]);
    return { ok: true, added: title };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * AppsScript_Code.gs 의 doPost 가 모르는 action을 여기로 넘겨준다.
 * (doPost 는 이미 SHARED_KEY 를 검사한 뒤에 호출하므로 여기서 다시 검사하지 않는다)
 *
 * 바깥 시스템(Claude Code 주간 보고, 스크립트, 폰 단축어 등)이 아무 텍스트나
 * 내 카카오톡으로 밀어넣는 통로:
 *   POST <웹앱URL>  {"key":"<SHARED_KEY>", "action":"sendKakao", "text":"보낼 내용"}
 *   POST <웹앱URL>  {"key":"<SHARED_KEY>", "action":"weeklyNow"}
 * 처리할 수 없는 action이면 null을 돌려준다.
 */
function reminderDoPost_(body) {
  var action = body && body.action ? body.action : '';
  if (action !== 'sendKakao' && action !== 'weeklyNow') return null;

  try {
    if (action === 'weeklyNow') {
      var report = buildWeeklyReport_(new Date());
      if (!report) return { ok: true, sent: false, message: '보고할 내용이 없습니다' };
      return { ok: true, sent: true, chunks: sendKakaoMemo_(report) };
    }

    var text = String(body.text || '').trim();
    if (!text) return { ok: false, error: 'text가 비어 있습니다' };
    return { ok: true, sent: true, chunks: sendKakaoMemo_(text) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
