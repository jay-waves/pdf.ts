Unicode True

!include "MUI2.nsh"
!include "x64.nsh"
!include "Sections.nsh"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"

Var StartupCheckbox

!ifndef APP_VERSION
  !error "APP_VERSION must be provided with -DAPP_VERSION=<version>"
!endif
!ifndef APP_VERSION_QUAD
  !error "APP_VERSION_QUAD must be provided with -DAPP_VERSION_QUAD=<version>"
!endif
!ifndef LAUNCHER_FILE
  !error "LAUNCHER_FILE must be provided"
!endif
!ifndef ICON_FILE
  !error "ICON_FILE must be provided"
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
Icon "${ICON_FILE}"
UninstallIcon "${ICON_FILE}"

!define MUI_ABORTWARNING
!define MUI_ICON "${ICON_FILE}"
!define MUI_UNICON "${ICON_FILE}"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
Page custom StartupPage StartupPageLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

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
  File "${LAUNCHER_FILE}"
  Delete "$INSTDIR\pdf.ts-startup.cmd"
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

Section /o "-Startup" SEC_STARTUP
  SetShellVarContext all
  SetOutPath "$INSTDIR"
  ClearErrors
  CreateShortCut "$SMSTARTUP\pdf.ts.lnk" "$INSTDIR\${APP_EXE}" "daemon"
  IfErrors 0 +2
    Abort "Could not create the startup shortcut."
SectionEnd

Section "-Startup cleanup"
  ${IfNot} ${SectionIsSelected} ${SEC_STARTUP}
    SetShellVarContext all
    Delete "$SMSTARTUP\pdf.ts.lnk"
  ${EndIf}
SectionEnd

Function StartupPage
  !insertmacro MUI_HEADER_TEXT "Installation options" "Choose how ${APP_NAME} starts."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateCheckbox} 0 8u 100% 14u "Start background service at login"
  Pop $StartupCheckbox
  ${If} ${SectionIsSelected} ${SEC_STARTUP}
    ${NSD_Check} $StartupCheckbox
  ${EndIf}
  ${NSD_CreateLabel} 12u 30u 94% 36u "Applies to all users on this computer. Starts the background service without opening a browser window."
  Pop $0
  ${NSD_OnClick} $StartupCheckbox StartupChanged
  nsDialogs::Show
FunctionEnd

Function StartupChanged
  Pop $0
  Call StartupPageLeave
FunctionEnd

Function StartupPageLeave
  ${NSD_GetState} $StartupCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    !insertmacro SelectSection ${SEC_STARTUP}
  ${Else}
    !insertmacro UnselectSection ${SEC_STARTUP}
  ${EndIf}
FunctionEnd

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "pdf.ts requires 64-bit Windows."
    Abort
  ${EndIf}
  SetRegView 64
  SetShellVarContext all
  IfFileExists "$SMSTARTUP\pdf.ts.lnk" 0 startup_arguments
    !insertmacro SelectSection ${SEC_STARTUP}
startup_arguments:
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/AUTOSTART=" $1
  ${IfNot} ${Errors}
    ${If} $1 == "1"
      !insertmacro SelectSection ${SEC_STARTUP}
    ${ElseIf} $1 == "0"
      !insertmacro UnselectSection ${SEC_STARTUP}
    ${Else}
      Abort "Use /AUTOSTART=1 or /AUTOSTART=0."
    ${EndIf}
  ${EndIf}
FunctionEnd

Section "Uninstall"
  SetShellVarContext all
  IfFileExists "$INSTDIR\${APP_EXE}" 0 remove_files
  nsExec::ExecToLog '"$INSTDIR\${APP_EXE}" stop'

remove_files:
  Delete "$SMSTARTUP\pdf.ts.lnk"
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
