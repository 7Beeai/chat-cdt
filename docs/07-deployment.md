# 7. Deployment

> Status: **ainda não deployado**. Esta página é o plano. Atualizar quando rodar.

## Alvo

VPS Google compartilhada com várias instâncias n8n já em produção. Domínio do CHAT-CDT a definir (placeholder: `chat.cdt.exemplo.com.br`).

## Topologia na VPS

```
[Internet] -- 443 --> [Caddy] -- 127.0.0.1:3000 --> [Next.js via PM2]
                       |
                       +-- TLS automático (Let's Encrypt)
                       +-- já hospeda outros subdomínios (n8n etc.)
```

## Pré-requisitos no servidor

Já existem (presumido):
- Ubuntu 22.04+, Caddy instalado, PM2 rodando outras apps.

Se faltar algo:
```bash
sudo apt update && sudo apt install -y curl ufw build-essential
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pnpm pm2
# Caddy (caso falte)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

## Diretórios

```
/var/www/chat-cdt/        # código
/var/log/chat-cdt/        # logs do PM2
```

```bash
sudo mkdir -p /var/www/chat-cdt /var/log/chat-cdt
sudo chown -R $USER /var/www/chat-cdt /var/log/chat-cdt
```

## Deploy via git

```bash
cd /var/www/chat-cdt
git clone <repo> .
pnpm install --prod=false
cp .env.example .env.local   # preencher com chaves de produção
pnpm build
```

## PM2

Arquivo `infra/ecosystem.config.cjs` (vir):
```js
module.exports = {
  apps: [{
    name: 'chat-cdt',
    cwd: '/var/www/chat-cdt',
    script: 'node_modules/next/dist/bin/next',
    args: 'start -p 3000',
    env: { NODE_ENV: 'production' },
    out_file: '/var/log/chat-cdt/out.log',
    error_file: '/var/log/chat-cdt/err.log',
    max_memory_restart: '500M',
  }]
};
```

```bash
pm2 start infra/ecosystem.config.cjs
pm2 save
# Se a VPS ainda não tinha PM2 configurado pra iniciar no boot:
# pm2 startup    (segue as instruções que aparecem)
```

## Caddy

Adicionar ao `/etc/caddy/Caddyfile`:
```
chat.cdt.exemplo.com.br {
  reverse_proxy 127.0.0.1:3000
  encode zstd gzip
  header {
    Strict-Transport-Security "max-age=31536000;"
    X-Content-Type-Options nosniff
    Referrer-Policy strict-origin-when-cross-origin
  }
}
```
```bash
sudo systemctl reload caddy
```

## DNS

Apontar `A` record do subdomínio para o IP da VPS. Aguardar propagação (alguns minutos). Caddy emite o cert automático quando bater na porta 443 pela primeira vez.

## Pós-deploy

1. **Configurar GUCs do Postgres** (uma vez):
   ```sql
   alter database postgres set app.app_origin  = 'https://chat.cdt.exemplo.com.br';
   alter database postgres set app.cron_secret = '<mesmo do .env>';
   ```

2. **Configurar webhook na Meta** apontando para o domínio (ver `06-setup.md`).

3. **Cron de sync de templates** (a definir, vir):
   ```cron
   */30 * * * * curl -sS -H "x-cron-secret: $CRON_SECRET" \
     https://chat.cdt.exemplo.com.br/api/cron/templates/sync >/dev/null
   ```

4. **Health check inicial**:
   - `https://chat.cdt.exemplo.com.br/api/meta/webhook?hub.mode=subscribe&hub.verify_token=<seu_token>&hub.challenge=ping` → deve retornar `ping`.
   - Logar como operador, abrir `/inbox`, ver lista vazia.
   - Forçar handoff manual via SQL e ver o card aparecer + push tocar.

## Pipeline de deploy automatizado

Três scripts cobrem todo o ciclo de vida:

| Script | Quando | O que faz |
|---|---|---|
| `bin/bootstrap.sh` | UMA VEZ na primeira instalação | Checa/instala Node 20+, pnpm, pm2, Caddy; cria diretórios; clona repo; valida `.env.local`; build; sobe PM2; configura Caddy; habilita PM2 no boot; health check |
| `bin/deploy.sh` | Toda vez que GitHub atualizar | `git pull --ff-only`; reinstala deps **só se** `package.json`/`pnpm-lock.yaml` mudou; build; restart PM2; reload Caddy **só se** `infra/Caddyfile` mudou; alerta se há nova migration SQL; **rollback automático** se health check falhar |
| `.github/workflows/deploy.yml` | Toda vez que `push origin main` | SSH na VPS e executa `bin/deploy.sh`. Opcional — pode rodar `deploy.sh` direto na VPS via cron ou hook |

### Primeiro deploy (agente que já está na VPS roda)

```bash
chmod +x bin/bootstrap.sh bin/deploy.sh
APP_DIR=/var/www/chat-cdt REPO_URL=git@github.com:<org>/chat-cdt.git ./bin/bootstrap.sh
```

Pré-requisitos manuais antes (no `.env.local` da VPS, e DNS já propagado):

```env
APP_ORIGIN=https://chat.cdt.7bee.ai   # importante: HTTPS produção, não localhost
# … demais 13 vars do .env.example preenchidas
```

### Atualizações subsequentes

Manual:
```bash
cd /var/www/chat-cdt && ./bin/deploy.sh
```

Auto via GitHub Actions: adicionar 3 secrets em `Settings → Secrets and variables → Actions`:
- `VPS_HOST` — IP/hostname da VPS
- `VPS_USER` — usuário SSH dono de `/var/www/chat-cdt`
- `VPS_SSH_KEY` — chave privada ed25519

A partir daí, todo `git push origin main` dispara o workflow que roda `bin/deploy.sh` remotamente.

### Migrations SQL — fluxo separado

`bin/deploy.sh` detecta arquivos novos em `infra/supabase/migrations/` e **alerta**, mas **não aplica**. Migration de produção exige:
1. Revisar SQL
2. Aplicar via Supabase Studio ou MCP `apply_migration` no projeto `ubwcxktaruxqacxltovq`
3. Só então merge no `main` e deploy

### Rollback

`bin/deploy.sh` faz rollback automático se o health check pós-deploy falhar. Manual:
```bash
cd /var/www/chat-cdt
git log --oneline -10
git reset --hard <sha-bom>
FORCE=1 ./bin/deploy.sh
```

Migration ruim aplicada → escrever migration corretiva (não reverter por reset).
