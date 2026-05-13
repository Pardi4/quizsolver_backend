# Cloudflare Tunnel for getquizsolver.com

Use this when the backend is running on the LAN host `192.168.5.183:30583` and the public domain should be `https://getquizsolver.com`.

## 1. Run the backend

```powershell
cd "H:\Quizonator\Rozszerzenie 2.0\backend"
npm start
```

The server currently listens on `0.0.0.0:30583`.

## 2. Create a named tunnel

```powershell
cloudflared tunnel login
cloudflared tunnel create quizsolver
```

## 3. Configure ingress

Create or update the Cloudflare tunnel config file:

```yaml
tunnel: quizsolver
credentials-file: C:\Users\<your-user>\.cloudflared\<tunnel-id>.json

ingress:
  - hostname: getquizsolver.com
    service: http://192.168.5.183:30583
  - hostname: www.getquizsolver.com
    service: http://192.168.5.183:30583
  - service: http_status:404
```

## 4. Route DNS through Cloudflare

```powershell
cloudflared tunnel route dns quizsolver getquizsolver.com
cloudflared tunnel route dns quizsolver www.getquizsolver.com
```

## 5. Start the tunnel

```powershell
cloudflared tunnel run quizsolver
```

## 6. CORS

Make sure `.env` includes:

```env
ALLOWED_ORIGINS=chrome-extension://your_extension_id_here,https://getquizsolver.com,https://www.getquizsolver.com,http://localhost:30583
```

Restart the backend after changing `.env`.
