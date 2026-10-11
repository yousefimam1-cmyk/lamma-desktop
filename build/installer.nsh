; Run the setup again after LAMMA is installed? Skip the install and just open the game.
; (A newer setup version still installs as an update.)
!macro customInit
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" DisplayVersion
  ${If} $0 != ""
  ${AndIf} $1 == "${VERSION}"
  ${AndIf} ${FileExists} "$0\${APP_EXECUTABLE_FILENAME}"
    Exec '"$0\${APP_EXECUTABLE_FILENAME}"'
    Quit
  ${EndIf}
!macroend
