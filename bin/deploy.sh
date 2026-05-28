#!/usr/bin/env bash
# CHAT-CDT — deploy incremental.
# Roda toda vez que você quer trazer o servidor pro estado do GitHub.
#
# Idempotente e seguro:
#   - faz fast-forward (não pisa commits locais)
#   - só roda pnpm install se package/lock mudou
#   - sempre build + restart PM2
#   - reload Caddy se Caddyfile mudou
#   - rollback automático se health check falhar
#
# Uso:
#   ./bin/deploy.sh
#   APP_DIR=/outro/path ./bin/deploy.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/chat-cdt}"
DOMAIN="${DOMAIN:-chat.cdt.7bee.ai}"
HEALTH_URL_LOCAL="http://127.0.0.1:3000/api/health"
HEALTH_MAX_ATTEMPTS="${HEALTH_MAX_ATTEMPTS:-30}"   # 30 × 2s = 60s

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

cd "$APP_DIR" || die "$APP_DIR não existe — rode bin/bootstrap.sh primeiro"
[ -f .env.local ] || die ".env.local não encontrado em $APP_DIR"

# ---------- 1. Snapshot pra rollback ----------
PREV_SHA="$(git rev-parse HEAD)"
log "HEAD atual: $PREV_SHA"

# ---------- 2. Pull ----------
log "git fetch + pull --ff-only"
git fetch --tags --prune origin
if git merge-base --is-ancestor HEAD origin/main; then
  if [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then
    log "já está em origin/main, nada a baixar"
    NEW_SHA="$PREV_SHA"
  else
    git pull --ff-only origin main
    NEW_SHA="$(git rev-parse HEAD)"
    log "atualizado para $NEW_SHA"
  fi
else
  die "HEAD divergiu de origin/main — resolva manualmente antes"
fi

# Se nada mudou, ainda assim rebuilda? Não — só sai cedo.
if [ "$PREV_SHA" = "$NEW_SHA" ] && [ "${FORCE:-0}" != "1" ]; then
  log "sem mudanças, saindo (use FORCE=1 ./bin/deploy.sh pra rebuildar)"
  exit 0
fi

# ---------- 3. Detectar o que mudou ----------
CHANGED="$(git diff --name-only "$PREV_SHA" "$NEW_SHA")"
echo "$CHANGED" | sed 's/^/  /'

deps_changed=0
proxy_changed=0
pm2_changed=0
migrations_changed=0
echo "$CHANGED" | grep -E '^(package\.json|pnpm-lock\.yaml)$'                 >/dev/null && deps_changed=1
echo "$CHANGED" | grep -E '^infra/(Caddyfile|nginx-chat-cdt\.conf)$'          >/dev/null && proxy_changed=1
echo "$CHANGED" | grep -E '^infra/ecosystem\.config\.cjs$'                    >/dev/null && pm2_changed=1
echo "$CHANGED" | grep -E '^infra/supabase/migrations/'                       >/dev/null && migrations_changed=1

# ---------- 4. Aviso de migrações pendentes ----------
if [ "$migrations_changed" -eq 1 ]; then
  warn "⚠ infra/supabase/migrations/ mudou. Migração NÃO é aplicada automaticamente."
  warn "  Aplicar manualmente via Supabase Studio ou MCP antes/depois do deploy."
fi

# ---------- 5. Install ----------
if [ "$deps_changed" -eq 1 ] || [ ! -d node_modules ]; then
  log "package/lock mudou (ou node_modules vazio), instalando"
  pnpm install --prod=false --frozen-lockfile
else
  log "deps não mudaram, pulando install"
fi

# ---------- 6. Build ----------
log "build"
pnpm build

# ---------- 7. PM2 ----------
if [ "$pm2_changed" -eq 1 ]; then
  log "ecosystem mudou, pm2 delete+start"
  pm2 delete chat-cdt 2>/dev/null || true
  pm2 start "$APP_DIR/infra/ecosystem.config.cjs"
else
  log "pm2 restart com env atualizado"
  pm2 restart chat-cdt --update-env
fi
pm2 save

# ---------- 8. Proxy (nginx ou Caddy) ----------
if [ "$proxy_changed" -eq 1 ]; then
  if systemctl is-active --quiet nginx 2>/dev/null; then
    log "config nginx mudou, reload"
    sudo cp "$APP_DIR/infra/nginx-chat-cdt.conf" /etc/nginx/sites-available/chat-cdt
    sudo nginx -t
    sudo systemctl reload nginx
  elif systemctl is-active --quiet caddy 2>/dev/null; then
    log "Caddyfile mudou, reload"
    sudo cp "$APP_DIR/infra/Caddyfile" /etc/caddy/conf.d/chat-cdt.caddy
    sudo caddy validate --config /etc/caddy/Caddyfile
    sudo systemctl reload caddy
  fi
fi

# ---------- 9. Health check + rollback ----------
log "health check (até $((HEALTH_MAX_ATTEMPTS*2))s)..."
ok=0
code=000
for i in $(seq 1 "$HEALTH_MAX_ATTEMPTS"); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL_LOCAL" || echo 000)"
  if [ "$code" = "200" ]; then ok=1; break; fi
  sleep 2
done

if [ "$ok" -ne 1 ]; then
  warn "health check falhou (último HTTP: $code). Rollback para $PREV_SHA"
  # Rollback mínimo: volta git, rebuilda com node_modules existente, restart.
  # NÃO roda pnpm install — se deps mudaram e isso é o problema, é melhor
  # falhar visível pro humano arrumar do que infinite loop.
  git reset --hard "$PREV_SHA"
  if pnpm build; then
    pm2 restart chat-cdt --update-env
    warn "rollback completo. App rodando no commit $PREV_SHA. Investigar: pm2 logs chat-cdt --lines 100"
  else
    warn "rollback do build falhou — VPS pode estar servindo a versão nova quebrada."
    warn "Intervenção manual: ssh na VPS, cd $APP_DIR, ajustar, rodar pnpm install + build + pm2 restart"
  fi
  exit 1
fi

log "deploy OK"
log "HEAD: $NEW_SHA"
pm2 list | grep chat-cdt || true
