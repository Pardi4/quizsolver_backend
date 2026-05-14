# QuizSolver VPS deploy - Ubuntu 24.04

Cel: publiczna strona i API dzialaja przez `https://getquizsolver.com`, baza MongoDB stoi lokalnie na VPS, a panel admina jest ukryty na `127.0.0.1:40583` i otwierasz go tylko przez tunel SSH.

## 1. DNS

W Cloudflare ustaw:

- `A` `getquizsolver.com` -> `212.227.31.17`
- `A` `www` -> `212.227.31.17`
- Proxy Cloudflare moze byc wlaczone.

## 2. Pakiety na serwerze

```bash
apt update
apt install -y nodejs npm nginx git curl ufw docker.io docker-compose-plugin
npm install -g pm2
systemctl enable --now docker
systemctl enable --now nginx
```

## 3. Firewall

Publicznie otwierasz tylko SSH, HTTP i HTTPS. Port backendu `30583`, admina `40583` i MongoDB `27017` zostaja prywatne, bo sluchaja na `127.0.0.1`.

```bash
ufw allow OpenSSH
ufw allow "Nginx Full"
ufw enable
ufw status
```

## 4. Wgranie backendu

Na serwerze:

```bash
mkdir -p /var/www/quizsolver
cd /var/www/quizsolver
git clone YOUR_BACKEND_REPOSITORY_URL .
npm ci --omit=dev
```

Jesli nie uzywasz gita, wrzuc folder `backend` przez SFTP do `/var/www/quizsolver`, potem wejdz do `/var/www/quizsolver` i uruchom `npm ci --omit=dev`.

## 5. MongoDB na tym VPS

Najprosciej uruchomic MongoDB lokalnie w Dockerze:

```bash
cd /var/www/quizsolver
cp deploy/docker-compose.mongo.example.yml deploy/docker-compose.mongo.yml
nano deploy/docker-compose.mongo.yml
docker compose -f deploy/docker-compose.mongo.yml up -d
```

W pliku zmien `CHANGE_ME_MONGO_PASSWORD` na mocne haslo.

## 6. Plik .env backendu

```bash
cd /var/www/quizsolver
cp .env.vps.example .env
nano .env
```

Najwazniejsze pola:

- `MONGODB_URI` - wpisz to samo haslo MongoDB co w `deploy/docker-compose.mongo.yml`.
- `PUBLIC_SITE_URL` - zostaw `https://getquizsolver.com`, bo z tego generuja sie canonicale, sitemap i hreflangi.
- `JWT_SECRET` - wygeneruj dlugi losowy sekret.
- `OPENAI_API_KEY` - klucz do AI.
- `EXTENSION_ID` - ID rozszerzenia Chrome.
- `ADMIN_EMAIL` i `ADMIN_PASSWORD` - dane admina.
- `WHOP_*` - wypelnij, jesli platnosci maja dzialac od razu.

Sekret JWT mozesz wygenerowac tak:

```bash
openssl rand -hex 32
```

## 7. Start backendu

```bash
cd /var/www/quizsolver
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Po `pm2 startup` serwer pokaze jedna komende. Skopiuj ja i uruchom.

Sprawdzenie:

```bash
curl http://127.0.0.1:30583/api/health
curl http://127.0.0.1:40583/admin
```

## 8. Nginx dla domeny

```bash
cp /var/www/quizsolver/deploy/nginx/quizsolver.conf /etc/nginx/sites-available/quizsolver
ln -s /etc/nginx/sites-available/quizsolver /etc/nginx/sites-enabled/quizsolver
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

Panel admina nie jest dodany do Nginx. To celowe.

## 9. SSL z Cloudflare albo certbot

Jesli Cloudflare proxy jest wlaczone, w panelu Cloudflare ustaw SSL/TLS na `Full` albo `Full (strict)`.

Alternatywnie na VPS:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d getquizsolver.com -d www.getquizsolver.com
```

## 10. Wejscie do admina

Na swoim komputerze otwierasz tunel:

```bash
ssh -L 40583:127.0.0.1:40583 root@212.227.31.17
```

Potem w przegladarce:

```text
http://127.0.0.1:40583/admin
```

Bez tunelu admin nie powinien byc dostepny z internetu.

## 11. Kopie zapasowe bazy

Na serwerze:

```bash
mkdir -p /var/backups/quizsolver-mongo
chmod +x /var/www/quizsolver/deploy/backup-mongo.sh
MONGO_URI='mongodb://quizsolver_admin:TWOJE_HASLO@127.0.0.1:27017/quizsolver?authSource=admin' /var/www/quizsolver/deploy/backup-mongo.sh
```

Cron codziennie o 03:20:

```bash
crontab -e
```

Dodaj:

```cron
20 3 * * * MONGO_URI='mongodb://quizsolver_admin:TWOJE_HASLO@127.0.0.1:27017/quizsolver?authSource=admin' /var/www/quizsolver/deploy/backup-mongo.sh
```

## 12. Update aplikacji

```bash
cd /var/www/quizsolver
git pull
npm ci --omit=dev
pm2 restart quizsolver
```

## 13. Szybka diagnoza

```bash
pm2 status
pm2 logs quizsolver
systemctl status nginx
docker ps
curl http://127.0.0.1:30583/api/health
```
