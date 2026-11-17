# Steadier runbook

How Steadier runs on this server, and what to do when something has to be fixed, moved or restarted. Plain steps; copy the commands exactly. Written 17 Nov 2026.

Where this file lives: in GitHub (`docs/RUNBOOK.md` in GeeRusty/steadier), on the server at `/home/claudeuser/steadier/docs/RUNBOOK.md`, and copied every night to `/home/claudeuser/backups/RUNBOOK.md`, so it travels with your off-server backups.

Commands are run as `claudeuser` in `/home/claudeuser/steadier` unless they start with `sudo`. You run `sudo` commands yourself, in Hostinger's browser terminal.

## 1. What runs here

The server is a Hostinger VPS running Ubuntu 24.04, at IP 31.97.110.46.

| Piece | What it is | How it runs | Starts at boot? |
|---|---|---|---|
| **Caddy** | The front door. It gives both sites their https certificate and passes visitors to the right app. | A system service. Its settings are in `/etc/caddy/Caddyfile`. | Yes (`systemctl is-enabled caddy`) |
| **Docker** | Runs the apps in containers. | A system service. | Yes (`systemctl is-enabled docker`) |
| **Steadier app** | Container `steadier-app-1`, built from this folder. Listens on 127.0.0.1:3001. | `docker compose` project "steadier" (`compose.yaml`) | Yes: `restart: unless-stopped` |
| **Steadier database** | Container `steadier-db-1`, MySQL 8.4. Its data is in the Docker volume `steadier_db-data`. | Same compose project | Yes: `restart: unless-stopped` |
| **SoleForge** | Container `soleforge`, built from `/home/claudeuser/soleforge`. Listens on 127.0.0.1:3000. Its data is in Supabase, a hosted service, not on this server. | Its own `compose.yaml` | Yes: `restart: unless-stopped` |
| **Nightly jobs** | 03:30 database backup, 03:35 photo backup, 20:05 SoleForge recurring jobs. | `crontab -l` for claudeuser | Yes (cron) |
| **Phone notifications** | Inside the Steadier app: it checks every minute and sends task reminders and leave by. | Part of the app | With the app |

Addresses:
- **Steadier:** https://steadier.31-97-110-46.sslip.io (Caddy → 127.0.0.1:3001)
- **SoleForge:** https://31-97-110-46.sslip.io (Caddy → 127.0.0.1:3000)
- The sslip.io addresses spell out the server's IP. **A new server with a new IP means new addresses** (see section 5).

Secrets and keys:
- **`/home/claudeuser/steadier/.env`:** the database passwords, session secret, owner email, sign-up settings, Anthropic key, Android certificate fingerprint and the push keys (VAPID). It is **not** in git. Lose it and every phone has to sign in and turn notifications on again.
- **`/home/claudeuser/soleforge/.env.local`:** SoleForge's Supabase, Square, Resend and Anthropic keys. Not in git.
- **`/home/claudeuser/steadier-android-keys/`** and **`/home/claudeuser/soleforge-android-keys/`:** the Android signing keys. Lose one and that installed app can never be updated; it has to be uninstalled and reinstalled.
- **`/home/claudeuser/.ssh/steadier_deploy`** and **`soleforge_deploy`:** the keys that let this server push to GitHub. They can be replaced (section 5).

Quick health check:
```
docker ps --format '{{.Names}}: {{.Status}}'
curl -s -o /dev/null -w "%{http_code}\n" https://steadier.31-97-110-46.sslip.io/api/health
curl -s -o /dev/null -w "%{http_code}\n" https://31-97-110-46.sslip.io/
```
You want `steadier-app-1` and `steadier-db-1` "healthy", `soleforge` "Up", and 200 from both addresses.

## 2. The database and backups

