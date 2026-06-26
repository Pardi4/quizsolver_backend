# QuizSolver VPS deploy - Ubuntu 24.04

Cel: publiczna strona, API i panel admina dzialaja przez `https://getquizsolver.com`, baza MongoDB stoi lokalnie na VPS, a panel admina jest ukryty pod niestandardowym slugiem.

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

## 4. Wgranie kodu i budowanie Frontendu

Aplikacja składa się z dwóch osobnych repozytoriów na GitHubie, które muszą leżeć obok siebie w katalogu `/var/www/quizsolver`.

```bash
mkdir -p /var/www/quizsolver
cd /var/www/quizsolver

# 1. Pobranie i instalacja backendu
git clone https://github.com/Pardi4/quizsolver_backend.git backend
cd backend
npm ci --omit=dev

# 2. Pobranie, instalacja i zbudowanie frontendu (Angular)
cd /var/www/quizsolver
git clone https://github.com/Pardi4/frontend.git frontend
cd frontend
npm install
npm run build
```

Jeśli nie używasz Gita, wrzuć foldery `frontend` i `backend` przez SFTP obok siebie do `/var/www/quizsolver`, a następnie wykonaj w nich odpowiednio `npm ci` i `npm install && npm run build`.

## 5. MongoDB na tym VPS

Najprosciej uruchomic MongoDB lokalnie w Dockerze:

```bash
cd /var/www/quizsolver/backend
cp deploy/docker-compose.mongo.example.yml deploy/docker-compose.mongo.yml
nano deploy/docker-compose.mongo.yml
docker compose -f deploy/docker-compose.mongo.yml up -d
```

W pliku zmien `CHANGE_ME_MONGO_PASSWORD` na mocne haslo.

## 6. Plik .env backendu

```bash
cd /var/www/quizsolver/backend
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
- `LEMONSQUEEZY_*` - wypelnij, jesli platnosci za kredyty maja dzialac od razu.

Sekret JWT mozesz wygenerowac tak:

```bash
openssl rand -hex 32
```

## 7. Start backendu

```bash
cd /var/www/quizsolver/backend
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Po `pm2 startup` serwer pokaze jedna komende. Skopiuj ja i uruchom.

Sprawdzenie:

```bash
curl http://127.0.0.1:30583/api/health
curl -I http://127.0.0.1:30583/qs-console-851-c4f9
```

## 8. Nginx dla domeny

```bash
cp /var/www/quizsolver/backend/deploy/nginx/quizsolver.conf /etc/nginx/sites-available/quizsolver
ln -s /etc/nginx/sites-available/quizsolver /etc/nginx/sites-enabled/quizsolver
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

Panel admina jest serwowany przez ten sam backend i Nginx co strona publiczna, ale pod ukryta sciezka.

## 9. SSL z Cloudflare albo certbot

Jesli Cloudflare proxy jest wlaczone, w panelu Cloudflare ustaw SSL/TLS na `Full` albo `Full (strict)`.

Alternatywnie na VPS:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d getquizsolver.com -d www.getquizsolver.com
```

## 10. Wejscie do admina

W przegladarce:

```text
https://getquizsolver.com/qs-console-851-c4f9
```

Dostep wymaga konta z rola `admin`.

## 11. Kopie zapasowe bazy

Na serwerze:

```bash
mkdir -p /var/backups/quizsolver-mongo
chmod +x /var/www/quizsolver/backend/deploy/backup-mongo.sh
MONGO_URI='mongodb://quizsolver_admin:TWOJE_HASLO@127.0.0.1:27017/quizsolver?authSource=admin' /var/www/quizsolver/backend/deploy/backup-mongo.sh
```

Cron codziennie o 03:20:

```bash
crontab -e
```

Dodaj:

```cron
20 3 * * * MONGO_URI='mongodb://quizsolver_admin:TWOJE_HASLO@127.0.0.1:27017/quizsolver?authSource=admin' /var/www/quizsolver/backend/deploy/backup-mongo.sh
```

## 12. Update aplikacji

PM2 jest skonfigurowany tak, aby przy starcie lub `pm2 restart quizsolver` wykonać automatyczny deploy:

1. `git fetch` i aktualizacja backendu z GitHuba,
2. `npm ci --omit=dev` w backendzie,
3. `git fetch` i aktualizacja frontendu z GitHuba,
4. `npm ci` w frontendzie,
5. `npm run build` w frontendzie,
6. uruchomienie `server.js`.

Domyślnie używana jest strategia:

```env
PM2_GIT_STRATEGY=hard
```

To oznacza, że tracked files zmienione lokalnie na VPS zostaną nadpisane wersją z GitHuba. Plik `.env` jest ignorowany przez Git i zostaje na serwerze. Jeżeli chcesz bezpieczniejszy tryb bez nadpisywania lokalnych zmian, ustaw:

```env
PM2_GIT_STRATEGY=ff-only
```

Możesz też tymczasowo wyłączyć auto deploy:

```env
PM2_AUTO_UPDATE=false
```

Standardowy update od teraz:

```bash
cd /var/www/quizsolver/backend
pm2 restart quizsolver
pm2 logs quizsolver
```

Ręczna wersja awaryjna:

```bash
# 1. Update backendu
cd /var/www/quizsolver/backend
git pull
npm ci --omit=dev

# 2. Update frontendu
cd /var/www/quizsolver/frontend
git pull
npm install
npm run build

# 3. Restart PM2
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

## 14. Release checklist SEO

Przed publicznym wydaniem sprawdz:

```bash
curl -I https://getquizsolver.com/
curl https://getquizsolver.com/sitemap.xml
curl https://getquizsolver.com/robots.txt
curl -I https://getquizsolver.com/privacy
curl -I https://getquizsolver.com/pl/privacy
curl -I https://getquizsolver.com/quiz
curl -I https://getquizsolver.com/404
```

W Google Search Console:

- dodaj wlasnosc domeny `getquizsolver.com`,
- wyslij `https://getquizsolver.com/sitemap.xml`,
- uzyj URL Inspection dla `/`, `/quiz-solver-ai`, `/testportal-quiz-solver`, `/privacy`,
- po wdrozeniu odpal PageSpeed Insights dla `https://getquizsolver.com/` i porownaj wynik z raportem.

Strona glowna jest wersja angielska i `x-default`; polska wersja jest pod `/pl/`.
