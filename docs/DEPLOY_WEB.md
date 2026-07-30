# R3 Web Deployment

## User experience

The service administrator starts the container once. Users then open one URL.
They do not run BAT files, Python, or a local port command.

## Docker

```powershell
docker build -t f28034-config-studio:r3 .
docker run --rm -p 8080:8080 -e APP_MODE=web -e PORT=8080 `
  --read-only --tmpfs /tmp f28034-config-studio:r3
```

Open `http://localhost:8080/`.

Health check:

```powershell
Invoke-RestMethod http://localhost:8080/api/health
```

## Compose

```powershell
docker compose up --build
```

## Web-mode boundaries

- The production process is Waitress WSGI, not Flask's development server.
- The service binds `0.0.0.0` and reads `PORT`.
- `/api/shutdown` returns 404.
- Local TI/CCS paths are not returned.
- `instance.json` is not created.
- Staging export is forbidden.
- `/api/export.zip` creates the archive in memory and returns it directly.
- Preview and ZIP export both call `generate_project()`.

## Local developer mode

Run `start_config_studio.bat`. Local mode binds `127.0.0.1`, records the real
PID/port/build in `generator/instance.json`, waits for the matching health
response, and then opens the browser. `stop_config_studio.bat` reads that
registry and verifies that the actual port is released.
