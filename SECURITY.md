# Security and data boundaries

This is a local development package. Use sanitized repositories, fixture data and
explicitly selected output paths. Models and source files are untrusted data;
model proposals do not grant permission or decide deterministic verdicts.

Model adapters send the documented task/source and selected tool results to the
explicit provider. Keep credentials in the environment, never scenario metadata.
Native HTTP adapters reject redirects. Do not use a production account as a
fault-injection fixture. A subprocess/process group is not a hostile-code sandbox.
Browser screenshots are opt-in: choose mask selectors for every sensitive region;
text redaction cannot discover secret pixels automatically. Private output modes
are defense in depth, not encryption. Inspect artifacts before sharing them.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/Balaji91221/toolchaos/security/advisories/new) to contact the maintainers. Include the affected version, a sanitized
reproduction, and the expected and observed behavior. Do not post secrets,
credentials, or sensitive exploit details in public issues.

Security fixes target the latest development release (currently 0.2.0).
Older releases have no maintenance guarantee. No independent security
audit or response-time guarantee is claimed.
