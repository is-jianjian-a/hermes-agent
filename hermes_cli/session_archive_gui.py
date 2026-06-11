"""Session archive manager — native tkinter GUI.

Displays sessions in a scrollable list. Each session can be expanded to
show recent messages. Archive/unarchive with a button click.
"""

import tkinter as tk
from tkinter import ttk, messagebox
from typing import List, Dict, Any, Optional


def _relative_time(ts: Optional[str]) -> str:
    """Human-readable relative time from ISO timestamp."""
    if not ts:
        return ""
    try:
        from datetime import datetime
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        now = datetime.now(dt.tzinfo)
        delta = now - dt
        if delta.days > 365:
            return f"{delta.days // 365}y ago"
        if delta.days > 30:
            return f"{delta.days // 30}mo ago"
        if delta.days > 0:
            return f"{delta.days}d ago"
        hours = delta.seconds // 3600
        if hours > 0:
            return f"{hours}h ago"
        mins = delta.seconds // 60
        if mins > 0:
            return f"{mins}m ago"
        return "just now"
    except Exception:
        return ts[:16]


class SessionArchiveGUI:
    def __init__(self, db):
        self.db = db
        self.root = tk.Tk()
        self.root.title("Hermes Session Archive Manager")
        self.root.geometry("900x700")
        self.root.minsize(700, 500)

        # Top controls
        control_frame = ttk.Frame(self.root, padding=10)
        control_frame.pack(fill=tk.X)

        self.hide_archived_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(
            control_frame,
            text="Hide archived",
            variable=self.hide_archived_var,
            command=self._refresh_list,
        ).pack(side=tk.LEFT)

        ttk.Separator(self.root, orient=tk.HORIZONTAL).pack(fill=tk.X)

        # Session list (scrollable)
        list_frame = ttk.Frame(self.root)
        list_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=5)

        self.canvas = tk.Canvas(list_frame, highlightthickness=0)
        scrollbar = ttk.Scrollbar(list_frame, orient=tk.VERTICAL, command=self.canvas.yview)
        self.scrollable_frame = ttk.Frame(self.canvas)

        self.scrollable_frame.bind(
            "<Configure>",
            lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all")),
        )

        self.canvas.create_window((0, 0), window=self.scrollable_frame, anchor=tk.NW, width=860)
        self.canvas.configure(yscrollcommand=scrollbar.set)

        self.canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        # Mouse wheel scroll
        self.canvas.bind_all("<MouseWheel>", lambda e: self.canvas.yview_scroll(int(-1 * (e.delta / 120)), "units"))

        # Status bar
        self.status_var = tk.StringVar(value="Loading...")
        status_bar = ttk.Label(self.root, textvariable=self.status_var, relief=tk.SUNKEN, anchor=tk.W)
        status_bar.pack(fill=tk.X, side=tk.BOTTOM)

        self.session_cards: List[Dict[str, Any]] = []
        self._refresh_list()

    def _refresh_list(self):
        """Reload sessions from DB and rebuild the list."""
        # Clear existing cards
        for widget in self.scrollable_frame.winfo_children():
            widget.destroy()
        self.session_cards.clear()

        hide_archived = self.hide_archived_var.get()
        sessions = self.db.list_sessions_rich(include_archived=True, limit=500)

        if hide_archived:
            sessions = [s for s in sessions if not s.get("archived", 0)]

        total = len(sessions)
        archived_count = sum(1 for s in sessions if s.get("archived", 0))
        self.status_var.set(f"{total} sessions | {archived_count} archived")

        if not sessions:
            ttk.Label(self.scrollable_frame, text="No sessions found.", padding=20).pack()
            return

        for s in sessions:
            self._create_session_card(s)

    def _create_session_card(self, session: Dict[str, Any]):
        """Create a collapsible card for a single session."""
        card = ttk.Frame(self.scrollable_frame, relief=tk.GROOVE, padding=10)
        card.pack(fill=tk.X, pady=3, padx=5)

        sid = session["id"]
        title = (session.get("title") or "").strip()
        preview = (session.get("preview") or "").strip()
        msg_count = session.get("message_count", 0)
        last_active = _relative_time(session.get("last_active"))
        archived = bool(session.get("archived", 0))

        display_name = title or preview or sid[:20]

        # Header row
        header = ttk.Frame(card)
        header.pack(fill=tk.X)

        # Title + badge
        name_label = ttk.Label(header, text=display_name, font=("Helvetica", 12, "bold"))
        name_label.pack(side=tk.LEFT)

        if archived:
            badge = ttk.Label(header, text="[ARCHIVED]", foreground="red", font=("Helvetica", 9, "bold"))
            badge.pack(side=tk.LEFT, padx=(10, 0))

        # Meta info
        meta = ttk.Label(
            header,
            text=f"{msg_count} msgs  |  {last_active}  |  {sid}",
            foreground="gray",
        )
        meta.pack(side=tk.RIGHT)

        # Button row
        btn_frame = ttk.Frame(card)
        btn_frame.pack(fill=tk.X, pady=(5, 0))

        # Toggle archive button
        arch_btn_text = "Unarchive" if archived else "Archive"
        arch_btn = ttk.Button(
            btn_frame,
            text=arch_btn_text,
            command=lambda sid=sid, card=card: self._toggle_archive(sid, card),
        )
        arch_btn.pack(side=tk.LEFT, padx=(0, 5))

        # Expand/collapse messages button
        expand_var = tk.BooleanVar(value=False)
        expand_btn = ttk.Button(
            btn_frame,
            text="Show recent messages ▼",
            command=lambda sid=sid, card=card, var=expand_var: self._toggle_messages(sid, card, var),
        )
        expand_btn.pack(side=tk.LEFT)

        # Messages container (initially hidden)
        msg_container = ttk.Frame(card)
        msg_container.pack(fill=tk.X, pady=(5, 0))
        msg_container.pack_forget()  # hidden by default

        # Store references
        card._msg_container = msg_container
        card._expand_btn = expand_btn
        card._expand_var = expand_var
        card._archived = archived

    def _toggle_archive(self, sid: str, card: ttk.Frame):
        """Toggle archive status for a session."""
        new_state = not card._archived
        self.db.set_session_archived(sid, new_state)
        card._archived = new_state
        self._refresh_list()

    def _toggle_messages(self, sid: str, card: ttk.Frame, var: tk.BooleanVar):
        """Expand or collapse the message list for a session."""
        if var.get():
            # Collapse
            var.set(False)
            card._msg_container.pack_forget()
            card._expand_btn.configure(text="Show recent messages ▼")
        else:
            # Expand
            var.set(True)
            self._load_messages(sid, card._msg_container)
            card._msg_container.pack(fill=tk.X, pady=(5, 0))
            card._expand_btn.configure(text="Hide messages ▲")

    def _load_messages(self, sid: str, container: ttk.Frame):
        """Load and display recent messages for a session."""
        # Clear existing
        for widget in container.winfo_children():
            widget.destroy()

        messages = self.db.get_messages_as_conversation(sid, include_ancestors=False)
        if not messages:
            ttk.Label(container, text="No messages.", foreground="gray").pack(anchor=tk.W)
            return

        # Show last 5 messages with "show more" option
        recent = messages[-5:]
        for msg in recent:
            self._render_message(container, msg)

        if len(messages) > 5:
            remaining = messages[:-5]
            more_var = tk.BooleanVar(value=False)
            more_btn = ttk.Button(
                container,
                text=f"Show {len(remaining)} more messages ▼",
                command=lambda container=container, msgs=remaining, btn=None, var=more_var: self._show_more(container, msgs, btn, var),
            )
            more_btn.pack(anchor=tk.W, pady=(5, 0))
            more_btn._more_var = more_var
            more_btn._remaining_msgs = remaining

    def _show_more(self, container: ttk.Frame, messages: List[Dict], btn: ttk.Button, var: tk.BooleanVar):
        """Show all remaining messages."""
        if var.get():
            return
        var.set(True)
        # Insert before the button
        for msg in reversed(messages):
            self._render_message(container, msg, before=btn)
        if btn:
            btn.configure(text="All messages shown", state=tk.DISABLED)

    def _render_message(self, container: ttk.Frame, msg: Dict, before=None):
        """Render a single message row."""
        role = msg.get("role", "unknown")
        content = msg.get("content") or ""
        if isinstance(content, list):
            content = " ".join(str(c) for c in content)
        content = str(content).strip()

        # Truncate long content for preview
        max_len = 200
        if len(content) > max_len:
            content = content[:max_len] + "..."

        role_colors = {
            "user": "#0066cc",
            "assistant": "#008800",
            "tool": "#cc6600",
            "system": "#666666",
        }
        color = role_colors.get(role, "#333333")

        msg_frame = ttk.Frame(container)
        if before:
            msg_frame.pack(fill=tk.X, pady=1, before=before)
        else:
            msg_frame.pack(fill=tk.X, pady=1)

        role_label = tk.Label(
            msg_frame,
            text=f"[{role}]",
            fg=color,
            font=("Helvetica", 9, "bold"),
            width=10,
            anchor=tk.W,
        )
        role_label.pack(side=tk.LEFT)

        content_label = tk.Label(
            msg_frame,
            text=content,
            wraplength=700,
            justify=tk.LEFT,
            anchor=tk.W,
        )
        content_label.pack(side=tk.LEFT, fill=tk.X, expand=True)

    def run(self):
        self.root.mainloop()


def launch_archive_gui(db_path=None):
    """Entry point: open the archive GUI."""
    from hermes_state import SessionDB
    from pathlib import Path

    if db_path:
        db = SessionDB(db_path=Path(db_path))
    else:
        db = SessionDB()

    try:
        app = SessionArchiveGUI(db)
        app.run()
    finally:
        db.close()


if __name__ == "__main__":
    launch_archive_gui()
