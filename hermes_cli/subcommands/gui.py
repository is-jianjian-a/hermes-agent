"""``hermes gui`` subcommand parser.

Extracted verbatim from ``hermes_cli/main.py:main()`` (god-file Phase 2).
Handler injected to avoid importing ``main``.
"""

from __future__ import annotations

from typing import Callable


def build_gui_parser(subparsers, *, cmd_gui: Callable) -> None:
    """Attach the ``gui`` subcommand to ``subparsers``."""
    # =========================================================================
    gui_parser = subparsers.add_parser(
        "desktop",
        aliases=["gui"],
        help="Build and launch the native desktop app",
        description=(
            "Launch the Hermes Electron desktop app. By default this installs "
            "workspace Node dependencies, builds the current OS's unpacked "
            "Electron app, then launches that packaged artifact."
        ),
    )
    gui_parser.add_argument(
        "--source",
        action="store_true",
        help="Launch via `electron .` against apps/desktop/dist instead of the packaged app",
    )
    gui_parser.add_argument(
        "--build-only",
        action="store_true",
        help="Build the desktop app but do not launch it (used by the installer's --update flow)",
    )
    gui_parser.add_argument(
        "--fake-boot",
        action="store_true",
        help="Enable deterministic desktop boot delays for validating startup UI",
    )
    gui_parser.add_argument(
        "--ignore-existing",
        action="store_true",
        help="Force Desktop to ignore any hermes CLI already on PATH during backend resolution",
    )
    gui_parser.add_argument(
        "--hermes-root",
        help="Override the Hermes source root used by Desktop (sets HERMES_DESKTOP_HERMES_ROOT)",
    )
    gui_parser.add_argument(
        "--cwd",
        help="Initial project directory for Desktop chat sessions (sets HERMES_DESKTOP_CWD)",
    )
    gui_parser.add_argument(
        "--skip-build",
        action="store_true",
        help="Skip npm install/package and launch the existing unpacked app from apps/desktop/release",
    )
    gui_parser.add_argument(
        "--force-build",
        action="store_true",
        help="Force a full rebuild even if the content stamp matches",
    )
    gui_parser.add_argument(
        "--companion",
        choices=["island", "center"],
        help="Open the Companion window instead of focusing the main Desktop window",
    )
    gui_parser.set_defaults(func=cmd_gui)

    companion_parser = subparsers.add_parser(
        "companion",
        help="Open the always-on-top Hermes Companion session monitor",
        description=(
            "Build or reuse Hermes Desktop, then open its Companion window. "
            "Use --center to open the full Session Center."
        ),
    )
    companion_parser.add_argument(
        "--center",
        action="store_true",
        help="Open the full Session Center instead of the compact monitor",
    )
    companion_parser.add_argument(
        "--source",
        action="store_true",
        help="Launch via the source Electron build instead of the packaged app",
    )
    companion_parser.add_argument(
        "--skip-build",
        action="store_true",
        help="Reuse an existing source/package build",
    )
    companion_parser.add_argument(
        "--force-build",
        action="store_true",
        help="Force a full Desktop rebuild before opening Companion",
    )
    companion_parser.set_defaults(
        func=cmd_gui,
        companion_command=True,
        build_only=False,
        fake_boot=False,
        ignore_existing=False,
        hermes_root=None,
        cwd=None,
    )
