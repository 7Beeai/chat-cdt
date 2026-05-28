#!/usr/bin/env bash
# CHAT-CDT — deploy incremental.
#
# FILOSOFIA: simples. Só pull + install se preciso + build + restart.
# Sem auto-rollback. Se quebrar, alerta humano e mantém o último build
# rodando (PM2 não derruba processo que está OK só porque o restart falhou).
#
# Lê PORT do .env.local (default 3000) — assim cada VPS pode usar uma
# porta diferente sem precisar versionar override.
#
# Uso:
#   ./bin/deploy.sh                   # ou: bash bin/deploy.sh
#   APP_DIR=/outro/path ./bin/deploy.sh
#   FORCE=1 ./bin/deploy.sh           # rebuilda mesmo sem mudanças

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/chat-cdt}"
HEALTH_MAX_ATTEMPTS="${HEALTH_MAX_ATTEMPTS:-45}"   # 45 × 2s = 90s

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

cd "$APP_DIR" || die "$APP_DIR não existe"
[ -f .env.local ] || die ".env.local não encontrado em $APP_DIR"

# Carregar PORT (e outras vars) do .env.local para o ambiente do shell.
# Isso é o que faz o ecosystem.config.cjs ver process.env.PORT correto.
set -a
. "$APP_DIR/.env.local"
set +a
PORT="${PORT:-3000}"
HEALTH_URL_LOCAL="http://127.0.0.1:${PORT}/api/health"
log "porta configurada: $PORT"

# ---------- 1. Pull ----------
PREV_SHA="$(git rev-parse HEAD)"
log "HEAD atual: $PREV_SHA"
log "git fetch + pull --ff-only"
git fetch --tags --prune origin
git pull --ff-only origin main
NEW_SHA="$(git rev-parse HEAD)"

if [ "$PREV_SHA" = "$NEW_SHA" ] && [ "${FORCE:-0}" != "1" ]; then
  log "sem mudanças, saindo (FORCE=1 pra rebuildar)"
  exit 0
fi

# ---------- 2. Detectar o que mudou ----------
CHANGED="$(git diff --name-only "$PREV_SHA" "$NEW_SHA")"
deps_changed=0
proxy_changed=0
pm2_changed=0
migrations_changed=0
deploy_changed=0
echo "$CHANGED" | grep -E '^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$' >/dev/null && deps_changed=1
echo "$CHANGED" | grep -E '^infra/(Caddyfile|nginx-chat-cdt\.conf)$'                >/dev/null && proxy_changed=1
echo "$CHANGED" | grep -E '^infra/ecosystem\.config\.cjs$'                          >/dev/null && pm2_changed=1
echo "$CHANGED" | grep -E '^infra/supabase/migrations/'                             >/dev/null && migrations_changed=1
echo "$CHANGED" | grep -E '^bin/deploy\.sh$'                                        >/dev/null && deploy_changed=1

# ---------- 3. Re-exec se deploy.sh mudou ----------
# Sem isso, Bash continua executando a versão antiga em memória.
if [ "$deploy_changed" -eq 1 ] && [ -z "${DEPLOY_REEXEC:-}" ]; then
  log "bin/deploy.sh foi atualizado — re-executando a nova versão"
  exec env DEPLOY_REEXEC=1 bash "$APP_DIR/bin/deploy.sh" "$@"
fi

# ---------- 4. Avisos ----------
if [ "$migrations_changed" -eq 1 ]; then
  warn "⚠ infra/supabase/migrations/ mudou. NÃO aplicada automaticamente."
  warn "  Aplicar manualmente via Supabase Studio ou MCP."
fi

# ---------- 5. Install ----------
if [ "$deps_changed" -eq 1 ] || [ ! -d node_modules ]; then
  log "deps mudaram (ou node_modules vazio), instalando"
  pnpm install --prod=false --frozen-lockfile
else
  log "deps inalteradas, pulando install"
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
  log "pm2 restart com env atualizado (PORT=$PORT)"
  pm2 restart chat-cdt --update-env
fi
pm2 save

# ---------- 8. Proxy ----------
# Substitui 127.0.0.1:3000 do template pelo valor real de PORT antes de copiar.
# Isso permite que o repo tenha o template com 3000 (default) mas a VPS use
# qualquer porta sem patch manual.
if [ "$proxy_changed" -eq 1 ]; then
  if systemctl is-active --quiet nginx 2>/dev/null; then
    log "config nginx mudou, gerando com porta $PORT e reload"
    sed "s|127\.0\.0\.1:3000|127.0.0.1:${PORT}|g" \
      "$APP_DIR/infra/nginx-chat-cdt.conf" > /tmp/chat-cdt.nginx.conf
    sudo mv /tmp/chat-cdt.nginx.conf /etc/nginx/sites-available/chat-cdt
    sudo nginx -t
    sudo systemctl reload nginx
  elif systemctl is-active --quiet caddy 2>/dev/null; then
    log "Caddyfile mudou, gerando com porta $PORT e reload"
    sed "s|127\.0\.0\.1:3000|127.0.0.1:${PORT}|g" \
      "$APP_DIR/infra/Caddyfile" | sudo tee /etc/caddy/conf.d/chat-cdt.caddy >/dev/null
    sudo caddy validate --config /etc/caddy/Caddyfile
    sudo systemctl reload caddy
  fi
fi

# ---------- 9. Health check (sem rollback) ----------
log "health check em $HEALTH_URL_LOCAL (até $((HEALTH_MAX_ATTEMPTS*2))s)..."
ok=0
code=000
for i in $(seq 1 "$HEALTH_MAX_ATTEMPTS"); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL_LOCAL" || echo 000)"
  if [ "$code" = "200" ]; then ok=1; break; fi
  sleep 2
done

if [ "$ok" -eq 1 ]; then
  log "✓ deploy OK — HEAD: $NEW_SHA"
  pm2 list | grep chat-cdt || true
  exit 0
fi

# Health check falhou — NÃO faz rollback. App pode estar subindo ainda,
# ou ter quebrado de verdade. Humano decide.
warn "⚠⚠⚠ health check falhou após $((HEALTH_MAX_ATTEMPTS*2))s (último HTTP: $code)"
warn "  → App PODE estar OK (Next 16 às vezes demora). Confira manualmente:"
warn "  → curl -i http://127.0.0.1:${PORT}/api/health"
warn "  → pm2 logs chat-cdt --lines 100"
warn "  → Build NOVO ($NEW_SHA) JÁ FOI APLICADO. Não vou reverter automaticamente."
warn "  → Se precisar voltar manualmente: git reset --hard $PREV_SHA && pnpm install && pnpm build && pm2 restart chat-cdt"
exit 2
