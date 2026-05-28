#!/usr/bin/env bash
# CHAT-CDT — bootstrap one-shot da VPS.
# Roda UMA VEZ na primeira vez que você sobe o app na máquina.
# Subsequente: usar bin/deploy.sh.
#
# Pré-requisitos manuais antes de rodar:
#   1) Usuário com sudo
#   2) DNS chat.cdt.7bee.ai → IP desta VPS (propagado)
#   3) /var/www/chat-cdt/.env.local preenchido com todas as 12 vars
#
# Uso:
#   chmod +x bin/bootstrap.sh
#   APP_DIR=/var/www/chat-cdt REPO_URL=git@github.com:org/chat-cdt.git ./bin/bootstrap.sh
#
# Idempotente: pode rodar de novo sem quebrar nada.

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/chat-cdt}"
LOG_DIR="${LOG_DIR:-/var/log/chat-cdt}"
REPO_URL="${REPO_URL:-}"
NODE_VERSION_REQ="20"
DOMAIN="chat.cdt.7bee.ai"

log()  { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[bootstrap]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[bootstrap]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- 1. Pré-checks ----------
log "checando pré-requisitos do sistema"
command -v sudo >/dev/null || die "sudo não disponível"
command -v git  >/dev/null || sudo apt update && sudo apt install -y git

# ---------- 2. Node 20+ ----------
if ! command -v node >/dev/null || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt "$NODE_VERSION_REQ" ]; then
  log "instalando Node $NODE_VERSION_REQ"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION_REQ}.x" | sudo -E bash -
  sudo apt install -y nodejs
fi
log "node $(node -v)"

# ---------- 3. pnpm + pm2 ----------
command -v pnpm >/dev/null || { log "instalando pnpm"; sudo npm i -g pnpm; }
command -v pm2  >/dev/null || { log "instalando pm2";  sudo npm i -g pm2;  }
log "pnpm $(pnpm -v) | pm2 $(pm2 -v)"

# ---------- 4. Web server (auto-detect nginx vs Caddy) ----------
WEB_SERVER=""
if systemctl is-active --quiet nginx 2>/dev/null || command -v nginx >/dev/null; then
  WEB_SERVER="nginx"
  log "nginx detectado — vou usá-lo (não instalar Caddy)"
elif command -v caddy >/dev/null; then
  WEB_SERVER="caddy"
  log "caddy detectado, usando"
else
  WEB_SERVER="caddy"
  log "nem nginx nem caddy detectados — instalando Caddy"
  sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list
  sudo apt update && sudo apt install -y caddy
fi

# ---------- 5. Diretórios ----------
log "criando diretórios"
sudo mkdir -p "$APP_DIR" "$LOG_DIR"
sudo chown -R "$USER:$USER" "$APP_DIR" "$LOG_DIR"

# ---------- 6. Clone (se ainda não está) ----------
if [ ! -d "$APP_DIR/.git" ]; then
  [ -n "$REPO_URL" ] || die "REPO_URL não setado (export REPO_URL=git@github.com:org/chat-cdt.git)"
  log "clonando $REPO_URL em $APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

# ---------- 7. .env.local ----------
if [ ! -f "$APP_DIR/.env.local" ]; then
  die ".env.local não encontrado em $APP_DIR — copie do .env.example e preencha antes de rodar de novo"
fi
REQUIRED_VARS=(
  NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY
  META_APP_ID META_APP_SECRET META_SYSTEM_USER_TOKEN META_GRAPH_VERSION WEBHOOK_VERIFY_TOKEN
  VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY NEXT_PUBLIC_VAPID_PUBLIC_KEY VAPID_SUBJECT
  CRON_SECRET APP_ORIGIN
)
missing=()
for v in "${REQUIRED_VARS[@]}"; do
  grep -E "^${v}=.+" "$APP_DIR/.env.local" >/dev/null 2>&1 || missing+=("$v")
