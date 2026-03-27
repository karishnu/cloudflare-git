# Git Credential Setup

When using CloudflareGit as a Git remote, you need to authenticate with your `API_KEY`. This guide covers different ways to manage credentials so you don't have to embed secrets in URLs.

## URL-Embedded Credentials (Quick Start)

The simplest approach — include the password directly in the remote URL:

```bash
git clone https://git:YOUR_API_KEY@YOUR_WORKER.workers.dev/repo.git
```

The username can be anything (e.g. `git`). Only the password (your `API_KEY`) matters.

> **Note:** This stores the key in your `.git/config` in plain text. Fine for local dev, but avoid this in shared or CI environments.

## Git Credential Store

Store credentials on disk so Git remembers them across sessions:

```bash
# Enable the credential store (one-time)
git config --global credential.helper store
```

Then clone normally — Git will prompt for credentials once and save them:

```bash
git clone https://YOUR_WORKER.workers.dev/repo.git
# Username: git
# Password: YOUR_API_KEY
```

Credentials are saved in `~/.git-credentials` in plain text.

## Git Credential Cache (In-Memory)

Cache credentials in memory for a limited time (default 15 minutes):

```bash
git config --global credential.helper 'cache --timeout=3600'
```

This avoids writing credentials to disk. After the timeout, Git will prompt again.

## macOS Keychain

On macOS, use the system keychain:

```bash
git config --global credential.helper osxkeychain
```

Then clone — Git prompts once and stores credentials in Keychain Access:

```bash
git clone https://YOUR_WORKER.workers.dev/repo.git
# Username: git
# Password: YOUR_API_KEY
```

## Manual Credential Approval

Pre-approve credentials without cloning first:

```bash
git credential approve <<EOF
protocol=https
host=YOUR_WORKER.workers.dev
username=git
password=YOUR_API_KEY
EOF
```

Now any Git operation against that host will use the stored credentials automatically.

## Per-Repository Configuration

Set credentials for just one remote, without affecting global config:

```bash
cd your-repo
git remote add cloud https://YOUR_WORKER.workers.dev/repo.git
git config credential.https://YOUR_WORKER.workers.dev.username git
```

Git will prompt for the password once and store it according to your credential helper.

## CI / Automation

In CI environments, use environment variables or the URL form:

```bash
# Using environment variable
git clone https://git:${CLOUDFLARE_GIT_KEY}@YOUR_WORKER.workers.dev/repo.git

# Or configure via GIT_ASKPASS
export GIT_ASKPASS=/path/to/script-that-echoes-password
git clone https://YOUR_WORKER.workers.dev/repo.git
```

### Example GIT_ASKPASS script

```bash
#!/bin/sh
echo "$CLOUDFLARE_GIT_KEY"
```

## .netrc

Alternatively, use a `~/.netrc` file:

```
machine YOUR_WORKER.workers.dev
login git
password YOUR_API_KEY
```

Then:

```bash
chmod 600 ~/.netrc
git clone https://YOUR_WORKER.workers.dev/repo.git
```

## Troubleshooting

### Git keeps asking for credentials

Make sure a credential helper is configured:

```bash
git config --global credential.helper
```

If empty, set one (e.g. `store`, `cache`, or `osxkeychain`).

### Wrong credentials cached

Clear stored credentials:

```bash
# For credential store
git credential reject <<EOF
protocol=https
host=YOUR_WORKER.workers.dev
EOF

# For macOS keychain
git credential-osxkeychain erase <<EOF
protocol=https
host=YOUR_WORKER.workers.dev
EOF
```

Then retry — Git will prompt for fresh credentials.
