Unicode True

!include "MUI2.nsh"
!include "x64.nsh"

!ifndef APP_VERSION
  !error "APP_VERSION must be provided with -DAPP_VERSION=<version>"
!endif
!ifndef APP_VERSION_QUAD
  !error "APP_VERSION_QUAD must be provided with -DAPP_VERSION_QUAD=<version>"
!endif
!ifndef REPO_ROOT
  !error "REPO_ROOT must be provided with -DREPO_ROOT=<path>"
!endif
!ifndef OUTPUT_FILE
  !error "OUTPUT_FILE must be provided with -DOUTPUT_FILE=<path>"
!endif

!define APP_NAME "pdf.ts"
!define APP_EXE "pdf.ts.exe"
!define APP_ID "pdf.ts"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"

Name "${APP_NAME} ${APP_VERSION}"
OutFile "${OUTPUT_FILE}"
InstallDir "$PROGRAMFILES64\${APP_NAME}"
InstallDirRegKey HKLM "${UNINSTALL_KEY}" "InstallLocation"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
ManifestDPIAware true
VIProductVersion "${APP_VERSION_QUAD}"
VIAddVersionKey /LANG=1033 "ProductName" "${APP_NAME}"
VIAddVersionKey /LANG=1033 "ProductVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1033 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1033 "FileDescription" "${APP_NAME} installer"
VIAddVersionKey /LANG=1033 "LegalCopyright" "MIT License"
Icon "${REPO_ROOT}/assets/icon.ico"
UninstallIcon "${REPO_ROOT}/assets/icon.ico"

!define MUI_ABORTWARNING
!define MUI_ICON "${REPO_ROOT}/assets/icon.ico"
!define MUI_UNICON "${REPO_ROOT}/assets/icon.ico"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "pdf.ts requires 64-bit Windows."
    Abort
  ${EndIf}
  SetRegView 64
FunctionEnd

Function un.onInit
  SetRegView 64
FunctionEnd

Section "pdf.ts" SEC_MAIN
  SectionIn RO
  SetShellVarContext all

  IfFileExists "$INSTDIR\${APP_EXE}" 0 install_files
  nsExec::ExecToLog '"$INSTDIR\${APP_EXE}" stop'

install_files:
  SetOutPath "$INSTDIR"
  File "/oname=${APP_EXE}" "${REPO_ROOT}/release/${APP_EXE}"
  File "${REPO_ROOT}/packaging/windows/pdf.ts-startup.cmd"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  WriteRegStr HKLM "Software\Classes\${APP_ID}.Document" "" "pdf.ts Document"
  WriteRegStr HKLM "Software\Classes\${APP_ID}.Document\Application" "ApplicationName" "pdf.ts"
  WriteRegStr HKLM "Software\Classes\${APP_ID}.Document\Application" "ApplicationDescription" "Open PDF documents with pdf.ts"
  WriteRegStr HKLM "Software\Classes\${APP_ID}.Document\DefaultIcon" "" '"$INSTDIR\${APP_EXE}",0'
  WriteRegStr HKLM "Software\Classes\${APP_ID}.Document\shell\open\command" "" '"$INSTDIR\${APP_EXE}" open "%1"'
  WriteRegStr HKLM "Software\Classes\.pdf\OpenWithProgids" "${APP_ID}.Document" ""

  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\${APP_EXE}" "" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\${APP_EXE}" "Path" "$INSTDIR"

  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "Publisher" "jay-waves"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "URLInfoAbout" "https://github.com/jay-waves/pdf.ts"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE},0"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoRepair" 1

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
SectionEnd

Section "Uninstall"
  SetShellVarContext all
  IfFileExists "$INSTDIR\${APP_EXE}" 0 remove_files
  nsExec::ExecToLog '"$INSTDIR\${APP_EXE}" stop'

remove_files:
  DeleteRegKey HKLM "Software\Classes\${APP_ID}.Document"
  DeleteRegValue HKLM "Software\Classes\.pdf\OpenWithProgids" "${APP_ID}.Document"
  DeleteRegKey /ifempty HKLM "Software\Classes\.pdf\OpenWithProgids"
  DeleteRegKey /ifempty HKLM "Software\Classes\.pdf"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\${APP_EXE}"
  DeleteRegKey HKLM "${UNINSTALL_KEY}"

  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\pdf.ts-startup.cmd"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
SectionEnd
