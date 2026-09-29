# Pokazuje toast Windows (bez zewnetrznych modulow). Wolane przez
# dobij-wczoraj.js do powiadomien o starcie/postepie/crashu/koncu joba WZ.
# Uwaga: toast pojawia sie tylko w INTERAKTYWNEJ sesji zalogowanego uzytkownika
# (gdy zadanie leci "Interactive only" i jestes zalogowany). Przy "uruchom
# niezaleznie od zalogowania" toasty sie nie wyswietla (brak pulpitu) - wtedy
# powiadomieniem jest sam log.
param(
  [string]$Title = "Savpol WZ",
  [string]$Message = ""
)
try {
  $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
    [Windows.UI.Notifications.ToastTemplateType]::ToastText02)
  $t = $xml.GetElementsByTagName("text")
  $t.Item(0).AppendChild($xml.CreateTextNode($Title)) | Out-Null
  $t.Item(1).AppendChild($xml.CreateTextNode($Message)) | Out-Null
  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
  # AUMID PowerShella - pozwala pokazac toast bez rejestrowania wlasnej apki.
  $appId = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
} catch {
  # Fallback: balonik z zasobnika (starszy, ale dziala wszedzie).
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $n = New-Object System.Windows.Forms.NotifyIcon
    $n.Icon = [System.Drawing.SystemIcons]::Information
    $n.Visible = $true
    $n.ShowBalloonTip(6000, $Title, $Message, [System.Windows.Forms.ToolTipIcon]::Info)
    Start-Sleep -Seconds 7
    $n.Dispose()
  } catch { }
}
