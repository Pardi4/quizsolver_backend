# Poradnik: Aktualizacja aplikacji i rozszerzenia na VPS (Wersja z Angular)

Ten dokument opisuje krok po kroku, jak zaktualizować środowisko na Twoim serwerze VPS z wersji bez Angulara (gdzie cały kod prawdopodobnie znajdował się w jednym katalogu głównym) do nowej architektury z podziałem na osobne repozytoria dla **Backendu** i **Frontend-u**.

---

## 1. Zrozumienie struktury katalogów na serwerze

Nowy backend szuka plików skompilowanego frontendu w katalogu sąsiednim (ang. *sibling*):
`path.join(__dirname, '..', 'frontend', 'dist', 'angular-web', 'browser')`

Aby wszystko działało prawidłowo, Twoja docelowa struktura folderów w `/var/www/quizsolver` musi wyglądać następująco:

```text
/var/www/quizsolver/
├── backend/      <-- Repozytorium: https://github.com/Pardi4/quizsolver_backend
│   ├── .env      <-- Twój istniejący plik konfiguracyjny środowiska
│   ├── server.js
│   └── ...
└── frontend/     <-- Repozytorium: https://github.com/Pardi4/frontend
    ├── src/
    ├── dist/     <-- (Zostanie wygenerowane po uruchomieniu 'npm run build')
    └── ...
```

---

## 2. Instrukcja aktualizacji krok po kroku

Połącz się przez SSH ze swoim serwerem VPS i wykonaj poniższe instrukcje.

### Krok 1: Kopia zapasowa konfiguracji (Bardzo ważne!)
Przed usunięciem czegokolwiek, skopiuj swój obecny plik `.env` w bezpieczne miejsce, aby nie stracić haseł bazy danych, kluczy API (OpenAI, Stripe/Whop) i innych sekretów.

```bash
# Wejdź do katalogu aplikacji (zmień ścieżkę, jeśli jest inna na Twoim VPS)
cd /var/www/quizsolver

# Skopiuj plik .env do katalogu domowego użytkownika root jako backup
cp .env ~/quizsolver_old.env
```

### Krok 2: Przygotowanie nowych katalogów
Musimy przenieść stare pliki, aby zrobić miejsce dla nowej struktury podfolderów.

```bash
# Zatrzymaj działającą aplikację w PM2
pm2 stop all

# Przejdź do katalogu nadrzędnego
cd /var/www

# Zmień nazwę starego katalogu, aby mieć pełen backup
mv quizsolver quizsolver_backup

# Stwórz nowy, czysty katalog i wejdź do niego
mkdir quizsolver
cd quizsolver
```

### Krok 3: Sklonowanie i konfiguracja Backendu
Klonujemy oficjalne repozytorium backendu do folderu o nazwie `backend`.

```bash
# Sklonuj repozytorium backendu
git clone https://github.com/Pardi4/quizsolver_backend.git backend

# Wejdź do katalogu backendu
cd backend

# Zainstaluj zależności produkcyjne (bez devDependencies)
npm ci --omit=dev

# Przywróć swój plik konfiguracyjny .env z kopii zapasowej
cp ~/quizsolver_old.env .env
```

### Krok 4: Sklonowanie, budowanie i instalacja Frontendu
Klonujemy repozytorium frontendu do folderu o nazwie `frontend` obok backendu.

```bash
# Wejdź z powrotem do głównego folderu aplikacji
cd /var/www/quizsolver

# Sklonuj repozytorium frontendu
git clone https://github.com/Pardi4/frontend.git frontend

# Wejdź do katalogu frontendu
cd frontend

# Zainstaluj wszystkie zależności (Angular wymaga devDependencies do kompilacji)
npm install

# Skompiluj aplikację Angular do postaci statycznej (Prerender/SSR bundle)
npm run build
```

---

## 3. Ponowne uruchomienie aplikacji (PM2 & Nginx)

Teraz musimy poinstruować PM2, aby uruchamiał aplikację z nowej ścieżki i przeładować Nginx.

### Krok 1: Aktualizacja PM2
```bash
# Usuń stary proces z listy PM2 (zastąp 'quizsolver' nazwą swojego procesu, jeśli była inna)
pm2 delete quizsolver

# Przejdź do folderu backendu
cd /var/www/quizsolver/backend

# Uruchom aplikację na nowo za pomocą pliku konfiguracyjnego ecosystem
pm2 start ecosystem.config.cjs

# Zapisz aktualny stan listy procesów PM2, aby wstawał po restarcie serwera VPS
pm2 save
```

### Krok 2: Weryfikacja Nginx i portów
Backend nasłuchuje domyślnie na porcie `30583`. Jeśli nie zmieniałeś konfiguracji Nginx, wszystko powinno działać od razu, ponieważ Nginx przekazuje ruch bezpośrednio do portu backendu, a sam backend serwuje teraz pliki Angulara z nowej lokalizacji.

Możesz upewnić się, że Nginx działa prawidłowo:
```bash
nginx -t
systemctl reload nginx
```

### Krok 3: Diagnostyka
Wpisz następujące polecenia, aby upewnić się, że system wstał bez błędów:
```bash
# Sprawdź status procesów PM2
pm2 status

# Przejrzyj logi w czasie rzeczywistym
pm2 logs quizsolver

# Sprawdź, czy serwer prawidłowo zwraca status zdrowia i nową wersję
curl http://127.0.0.1:30583/api/health
```
Jeśli polecenie zwróci JSON: `{"status":"ok","version":"2.0.0",...}`, oznacza to, że aplikacja została zaktualizowana i działa poprawnie!