- **Where it lives:** MySQL inside `steadier-db-1`, stored in the Docker volume `steadier_db-data`. Your whole workspace is one row per account in `steadier_workspaces`. Copies the app keeps for itself are in `steadier_workspace_backups` and `steadier_workspace_recoveries`.
- **Photos:** in `/home/claudeuser/steadier-photos`, outside the database.
- **Nightly backup (03:30):** `scripts/backup-db.sh` writes `/home/claudeuser/backups/steadier/steadier-YYYY-MM-DD_HHMM.sql.gz`. It refuses to keep a dump that doesn't end with "Dump completed", and it keeps 14 days. The log is in `/home/claudeuser/backups/steadier/backup.log`.
- **Nightly photo backup (03:35):** `scripts/backup-photos.sh` adds new photos to `/home/claudeuser/backups/steadier-photos`. It only ever adds; a photo is removed only 30 days after you deleted it.
- **Every deploy** also takes a backup first.
- **Take one now:** `bash scripts/backup-db.sh`

### Check a backup is good
```
bash scripts/check-backup.sh
```
This loads the newest backup into a throwaway database (no network, deleted afterwards) and counts what came back, for example "1 account(s), 1 workspace(s), 92 task(s)", then prints **PASS**. Nothing live is touched. To check a particular file: `bash scripts/check-backup.sh /home/claudeuser/backups/steadier/FILE.sql.gz`.

### Restore a backup (replaces everything since that backup)
1. Take a backup of the current state first, in case: `bash scripts/backup-db.sh`
2. Check the one you're restoring: `bash scripts/check-backup.sh FILE`
3. Stop the app: `docker compose stop app`
4. Load it:
   ```
   gunzip -c FILE | docker exec -i steadier-db-1 sh -c 'mysql -usteadier -p"$MYSQL_PASSWORD" steadier'
   ```
5. Start the app: `docker compose up -d app`, then do the quick health check.

A smaller fix: the app keeps its own copies of your workspace from before big changes. In Steadier, ☰ › **Backups & trial** shows them and can restore one without touching the server.

### Copy backups off the server (do this weekly, and before any restart)
The account **steadier-backup** can only read `/home/claudeuser/backups`, by SFTP, with your key `steadier_backup` (set up 16 Nov). It can't change or delete anything.

On your Windows PC, in WinSCP:
1. New site: protocol **SFTP**, host `31.97.110.46`, port 22, user `steadier-backup`, no password. Under Advanced › SSH › Authentication › Private key file, choose your `steadier_backup` key (WinSCP can convert it to .ppk).
2. Log in. You land in `/backups`. You should see `steadier`, `steadier-photos` and `RUNBOOK.md`.
3. Drag `steadier` (newest few `.sql.gz` files), `steadier-photos` and `RUNBOOK.md` to a folder on your PC, or better, a cloud folder or USB drive.

**Not in that folder, on purpose:** `.env`, `.env.local` and the Android signing keys. Keep one copy of each somewhere safe that isn't this server, such as a password manager or an encrypted USB stick. Copy them once now, and again whenever they change. To get them, use the Hostinger browser terminal: `cat /home/claudeuser/steadier/.env`, then paste it into your password manager. The two `.jks` key files need a one-off copy; ask Claude to prepare a temporary, encrypted bundle for WinSCP.

## 3. Deploy, and roll back

Code lives in GitHub (GeeRusty/steadier, branch `main`). A plain `git push` works from the server.

### Deploy
```
bash scripts/deploy.sh
```
It:
1. runs the type check and every test in Docker, and stops if anything fails;
2. backs up the database and checks the backup restores;
3. keeps the running version as `steadier:previous`;
4. builds and starts the new version;
5. waits until it's healthy and checks the site answers.

Database changes ("migrations", in `drizzle/`) apply by themselves when the app starts, and they only ever add.

### Roll back
```
bash scripts/rollback.sh
```
This puts back the version that ran before the last deploy, in under a minute. It doesn't touch the database. Then either fix forward, or undo the commit in git (`git revert BAD_COMMIT`, then deploy again). If the bad version also damaged data, restore the backup the deploy took (section 2), because each deploy backs up first.

