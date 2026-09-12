#!/usr/bin/env bash
#
# Docker Status plasmoid installer.
#
# The plasmoid install and the polkit rule are deliberately SEPARATE commands.
# The first is unprivileged and trivially reversible; the second is a
# system-wide privilege grant and therefore never happens implicitly.
#
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PACKAGE_ID="io.github.daver-ui.dockerstatus"
readonly PACKAGE_SOURCE="${SCRIPT_DIR}/package/${PACKAGE_ID}"
readonly POLKIT_SOURCE="${SCRIPT_DIR}/polkit/49-docker-status-widget.rules"
readonly POLKIT_TARGET="/etc/polkit-1/rules.d/49-docker-status-widget.rules"

usage() {
    cat <<'EOF'
Usage: install.sh <command>

Commands:
  install          Install or upgrade the plasmoid for the current user.
  uninstall        Remove the plasmoid for the current user.
  install-polkit   Install the scoped polkit rule (needs sudo).
  remove-polkit    Remove the polkit rule (needs sudo).
  test             Run the Node unit tests for the parsing logic.
  status           Report what is currently installed.

EOF
}

has_kpackagetool() {
    command -v kpackagetool6 >/dev/null 2>&1
}

cmd_install() {
    if has_kpackagetool; then
        if kpackagetool6 --type Plasma/Applet --show "${PACKAGE_ID}" >/dev/null 2>&1; then
            kpackagetool6 --type Plasma/Applet --upgrade "${PACKAGE_SOURCE}"
            echo "Upgraded ${PACKAGE_ID}."
        else
            kpackagetool6 --type Plasma/Applet --install "${PACKAGE_SOURCE}"
            echo "Installed ${PACKAGE_ID}."
        fi
    else
        local target="${XDG_DATA_HOME:-${HOME}/.local/share}/plasma/plasmoids/${PACKAGE_ID}"
        rm -rf "${target}"
        mkdir -p "${target}"
        cp -r "${PACKAGE_SOURCE}/." "${target}/"
        echo "kpackagetool6 unavailable; copied the package to ${target}."
    fi

    cat <<'EOF'

Next step: right-click the panel or desktop, "Add Widgets…", search for
"Docker Status". If it does not appear, restart plasmashell:

    kquitapp6 plasmashell && kstart plasmashell

The "Start daemon" button will ask for your password via polkit until you
run:  ./install.sh install-polkit
EOF
}

cmd_uninstall() {
    if has_kpackagetool; then
        kpackagetool6 --type Plasma/Applet --remove "${PACKAGE_ID}"
        echo "Removed ${PACKAGE_ID}."
    else
        rm -rf "${XDG_DATA_HOME:-${HOME}/.local/share}/plasma/plasmoids/${PACKAGE_ID}"
        echo "Removed ${PACKAGE_ID} (plain copy)."
    fi
    echo "Note: remove the widget from the panel/desktop first if it is still placed."
}

cmd_install_polkit() {
    [[ -f "${POLKIT_SOURCE}" ]] || { echo "Missing ${POLKIT_SOURCE}" >&2; exit 1; }
    sudo install -o root -g root -m 0644 "${POLKIT_SOURCE}" "${POLKIT_TARGET}"
    sudo systemctl restart polkit 2>/dev/null || sudo systemctl restart polkitd 2>/dev/null || true

    echo "Installed ${POLKIT_TARGET}"
    if ! sudo -n true 2>/dev/null; then
        echo "(sudo needed a password; that is expected and fine.)"
    fi
    cat <<EOF

Verify with:  pkcheck --action-id org.freedesktop.systemd1.manage-units \\
                      --process \$\$ --detail unit docker.service \\
                      --detail verb start
EOF
}

cmd_remove_polkit() {
    sudo rm -f "${POLKIT_TARGET}"
    sudo systemctl restart polkit 2>/dev/null || sudo systemctl restart polkitd 2>/dev/null || true
    echo "Removed ${POLKIT_TARGET}"
}

cmd_test() {
    node --test "${SCRIPT_DIR}/tests/"
}

cmd_status() {
    echo "== plasmoid =="
    if has_kpackagetool && kpackagetool6 --type Plasma/Applet --show "${PACKAGE_ID}" >/dev/null 2>&1; then
        kpackagetool6 --type Plasma/Applet --show "${PACKAGE_ID}"
    else
        echo "not installed (or kpackagetool6 unavailable)"
    fi

    echo
    echo "== polkit rule =="
    if [[ -f "${POLKIT_TARGET}" ]]; then
        ls -l "${POLKIT_TARGET}"
    else
        echo "not installed -- the start button will prompt for a password"
    fi

    echo
    echo "== docker unit =="
    systemctl is-active docker 2>&1 || true
    systemctl is-enabled docker 2>&1 || true
}

case "${1:-}" in
    install)        cmd_install ;;
    uninstall)      cmd_uninstall ;;
    install-polkit) cmd_install_polkit ;;
    remove-polkit)  cmd_remove_polkit ;;
    test)           cmd_test ;;
    status)         cmd_status ;;
    ""|-h|--help|help) usage ;;
    *) echo "Unknown command: $1" >&2; usage; exit 2 ;;
esac
