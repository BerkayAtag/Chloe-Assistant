; Chloe Assistant — Windows kurulumu (Inno Setup 6).
; windows\build-setup.ps1 önce dist\windows\stage klasörünü hazırlar, sonra bu betiği derler.
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#define MyAppName "Chloe Assistant"
#define MyAppPublisher "Berkay Atağ"
#define MyAppExeName "Chloe.exe"
#define Stage "..\dist\windows\stage"

[Setup]
AppId={{4C2F8E61-9B3D-4E57-A0C8-6D1F2B7A9E34}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL=https://berkayatag.github.io/Chloe-Assistant/
AppSupportURL=https://github.com/BerkayAtag/Chloe-Assistant/issues
; Kullanıcı başına kurulum: yönetici izni gerekmez, uygulama kendi veri klasörüne yazabilir.
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\Chloe Assistant
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableWelcomePage=yes
UsePreviousAppDir=yes
OutputDir=..\dist\windows
OutputBaseFilename=Chloe.Assistant.Setup-{#MyAppVersion}
SetupIconFile={#Stage}\Chloe.ico
UninstallDisplayIcon={app}\Chloe.ico
UninstallDisplayName={#MyAppName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
CloseApplications=force
RestartApplications=no
VersionInfoVersion={#MyAppVersion}.0
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} Kurulum
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}

[Languages]
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl"

[Tasks]
Name: "desktopicon"; Description: "Masaüstüne kısayol oluştur"; GroupDescription: "Kısayollar:"

[InstallDelete]
; Eski sürümün derlenmiş sunucusu temizlenir; kullanıcı verisi (app\data, app\public içindeki avatar) korunur.
Type: filesandordirs; Name: "{app}\app\.next-win"
Type: filesandordirs; Name: "{app}\app\node_modules"
Type: files; Name: "{app}\app\server.js"

[UninstallDelete]
; Sunucunun çalışırken ürettiği önbellek kaldırılır; app\data içindeki kullanıcı verisi korunur.
Type: filesandordirs; Name: "{app}\app\.next-win"

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Chloe Assistant"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\Chloe.ico"; Comment: "Kişisel yapay zekâ çalışma alanı"
Name: "{autodesktop}\Chloe Assistant"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\Chloe.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Chloe Assistant'ı başlat"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Açık kalmış yerel sunucu dosyaları kilitlemesin.
; Sunucu ayrı adlı bir Node kopyasıyla çalışır; kullanıcının diğer node.exe süreçlerine dokunulmaz.
Filename: "{sys}\taskkill.exe"; Parameters: "/F /T /IM chloe-node.exe"; Flags: runhidden; RunOnceId: "StopChloeServer"