### Android app (only when its address changes)
The Android app is a shell around the website, so normal deploys never need a new APK. You only rebuild it if the address changes: set `steadierHost` in `android/gradle.properties`, raise `versionCode` in `android/app/build.gradle`, run `bash android/build-apk.sh`, then deploy. It appears at /download. It must be signed with the key in `steadier-android-keys`.

## 4. The Claude connector

- **Connector address:** https://steadier.31-97-110-46.sslip.io/api/compass/mcp. Claude signs in through Steadier's own sign-in page (OAuth). No key has to be copied by hand.
- **Set it up:** in claude.ai, go to Settings › Connectors › **Add custom connector**. Name it "Steadier", paste the address above, then tap **Connect**. Steadier's page opens: sign in with your Steadier email and password and approve. Claude then lists the Steadier tools.
- **Reconnect** (if Claude says it can't reach Steadier, or after tools change): Settings › Connectors › Steadier › **Disconnect**, then **Connect** again and approve. After a deploy that adds or renames tools, a reconnect makes Claude see them.
- **Check from the server:** `curl -s https://steadier.31-97-110-46.sslip.io/.well-known/oauth-protected-resource` should return JSON naming the address. In Steadier, ☰ › **Server & Compass** shows the connections and their latest use.
- The old "Stead" connector in claude.ai points at Manus. Remove it once you're sure you don't need it.
- **If the address ever changes** (new server or a real domain): remove the connector and add it again with the new address.

## 5. Restore onto a brand-new server

You need: the newest database backup (`.sql.gz`), the photos folder, `.env` for Steadier, `.env.local` for SoleForge, the two Android key folders, and access to GitHub. Allow about an hour.

1. **Make the server.** Ubuntu 24.04, at least 2 GB RAM and 40 GB disk. Note its IP address.
2. **Create the user** (as root): `adduser claudeuser`, then `usermod -aG docker claudeuser` once Docker is installed in step 3. Do everything after that as claudeuser. Keep this user name: paths in the scripts expect `/home/claudeuser`.
3. **Install the tools** (as root):
   ```
   apt update && apt full-upgrade -y
   curl -fsSL https://get.docker.com | sh
   apt install -y caddy git rsync
   systemctl enable --now docker caddy
   ```
4. **Get the code:** make a key with `ssh-keygen -t ed25519 -f ~/.ssh/steadier_deploy -N ""`, add the `.pub` file on GitHub (repo › Settings › Deploy keys, allow write). Then:
   ```
   cd ~ && GIT_SSH_COMMAND="ssh -i ~/.ssh/steadier_deploy" git clone git@github.com:GeeRusty/steadier.git
   cd steadier && git config core.sshCommand "ssh -i ~/.ssh/steadier_deploy"
   ```
   Do the same for SoleForge (`soleforge_deploy`, `GeeRusty/soleforge`).
5. **Put the secrets back:** copy `.env` into `~/steadier/` and `.env.local` into `~/soleforge/`, then `chmod 600` both. Copy `steadier-android-keys` and `soleforge-android-keys` into `~`.
   - With a new IP, change `PUBLIC_ORIGIN` in `.env` to the new address, for example `https://steadier.NEW-IP-WITH-DASHES.sslip.io`.
   - If `.env` is lost, make a new one with fresh `SESSION_SECRET`, `MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD` (`openssl rand -hex 32` each), your `OWNER_EMAIL`, and the Anthropic key from console.anthropic.com. Push keys: ask Claude to generate them (phones then turn notifications on again). `ANDROID_CERT_SHA256` comes from the Android key (`keytool -list -v -keystore ~/steadier-android-keys/steadier-release.jks`).
6. **Start the database and load the backup:**
   ```
   cd ~/steadier
   docker compose up -d db
   docker compose ps db        # wait until it says healthy
   gunzip -c ~/steadier-backup.sql.gz | docker exec -i steadier-db-1 sh -c 'mysql -usteadier -p"$MYSQL_PASSWORD" steadier'
   ```
7. **Put the photos back:** copy the photos backup into `~/steadier-photos/`.
8. **Start Steadier:** `docker compose up -d --build`. The first build takes several minutes.
9. **Start SoleForge:** `cd ~/soleforge && docker compose up -d --build`.
10. **Caddy** (as root): put the two sites in `/etc/caddy/Caddyfile`, with the new IP in the addresses:
    ```
    NEW-IP-WITH-DASHES.sslip.io {
        reverse_proxy localhost:3000
    }

    steadier.NEW-IP-WITH-DASHES.sslip.io {
        reverse_proxy localhost:3001
    }
    ```
    Then `systemctl reload caddy`.
11. **Nightly jobs:** `crontab -e` as claudeuser, and add:
    ```
    PATH=/usr/local/bin:/usr/bin:/bin
    5 20 * * * bash /home/claudeuser/soleforge/scripts/run-recurring.sh
    30 3 * * * bash /home/claudeuser/steadier/scripts/backup-db.sh >> /home/claudeuser/backups/steadier/backup.log 2>&1
    35 3 * * * bash /home/claudeuser/steadier/scripts/backup-photos.sh >> /home/claudeuser/backups/steadier/photo-backup.log 2>&1
    ```
12. **Off-server backup account** (as root): `bash /home/claudeuser/steadier/scripts/setup-backup-sftp.sh /path/to/steadier_backup.pub`
13. **If the address changed:**
    - rebuild both Android apps for the new host (section 3), and reinstall them on the phone from /download;
    - re-add the Claude connector with the new address (section 4);
    - turn notifications on again on the phone (⋮ › **Notifications** › **Turn on**).

    A real domain avoids all of this next time.
14. **Check:** run the quick health check (section 1) and `bash scripts/check-backup.sh`. Sign in on your phone, and check Today and your counts. Make a Claude connector call. Send a test notification.

Keep the old server running until the new one has passed every check.

## 6. Restarts and system updates

Ubuntu installs security updates by itself, but a new Linux kernel or core library only takes effect after a restart. If `/var/run/reboot-required` exists, a restart is waiting. `cat /var/run/reboot-required.pkgs` says why.

### Before
1. **Backup:** `bash scripts/backup-db.sh && bash scripts/check-backup.sh`. It must say PASS.
2. **Off-server copy:** copy the new backup off the server with WinSCP (section 2).
3. **Nothing unsaved in git:** `git status` should be clean, and `git log origin/main..` should be empty. Do the same in `~/soleforge`.
4. **Note what's running:** `docker ps --format '{{.Names}}: {{.Status}}'` (save the output) and `uname -r` (the current kernel).
5. **Space:** `df -h /` needs at least 5 GB free.
6. **Timing:** pick a time with no booked reminder in the next 15 minutes. Steadier is unreachable for 2–5 minutes.

### Do it (as root, in Hostinger's browser terminal)
```
apt update && apt full-upgrade -y
reboot
```
Wait 2–3 minutes, then open the browser terminal again.

### After
1. **New kernel:** `uname -r` shows a newer version, and `/var/run/reboot-required` is gone.
2. **Services up:** `systemctl is-active docker caddy` says active twice.
3. **Containers:** `docker ps`. `steadier-db-1` and `steadier-app-1` are healthy (allow 1–2 minutes), and `soleforge` is Up. If one is missing: `cd ~/steadier && docker compose up -d` (or `cd ~/soleforge && docker compose up -d`).
4. **Sites:** the quick health check returns 200 from both addresses.
5. **Your data:** sign in on the phone, open Today, and check the tasks look right.
6. **Connector:** ask Claude to read something from Steadier.
7. **Notifications:** ⋮ › **Notifications** › **Send a test**.
8. **Nightly jobs:** `crontab -l` still lists the three jobs. The next morning, `tail -2 ~/backups/steadier/backup.log` shows a new 03:30 line.
9. **SoleForge:** open its site and check it loads.

If the app won't come back after a restart: `cd ~/steadier && docker compose logs --tail 80 app` shows why. A rollback (section 3) or a backup restore (section 2) are the two ways back.
