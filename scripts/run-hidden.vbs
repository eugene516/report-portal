' 예약 작업용: 명령 창 없이 node 스크립트를 실행하고 끝날 때까지 기다린 뒤 종료 코드를 그대로 돌려준다
' 사용: wscript.exe run-hidden.vbs "C:\...\node.exe" "C:\...\script.mjs" [인수...]
Dim sh, args, cmd, i
Set sh = CreateObject("WScript.Shell")
Set args = WScript.Arguments
cmd = ""
For i = 0 To args.Count - 1
  cmd = cmd & """" & args(i) & """ "
Next
WScript.Quit sh.Run(cmd, 0, True)
