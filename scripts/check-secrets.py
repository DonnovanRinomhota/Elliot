#!/usr/bin/env python3
"""Fails if a file in this repository looks like it contains a real key.

This repository is public. Keys live in Vercel, n8n and Supabase, never here.
Run by GitHub Actions on every pull request; you can run it yourself:

    python3 scripts/check-secrets.py

Checks the files git tracks (or a list of files given as arguments). Prints
where something was found, never the value itself.
"""
import re
import subprocess
import sys

PATTERNS = {
    "Anthropic key": r"sk-ant-[A-Za-z0-9_\-]{20,}",
    "Resend key": r"\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{10,}",
    "JWT (Supabase or n8n key)": r"eyJhbGciOi[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{10,}",
    "Meta / WhatsApp token": r"\bEAA[A-Za-z0-9]{40,}",
    "Google API key": r"\bAIza[0-9A-Za-z_\-]{35}",
    "Google OAuth client secret": r"GOCSPX-[A-Za-z0-9_\-]{20,}",
    "GitHub token": r"\bgh[pousr]_[A-Za-z0-9]{30,}",
    "Voyage key": r"\bpa-[A-Za-z0-9_\-]{30,}",
    "Stripe live key": r"\b[sr]k_live_[A-Za-z0-9]{20,}",
    "Database URL with password": r"postgres(?:ql)?://[^:\s/]+:[^@\s<>{}$]{6,}@[^\s'\"]+",
    "Private key": r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
    "Secret pasted into code": r"(?i)(?:webhook_secret|app_secret|api_key|apikey|secret)\s*[:=]\s*['\"][A-Za-z0-9_\-]{24,}['\"]",
}
# Placeholders and obviously fake values are fine.
ALLOWED = ("PASTE_", "example", "EXAMPLE", "xxxx", "XXXX", "your-", "YOUR_", "placeholder", "PLACEHOLDER", "ci-placeholder", "<", "...")
SKIP = ("package-lock.json", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".pdf")


def main() -> int:
    files = sys.argv[1:] or subprocess.run(["git", "ls-files"], capture_output=True, text=True, check=True).stdout.split("\n")
    found = []
    for path in files:
        if not path or path.endswith(SKIP):
            continue
        try:
            text = open(path, encoding="utf-8").read()
        except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
            continue
        for name, pattern in PATTERNS.items():
            for m in re.finditer(pattern, text):
                value = m.group(0)
                if any(a in value for a in ALLOWED):
                    continue
                line = text.count("\n", 0, m.start()) + 1
                found.append(f"{path}:{line}: looks like a {name} ({len(value)} characters)")
    for f in found:
        print(f)
    if found:
        print("\nRemove it, then change that key where it was issued: anyone can read this repository.")
        return 1
    print(f"No keys found in {len([f for f in files if f])} files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
