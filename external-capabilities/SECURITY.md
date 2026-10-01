# External Capability Security Policy

## Rule: No Credential Storage

This repository MUST NOT store, in any file, commit message, or history:

- API keys
- tokens
- cookies
- passwords
- client secrets
- private credentials
- any secret value

## Allowed: Authentication Metadata

A capability record MAY register:

- auth type (e.g. oauth2, api-key, none)
- required scopes
- permission description
- secret reference name (a label pointing to a secret stored elsewhere)

A secret reference name is a label, not the secret value.

## Core Distinction

```text
Authentication Metadata  ≠  Credential Storage
```

- **Authentication Metadata** describes HOW authentication works and WHAT permissions are needed.
- **Credential Storage** holds the actual secret material — NEVER allowed here.

## Responsibilities

- Never commit a secret in code, config, registry, docs, commit message, or history.
- When a secret is detected, remove it and rotate the secret; do not just delete the file.
- Do not claim permissions that have not been verified.
- When in doubt, register metadata only and store the actual secret in a dedicated secret manager.
