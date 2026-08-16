# KT ds 교육센터 2층 로비 안내 화면

1920×1080 터치스크린 키오스크용 안내 화면. 교육 수강생이 오늘의 교육과정과 강의장 위치를 확인하는 것이 핵심 목적.

작업을 이어받았다면 **[인수인계.md](인수인계.md)를 먼저 읽어** 전체 히스토리와 지금까지의 의사결정 배경을 파악할 것.

## 절대 유지해야 하는 것

- 전체 디자인 톤과 색상, 1920×1080 전체화면 기준 레이아웃
- 강의실 201~212호 배치, 사무실/로비/엘리베이터/입구 위치, 기존 강의장 도면 이미지
- 구역 색상: 201-203 협업·소통(R), 204-206 혁신기술(G), 207-212 실무실습(B)
- 기존 코드를 임의로 대규모 재작성하지 않는다 — 최소 범위 수정 원칙

## 파일 구조

- **index.html** — 실제 서비스 파일 (단일 파일, 강의장 도면 이미지가 base64로 내장됨)
- **_artifact_preview.html** — claude.ai 아티팩트 게시용 사본. **index.html을 수정하면 반드시 이 파일도 동일하게 수정할 것** (자동 동기화 안 됨, 수동으로 두 파일 다 고쳐야 함)
- **AppsScript_Code.gs** — Google Sheet 연동 백엔드 템플릿. `SHARED_KEY`는 항상 플레이스홀더(`CHANGE_ME_BEFORE_DEPLOY`)로만 커밋하고, 실제 값은 Apps Script 편집기에서만 설정한다
- **assets/floor_plan_2f.png** — 강의장 위치 원본 이미지 (index.html에도 내장돼 있어 이 파일은 백업용)
- **_devserver.js** — 로컬 정적 서버 (`node _devserver.js`, port 5588). `.claude/launch.json`에 `lobby-devserver`로 등록되어 있어 preview_start로 바로 띄울 수 있음
- **SECRETS.local.md** — 실제 배포 URL/키 등 민감정보. `.gitignore`에 등록되어 git에는 절대 안 올라감. 새 세션에서 실배포 정보가 필요하면 이 파일을 확인할 것 (없으면 사용자에게 물어볼 것)

## 절대 하지 말 것 — 보안

**실제 Apps Script 배포 URL이나 SHARED_KEY 값을 index.html/_artifact_preview.html의 기본 설정값(`loadSettings()`)에 하드코딩하지 말 것.** 이 저장소는 GitHub 공개(Public) 저장소라서 커밋하는 즉시 전 세계에 노출된다. (2026-08-16에 실제로 이 실수를 했다가 키를 교체한 사건이 있었음 — 인수인계.md 참고)

키/URL을 배포하려면 반드시 "설정 공유 링크" 방식을 쓴다: `?api=...&key=...` 쿼리 파라미터로 열면 `initFromQuery()`가 그 브라우저의 localStorage에만 저장하고 즉시 URL에서 파라미터를 제거한다 (index.html 하단 초기화 블록 참고). 이 방식은 소스코드에 값이 남지 않는다.

## 배포 상태 (2026-08-16 기준)

- GitHub 저장소: https://github.com/ktdscon/ktds_lobby (Public, `ktdscon` 계정)
- GitHub Pages 배포 주소: https://ktdscon.github.io/ktds_lobby/
- 이 PC에 GitHub CLI(`gh`)가 `ktdscon` 계정으로 인증되어 있음 — 커밋 후 `git push origin main`이면 바로 반영됨
- Apps Script 웹앱: 배포는 되어 있음. 실제 URL/키는 SECRETS.local.md 참고 (git에는 없음)
- 구글시트 "Schedule" 탭: 8~9월 실제 데이터 반영됨, 10~12월은 "(테스트)" 표시된 임시 데이터만 있음 (인수인계.md의 "남은 일" 확인)

## 데이터 흐름 요약

관리자 모드(우하단 톱니, PIN 기본 1234) → 설정/동기화·붙여넣기·검토&게시·일정 수정·웰컴 영상 5탭.

**웰컴 영상**(VIP 방문 대응): mp4 파일 + 시작/종료 일시를 설정하면 그 기간 동안 전체화면 영상이 자동 재생되고, 화면 터치나 기간 종료 시 자동 복귀. 영상 파일은 IndexedDB에 저장되는 **로컬(그 PC 브라우저) 전용** 기능 — 구글시트/GitHub에는 안 올라가고 팀원 노트북에서도 안 보임. 관련 상태 변수(`welcomeVideoActive` 등)는 파일 상단 다른 `let` 변수들과 함께 선언되어 있음 — `tickClock()`이 즉시 실행되므로 이 변수들을 파일 하단으로 옮기면 TDZ 에러가 남, 주의할 것.

- **붙여넣기**: HRCMS "강의장 스케쥴" 화면을 탭 구분자 그대로 복사→붙여넣기 → 요일까지 전부 자동 인식되면 검토 화면 없이 바로 게시됨 (`parseCalendarPaste`/`parseBtn` 핸들러 참고)
- 월별로 한 번씩 반복하면 됨 (8월 화면 붙여넣기→게시, 9월 화면 붙여넣기→게시, ...). 게시는 붙여넣은 내용에 포함된 날짜만 덮어쓰므로 다른 달 데이터는 안전함
- **일정 수정** 탭에서 개별 항목의 날짜를 바꾸면 그 날짜로 "이동"(원래 날짜에서 삭제 + 새 날짜의 기존 항목에 추가)됨 — 통째로 다시 붙여넣을 필요 없음
- 자정이 지나면(`tickClock`의 day-rollover 로직) 화면이 "오늘"을 보고 있던 경우에 한해 자동으로 다음 날 일정으로 넘어감 — 관리자가 매일 손댈 필요 없음

## 로컬 개발/테스트

`preview_start`로 `lobby-devserver` 실행 후 `http://localhost:5588`. 코드 수정 후에는 브라우저에서 실제로 열어서 콘솔 에러·레이아웃을 확인할 것 (특히 1920×1080 기준과, 좁은 미리보기에서의 `fitAppScale()` 축소 동작).
