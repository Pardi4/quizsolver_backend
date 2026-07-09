param(
  [Parameter(Mandatory = $true)]
  [string]$Server,

  [string]$User = "root",
  [string]$RemoteProjectDir = "/var/www/quizsolver",
  [string]$RemoteBackupDir = "/var/backups/quizsolver-mongo",
  [string]$LocalBackupDir = "$HOME\Downloads\quizsolver-mongo-backups"
)

$ErrorActionPreference = "Stop"

function Quote-Sh([string]$Value) {
  return "'" + ($Value -replace "'", "'\''") + "'"
}

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found. Install OpenSSH Client or run this from a terminal that has '$Name'."
  }
}

Require-Command "ssh"
Require-Command "scp"

New-Item -ItemType Directory -Force -Path $LocalBackupDir | Out-Null

$remoteProject = Quote-Sh $RemoteProjectDir
$remoteBackup = Quote-Sh $RemoteBackupDir

$remoteCommand = @"
set -eu
PROJECT_DIR=$remoteProject
BACKUP_DIR=$remoteBackup
SCRIPT="`$PROJECT_DIR/backend/deploy/backup-mongo.sh"

if [ ! -f "`$SCRIPT" ]; then
  echo "Backup script not found: `$SCRIPT" >&2
  exit 1
fi

chmod +x "`$SCRIPT"

if [ -z "`${MONGO_URI:-}" ] && [ -z "`${MONGODB_URI:-}" ] && [ -f "`$PROJECT_DIR/backend/.env" ]; then
  MONGODB_URI="`$(grep -E '^MONGODB_URI=' "`$PROJECT_DIR/backend/.env" | tail -n 1 | cut -d= -f2-)"
  export MONGODB_URI
fi

BACKUP_DIR="`$BACKUP_DIR" "`$SCRIPT" >/dev/null
ls -1t "`$BACKUP_DIR"/quizsolver-*.archive.gz | head -n 1
"@

$target = "$User@$Server"
Write-Host "Creating MongoDB backup on $target..."
$remoteFile = (& ssh $target $remoteCommand).Trim()

if (-not $remoteFile) {
  throw "Remote backup did not return a file path."
}

$localFile = Join-Path $LocalBackupDir (Split-Path $remoteFile -Leaf)
Write-Host "Downloading $remoteFile to $localFile..."
& scp "${target}:$remoteFile" $localFile

if (-not (Test-Path -LiteralPath $localFile)) {
  throw "Backup download failed: $localFile was not created."
}

$item = Get-Item -LiteralPath $localFile
Write-Host "Backup saved:"
$item | Select-Object FullName, Length, LastWriteTime
