#!/bin/bash
# One-time setup (run with sudo) of the off-server backup account.
#
#   sudo bash scripts/setup-backup-sftp.sh /path/to/steadier_backup.pub
#   sudo bash scripts/setup-backup-sftp.sh --test-only     (no real key yet)
#
# What the account "steadier-backup" can do: SFTP only, read-only, and it only
# sees /backups (a read-only view of /home/claudeuser/backups). No shell, no
# password, no port forwarding, no other folders. The script proves each of
# these with a temporary test key before it installs the real key, and stops
# (installing nothing) if any check fails.
set -euo pipefail

ACCOUNT=steadier-backup
SOURCE=/home/claudeuser/backups
JAIL=/srv/steadier-backup
KEYS=/etc/ssh/steadier-backup.authorized_keys
SSHD=/etc/ssh/sshd_config
MARK_BEGIN="# >>> steadier-backup (SFTP only, read-only, chrooted) >>>"
MARK_END="# <<< steadier-backup <<<"

[ "$(id -u)" = 0 ] || { echo "Run this with sudo." >&2; exit 1; }
ARG="${1:-}"
[ -n "$ARG" ] || { echo "Usage: sudo bash $0 /path/to/key.pub   (or --test-only)" >&2; exit 1; }
REAL_KEY=""
if [ "$ARG" != "--test-only" ]; then
  [ -f "$ARG" ] || { echo "No such key file: $ARG" >&2; exit 1; }
  [ "$(grep -cv '^\s*$' "$ARG")" = 1 ] || { echo "The key file must hold exactly one public key line." >&2; exit 1; }
  ssh-keygen -l -f "$ARG" >/dev/null || { echo "That isn't a valid public key." >&2; exit 1; }
  REAL_KEY="$(grep -v '^\s*$' "$ARG" | head -1)"
  case "$REAL_KEY" in ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*) ;; *) echo "Unsupported key type." >&2; exit 1 ;; esac
  case "$REAL_KEY" in *PRIVATE*) echo "That's a PRIVATE key. Send only the .pub file." >&2; exit 1 ;; esac
fi

echo "1/6 Account: no shell, no password"
id "$ACCOUNT" >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$ACCOUNT"
usermod --shell /usr/sbin/nologin "$ACCOUNT" 2>/dev/null || true
passwd -l "$ACCOUNT" >/dev/null

echo "2/6 Read-only view of $SOURCE at $JAIL/backups"
install -d -o root -g root -m 755 /srv "$JAIL"
mountpoint -q "$JAIL/backups" || install -d -o root -g root -m 755 "$JAIL/backups"
FSTAB="$SOURCE $JAIL/backups none bind,ro,nosuid,nodev,noexec 0 0"
grep -qF "$FSTAB" /etc/fstab || echo "$FSTAB" >> /etc/fstab
mountpoint -q "$JAIL/backups" || mount "$JAIL/backups"
mount -o remount,bind,ro,nosuid,nodev,noexec "$JAIL/backups"
findmnt -no OPTIONS "$JAIL/backups" | grep -qE '(^|,)ro(,|$)' || { echo "The view isn't read-only; stopping." >&2; exit 1; }

echo "3/6 Read permission for the account only (new backups included)"
command -v setfacl >/dev/null || apt-get install -y acl >/dev/null
setfacl -R -m "u:$ACCOUNT:rX" "$SOURCE"
find "$SOURCE" -type d -exec setfacl -d -m "u:$ACCOUNT:rX" {} +

reload_sshd() {
  # Ubuntu 24.04 may run sshd by socket activation: then new logins read the file anyway.
  if systemctl is-active --quiet ssh.service; then systemctl reload ssh.service
  elif systemctl is-active --quiet sshd.service; then systemctl reload sshd.service
  elif pgrep -x sshd >/dev/null; then pkill -HUP -x sshd
  fi
}

echo "4/6 sshd: chrooted, internal-sftp -R, nothing else"
# Build the new config beside the old one and test it first, so a mistake
# can never stop anyone (you included) from logging in.
NEW="$(mktemp /etc/ssh/sshd_config.new.XXXXXX)"
sed "/^$MARK_BEGIN\$/,/^$MARK_END\$/d" "$SSHD" > "$NEW"
cat >> "$NEW" <<EOF
$MARK_BEGIN
Match User $ACCOUNT
    AuthorizedKeysFile $KEYS
    AuthenticationMethods publickey
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    ChrootDirectory $JAIL
    ForceCommand internal-sftp -R -d /backups
    AllowTcpForwarding no
    AllowStreamLocalForwarding no
    AllowAgentForwarding no
    GatewayPorts no
    X11Forwarding no
    PermitTTY no
    PermitTunnel no
    PermitUserRC no
$MARK_END
EOF