done
if [ ${#missing[@]} -gt 0 ]; then
  die "variáveis faltando em .env.local: ${missing[*]}"
fi
log ".env.local OK"

# ---------- 8. Install + build ----------
log "instalando dependências"
pnpm install --prod=false --frozen-lockfile

log "build produção"
pnpm build

# ---------- 9. PM2 ----------
if pm2 describe chat-cdt >/dev/null 2>&1; then
  log "pm2 já tem chat-cdt, reload"
  pm2 reload chat-cdt --update-env
else
  log "pm2 start"
  pm2 start "$APP_DIR/infra/ecosystem.config.cjs"
fi
pm2 save

# Persistência através de reboot (idempotente — pm2 não duplica)
if ! systemctl is-enabled pm2-"$USER" >/dev/null 2>&1; then
  log "habilitando pm2 no boot"
  sudo env "PATH=$PATH:/usr/bin" pm2 startup systemd -u "$USER" --hp "$HOME"
  pm2 save
fi

# Carrega PORT do .env.local (default 3000)
set -a
. "$APP_DIR/.env.local"
set +a
PORT="${PORT:-3000}"
log "porta configurada: $PORT"

# ---------- 10. Web server config ----------
if [ "$WEB_SERVER" = "nginx" ]; then
  log "instalando bloco nginx (porta $PORT) em sites-available/chat-cdt"
  sed "s|127\.0\.0\.1:3000|127.0.0.1:${PORT}|g" \
    "$APP_DIR/infra/nginx-chat-cdt.conf" > /tmp/chat-cdt.nginx.conf
  sudo mv /tmp/chat-cdt.nginx.conf /etc/nginx/sites-available/chat-cdt
  sudo ln -sf /etc/nginx/sites-available/chat-cdt /etc/nginx/sites-enabled/chat-cdt
  sudo nginx -t || die "config nginx inválida"
  sudo systemctl reload nginx
  log "nginx recarregado (HTTP funcionando — TLS ainda precisa do certbot)"
  warn "👉 Rodar manualmente (depois desse script): sudo certbot --nginx -d $DOMAIN"
else
  CADDY_SNIPPET="/etc/caddy/conf.d/chat-cdt.caddy"
  if [ -f /etc/caddy/Caddyfile ] && ! grep -q "import /etc/caddy/conf.d/\*.caddy" /etc/caddy/Caddyfile 2>/dev/null; then
    echo "import /etc/caddy/conf.d/*.caddy" | sudo tee -a /etc/caddy/Caddyfile >/dev/null
  fi
  sudo mkdir -p /etc/caddy/conf.d
  sed "s|127\.0\.0\.1:3000|127.0.0.1:${PORT}|g" \
    "$APP_DIR/infra/Caddyfile" | sudo tee "$CADDY_SNIPPET" >/dev/null
  sudo caddy validate --config /etc/caddy/Caddyfile || die "Caddyfile inválido"
  sudo systemctl reload caddy
  log "caddy recarregado"
fi

# ---------- 11. Health check ----------
log "esperando o Next ficar pronto na porta $PORT..."
for i in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/api/health" || echo 000)"
  if [ "$code" = "200" ]; then
    log "Next OK"
    break
  fi
  sleep 2
  [ "$i" -eq 30 ] && die "Next não respondeu em 60s, ver: pm2 logs chat-cdt"
done

# ---------- 12. TLS externo ----------
log "testando $DOMAIN (pode demorar 30s no primeiro cert)"
if curl -sSf -o /dev/null "https://$DOMAIN/api/health"; then
  log "TLS externo OK"
else
  warn "TLS externo ainda não responde — DNS pode não ter propagado. Aguarde uns minutos e teste: curl -I https://$DOMAIN"
fi

cat <<EOF

\033[1;32m[bootstrap] concluído.\033[0m

Próximos passos manuais (uma vez):
  1) SQL no Supabase Studio:
       alter database postgres set app.app_origin  = 'https://$DOMAIN';
       alter database postgres set app.cron_secret = '<MESMO VALOR DO .env.local>';
  2) Configurar webhook no painel Meta:
       Callback: https://$DOMAIN/api/meta/webhook
       Verify token: <WEBHOOK_VERIFY_TOKEN do .env.local>
  3) Inscrever as 13 WABAs ao app CHAT-CDT (POST subscribed_apps com System User Token)

Updates futuros: ./bin/deploy.sh
EOF
