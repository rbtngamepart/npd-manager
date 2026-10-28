// 각자 script.google.com 에 붙여넣는 Apps Script 코드 (연결 코드 포함)

export function buildAppsScript(origin: string, token: string): string {
  return `/**
 * 게임파트 NPD ← 구글 캘린더 연동
 * 내 캘린더에서 제목이 [말머리] 로 시작하는 일정만 골라 NPD로 보냅니다. (다른 일정은 보내지 않음)
 *
 * 처음 한 번: 위쪽 함수 목록에서 setup 을 고르고 ▶ 실행 → 권한 허용
 * 이후에는 30분마다 자동으로 보냅니다. 지금 바로 보내려면 syncNow 를 실행하세요.
 * 그만 쓰려면 uninstall 을 실행하세요.
 */

const NPD_URL = '${origin}/api/calendar/push';
const NPD_TOKEN = '${token}'; // 연결 코드 — 다른 사람과 공유하지 마세요

// 읽을 캘린더. 비워 두면 내 기본 캘린더만 읽습니다.
// 다른 캘린더도 읽으려면 캘린더 설정의 '캘린더 ID'를 넣으세요. 예: ['abc123@group.calendar.google.com']
const CALENDAR_IDS = [];

const PAST_DAYS = 180;   // 과거 며칠까지
const FUTURE_DAYS = 400; // 앞으로 며칠까지
const TAG_RE = /^\\s*[\\[【［]\\s*[^\\]】］]+?\\s*[\\]】］]/;

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncNow') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncNow').timeBased().everyMinutes(30).create();
  syncNow();
  Logger.log('설치 완료: 이제 30분마다 자동으로 보냅니다.');
}

function syncNow() {
  var now = new Date();
  var from = new Date(now.getTime() - PAST_DAYS * 864e5);
  var to = new Date(now.getTime() + FUTURE_DAYS * 864e5);
  var events = [];
  var total = 0;
  var names = [];
  try {
    var cals = CALENDAR_IDS.length
      ? CALENDAR_IDS.map(function (id) {
          var c = CalendarApp.getCalendarById(id);
          if (!c) throw new Error('캘린더를 찾을 수 없습니다: ' + id);
          return c;
        })
      : [CalendarApp.getDefaultCalendar()];
    cals.forEach(function (cal) {
      names.push(cal.getName());
      var tz = cal.getTimeZone();
      cal.getEvents(from, to).forEach(function (e) {
        total++;
        var title = e.getTitle() || '';
        if (!TAG_RE.test(title)) return;
        var allDay = e.isAllDayEvent();
        events.push({
          id: e.getId(),
          recurring: e.isRecurringEvent(),
          title: title,
          description: e.getDescription() || '',
          allDay: allDay,
          start: allDay ? Utilities.formatDate(e.getAllDayStartDate(), tz, 'yyyy-MM-dd') : e.getStartTime().toISOString(),
          end: allDay ? Utilities.formatDate(e.getAllDayEndDate(), tz, 'yyyy-MM-dd') : e.getEndTime().toISOString(),
          creators: e.getCreators(),
          guests: e.getGuestList(true).map(function (g) { return g.getEmail(); })
        });
      });
    });
  } catch (err) {
    try { send_({ error: String((err && err.message) || err) }); } catch (ignore) {}
    throw err;
  }
  var res = send_({
    calendars: names,
    from: Utilities.formatDate(from, 'Asia/Seoul', 'yyyy-MM-dd'),
    to: Utilities.formatDate(to, 'Asia/Seoul', 'yyyy-MM-dd'),
    total: total,
    events: events
  });
  Logger.log('전체 일정 ' + total + '개 중 말머리 일정 ' + events.length + '개를 보냈습니다.');
  Logger.log(res);
}

function uninstall() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  Logger.log('자동 전송을 껐습니다.');
}

function send_(body) {
  body.token = NPD_TOKEN;
  var r = UrlFetchApp.fetch(NPD_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  var text = r.getContentText();
  if (r.getResponseCode() >= 400) throw new Error('NPD 전송 실패 (' + r.getResponseCode() + '): ' + text);
  return text;
}
`;
}
