/**
 * KT ds 교육센터 로비 안내 시스템 - Google Sheets 백엔드
 *
 * 사용법
 * 1) 구글 시트를 새로 만든다 (이름은 자유, 예: "KT ds 교육센터 일정")
 * 2) 확장 프로그램 > Apps Script 를 열고, 기본 코드를 모두 지운 뒤 이 파일 내용을 그대로 붙여넣는다
 * 3) 아래 SHARED_KEY 값을 원하는 문자열로 바꾼다 (팀 내부용 간단한 접근 키)
 * 4) 저장 후 배포 > 새 배포 > 유형: 웹앱
 *    - 실행 사용자: 나
 *    - 액세스 권한: 전체 공개 (익명 사용자 포함)
 * 5) 배포하면 나오는 웹 앱 URL을 복사해서, 안내 화면(index.html)의 "관리자 설정"에 붙여넣는다
 *
 * 시트는 처음 실행될 때 "Schedule" 탭과 헤더 행을 자동으로 만든다. 손대지 않아도 된다.
 */

var SHEET_NAME = 'Schedule';
// 이 파일은 공개(Public) GitHub 저장소에도 올라갑니다. 아래 값을 절대 실제 사용할 키로 커밋하지 말고,
// Apps Script 편집기(script.google.com)에 붙여넣은 뒤 거기서만 실제 키로 바꿔서 배포하세요.
var SHARED_KEY = 'CHANGE_ME_BEFORE_DEPLOY';

function doGet(e) {
  var action = (e.parameter.action || 'list');
  if (action === 'list') {
    return respond({ ok: true, items: readAll() });
  }
  if (action === 'ping') {
    return respond({ ok: true, pong: true, time: new Date().toISOString() });
  }
  // 카카오 아침 알림(KakaoReminder.gs)이 같은 프로젝트에 있으면 그쪽 action도 처리하게 넘긴다
  if (typeof reminderDoGet_ === 'function') {
    var handled = reminderDoGet_(e);
    if (handled) return respond(handled);
  }
  return respond({ ok: false, error: 'unknown action: ' + action });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return respond({ ok: false, error: 'invalid json body' });
  }

  if (SHARED_KEY && body.key !== SHARED_KEY) {
    return respond({ ok: false, error: 'unauthorized' });
  }

  var action = body.action;
  try {
    if (action === 'bulkReplace') {
      var days = body.days || {};
      Object.keys(days).forEach(function (date) {
        replaceDate(date, days[date] || []);
      });
    } else if (action === 'replaceDate') {
      replaceDate(body.date, body.items || []);
    } else if (action === 'deleteDate') {
      replaceDate(body.date, []);
    } else {
      return respond({ ok: false, error: 'unknown action: ' + action });
    }
  } catch (err) {
    return respond({ ok: false, error: String(err) });
  }

  return respond({ ok: true, items: readAll() });
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['id', 'date', 'room', 'group', 'title', 'session', 'updatedAt']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readAll() {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var items = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (!row[1]) continue;
    items.push({
      id: String(row[0]),
      date: formatDate(row[1]),
      room: String(row[2]),
      group: row[3] ? String(row[3]) : '',
      title: row[4] ? String(row[4]) : '',
      session: row[5] ? String(row[5]) : ''
    });
  }
  return items;
}

function formatDate(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v);
}

function replaceDate(date, items) {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  // 기존에 해당 날짜인 행들을 아래에서 위로 삭제 (인덱스 밀림 방지)
  if (lastRow >= 2) {
    var values = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
    for (var i = values.length - 1; i >= 0; i--) {
      if (formatDate(values[i][1]) === date) {
        sheet.deleteRow(i + 2);
      }
    }
  }
  var now = new Date();
  items.forEach(function (item) {
    sheet.appendRow([Utilities.getUuid(), date, item.room || '', item.group || '', item.title || '', item.session || '', now]);
  });
}

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
