# 리포트 포털 예약 작업 등록 (이 PC, 현재 로그인한 사용자로 실행)
#   ReportPortal-DailyCheck    매일 09:30  ego-browser 지표 점검 (scripts/daily-check.mjs)
#   ReportPortal-MonthlyExport 매일 10:00 확인 → 지난달 리포트 엑셀이 아직 없으면 G 드라이브에 저장 (scripts/export-monthly.mjs --auto)
# ego-browser 를 쓰므로 "사용자가 로그온되어 있을 때만" 실행된다. PC가 꺼져 있었다면 켜진 뒤 바로 한 번 실행한다(StartWhenAvailable).
# 실행: powershell -ExecutionPolicy Bypass -File scripts\schedule-tasks.ps1
$ErrorActionPreference = "Stop"
$app  = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
$user = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

# 명령 창 없이 백그라운드로 실행한다 (창을 닫으면 점검이 중단되던 문제: 종료 코드 0xC000013A)
$hidden = "$env:SystemRoot\System32\wscript.exe"
$wrap = "`"$app\scripts\run-hidden.vbs`" `"$node`""
$daily = New-ScheduledTaskAction -Execute $hidden -Argument "$wrap `"$app\scripts\daily-check.mjs`"" -WorkingDirectory $app
Register-ScheduledTask -TaskName "ReportPortal-DailyCheck" -Action $daily -Trigger (New-ScheduledTaskTrigger -Daily -At 9:30am) `
  -Settings $settings -Principal $principal -Description "리포트 포털: 매일 09:30 블로그·플레이스 순위, 카페·당근 게시글, 포털 화면 점검 (ego-browser)" -Force | Out-Null

# 월 1회 내보내기: 매일 10:00 에 확인하고, 지난달 파일이 아직 없을 때만 만든다(--auto)
#   → 1일에 PC가 꺼져 있어도 켜진 첫날 저장된다
$monthly = New-ScheduledTaskAction -Execute $hidden -Argument "$wrap `"$app\scripts\export-monthly.mjs`" --auto" -WorkingDirectory $app
Register-ScheduledTask -TaskName "ReportPortal-MonthlyExport" -Action $monthly -Trigger (New-ScheduledTaskTrigger -Daily -At 10:00am) `
  -Settings $settings -Principal $principal -Description "리포트 포털: 지난달 리포트 엑셀을 G 드라이브 monthly-reports 에 저장 (매월 처음 한 번)" -Force | Out-Null

Get-ScheduledTask -TaskName "ReportPortal-*" | ForEach-Object {
  $i = $_ | Get-ScheduledTaskInfo
  "{0}  다음 실행: {1}" -f $_.TaskName, $i.NextRunTime
}