TMP="$(mktemp -d)"
CANARY="$SOURCE/.steadier-backup-selftest"
trap 'rm -rf "$TMP" "$NEW"; rm -f "$CANARY"' EXIT
ssh-keygen -q -t ed25519 -N "" -C steadier-backup-selftest -f "$TMP/test"
printf 'restrict %s\n' "$(cat "$TMP/test.pub")" > "$KEYS"
chown root:root "$KEYS"; chmod 644 "$KEYS"
sshd -t -f "$NEW" || { echo "The new sshd config didn't pass its check; nothing changed." >&2; exit 1; }
cp -a "$SSHD" "$SSHD.before-steadier-backup.$(date +%Y%m%d%H%M%S)"
chmod 644 "$NEW"; mv "$NEW" "$SSHD"
reload_sshd

echo "5/6 Proving the limits with a temporary key"
PORT="$(sshd -T 2>/dev/null | awk '$1=="port"{print $2; exit}')"
OPTS=(-i "$TMP/test" -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -p "${PORT:-22}")
SFTP=(sftp -i "$TMP/test" -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -P "${PORT:-22}" -b -)
HOST="$ACCOUNT@127.0.0.1"
fail=0
check() { if [ "$2" = ok ]; then echo "   PASS  $1"; else echo "   FAIL  $1"; fail=1; fi; }
# Tests touch only this dummy file, never a real backup.
echo "selftest" > "$CANARY"; setfacl -m "u:$ACCOUNT:r" "$CANARY"
sample="./.steadier-backup-selftest"

out="$(printf 'ls /backups\n' | "${SFTP[@]}" "$HOST" 2>&1 || true)"
echo "$out" | grep -q steadier && check "can list /backups" ok || check "can list /backups" bad
if [ -n "$sample" ]; then
  printf 'get "/backups/%s" "%s/got"\n' "${sample#./}" "$TMP" | "${SFTP[@]}" "$HOST" >/dev/null 2>&1 && [ -s "$TMP/got" ] \
    && check "can download a backup file" ok || check "can download a backup file" bad
fi
printf 'put /etc/hostname /backups/written-by-test\n' | "${SFTP[@]}" "$HOST" >/dev/null 2>&1 \
  && check "cannot upload (write)" bad || check "cannot upload (write)" ok
[ ! -e "$SOURCE/written-by-test" ] || { rm -f "$SOURCE/written-by-test"; check "nothing was written" bad; }
printf 'mkdir /backups/x\n' | "${SFTP[@]}" "$HOST" >/dev/null 2>&1 \
  && check "cannot make folders" bad || check "cannot make folders" ok
if [ -n "$sample" ]; then
  printf 'rm "/backups/%s"\n' "${sample#./}" | "${SFTP[@]}" "$HOST" >/dev/null 2>&1 || true
  [ -f "$SOURCE/${sample#./}" ] && check "cannot delete or change files" ok || check "cannot delete or change files" bad
fi
out="$(printf 'ls /\n' | "${SFTP[@]}" "$HOST" 2>&1 || true)"
echo "$out" | grep -qE '(^|/)(etc|home|root|usr)\b' && check "sees only /backups (no other folders)" bad || check "sees only /backups (no other folders)" ok
printf 'get /etc/passwd %s/pw\n' "$TMP" | "${SFTP[@]}" "$HOST" >/dev/null 2>&1 \
  && check "cannot read system files" bad || check "cannot read system files" ok
out="$(timeout 15 ssh "${OPTS[@]}" "$HOST" 'id; echo SHELL-RAN' 2>&1 || true)"
echo "$out" | grep -q 'SHELL-RAN\|uid=' && check "no shell or commands" bad || check "no shell or commands" ok
timeout 15 ssh "${OPTS[@]}" -W 127.0.0.1:3001 "$HOST" </dev/null >/dev/null 2>&1 \
  && check "no port forwarding" bad || check "no port forwarding" ok
EFFECTIVE="$(sshd -T -C "user=$ACCOUNT,host=localhost,addr=127.0.0.1" 2>/dev/null)"
for want in "authenticationmethods publickey" "passwordauthentication no" "chrootdirectory $JAIL" \
  "forcecommand internal-sftp -R -d /backups" "allowtcpforwarding no" "permittty no" "x11forwarding no" "permittunnel no"; do
  echo "$EFFECTIVE" | grep -qixF "$want" && check "sshd: $want" ok || check "sshd: $want" bad
done
passwd -S "$ACCOUNT" | awk '{print $2}' | grep -q '^L' && check "password locked" ok || check "password locked" bad

if [ "$fail" != 0 ]; then
  : > "$KEYS"
  reload_sshd
  echo "A check failed, so no key is installed (the account can't log in). Nothing else was changed for other users." >&2
  exit 1
fi

echo "6/6 Installing the key"
if [ -n "$REAL_KEY" ]; then
  printf 'restrict %s\n' "$REAL_KEY" > "$KEYS"
  echo "   Installed: $(ssh-keygen -l -f "$ARG")"
else
  : > "$KEYS"
  echo "   Test only: no key installed. Run again with the .pub file."
fi
chown root:root "$KEYS"; chmod 644 "$KEYS"
reload_sshd
echo "Done. WinSCP: user $ACCOUNT, folders /backups/steadier-photos and /backups/steadier."
