# Sistema de Reconocimiento de Placas para Estacionamiento

Sistema para un estacionamiento **sin barrera** que reconoce placas con cámaras
estándar, decide automáticamente si una lectura es una entrada nueva, una
salida, o el mismo vehículo maniobrando (reingreso dentro de un período
configurable), guarda una foto con fecha/hora impresas de cada evento, emite
tickets de entrada, genera reportes diarios en Excel y permite auditar lo
cobrado en caja contra lo que el sistema detectó.

Esta primera entrega es un **sistema completo y funcional** (backend, base de
datos, reglas de negocio, consola web) probado con cámaras/impresora
simuladas. La arquitectura está lista para conectar cámaras y una impresora
térmica reales sin rediseñar nada — ver [Conectar hardware real](#conectar-hardware-real).

## Índice

- [Cómo funciona la regla de reingreso](#cómo-funciona-la-regla-de-reingreso)
- [Arquitectura](#arquitectura)
- [Poner en marcha (desarrollo)](#poner-en-marcha-desarrollo)
- [Uso de la consola](#uso-de-la-consola)
- [Probar el reconocimiento con un video](#probar-el-reconocimiento-con-un-video)
- [Conectar hardware real](#conectar-hardware-real)
- [Auditoría de tickets](#auditoría-de-tickets)
- [Variables de entorno](#variables-de-entorno)
- [Pruebas](#pruebas)
- [Roadmap sugerido](#roadmap-sugerido)

## Cómo funciona la regla de reingreso

Este es el corazón del sistema (implementado en
`backend/app/services/visit_service.py`, con pruebas en
`backend/tests/test_visit_service.py`):

1. **Cámara de entrada lee una placa.**
   - Si el vehículo no tiene ninguna estadía abierta ni una salida reciente:
     se crea una **visita nueva**, se asigna un número de ticket y —si la
     impresora está habilitada— se imprime.
   - Si el vehículo **salió hace menos de N minutos** (configurable en
     Configuración → Regla de reingreso, por defecto 10): se reabre la misma
     visita. **No se genera ticket nuevo.** La visita conserva la hora de la
     *primera* entrada y, si vuelve a salir, se actualiza con la hora de la
     *última* salida.
   - Si el vehículo ya está marcado como "dentro" (dos lecturas de entrada sin
     salida entre medio): se registra como anomalía, sin crear una visita
     duplicada ni un ticket nuevo.
2. **Cámara de salida lee una placa.**
   - Si hay una visita abierta para esa placa: se marca la hora de salida
     (la visita queda "tentativamente afuera" hasta que se sepa si regresa
     dentro del período configurado).
   - Si no hay ninguna visita abierta: se registra como anomalía (salida sin
     entrada previa), útil para detectar plizas/errores en la auditoría.

Cada lectura, sin importar el resultado, se guarda en `detection_events` con
su foto (fecha/hora/placa/cámara impresas sobre la imagen) para trazabilidad
completa.

## Arquitectura

```
Prego/
├── backend/                  FastAPI + SQLAlchemy + SQLite
│   ├── app/
│   │   ├── models.py         Camera, Visit, DetectionEvent, TicketCharge, Setting, User
│   │   ├── services/
│   │   │   ├── visit_service.py     Regla de negocio de entrada/salida/reingreso
│   │   │   ├── ticket_service.py    Numeración e impresión de tickets
│   │   │   ├── report_service.py    Reportes Excel (openpyxl)
│   │   │   ├── audit_service.py     Conciliación visitas vs. cobros
│   │   │   ├── photo_service.py     Marca de fecha/hora sobre la foto
│   │   │   ├── alpr/                Motor de reconocimiento de placas (intercambiable)
│   │   │   └── printer/             Impresora de tickets (intercambiable)
│   │   └── routers/          Endpoints REST (/api/...)
│   ├── scripts/camera_worker.py     Referencia para conectar una cámara real
│   ├── seed.py                Datos de demostración
│   └── tests/                 pytest (lógica de negocio, reportes, auditoría)
└── frontend/                  Consola web (React + Vite + TypeScript)
    └── src/pages/             Panel, Registros, Simulador, Cámaras, Reportes, Auditoría, Configuración
```

**Por qué esta arquitectura:** el reconocimiento de placas y la impresión son
los dos puntos que van a cambiar según el hardware que compren (marca de
cámara, modelo de impresora). Por eso ambos están detrás de una interfaz
(`ALPREngine`, `TicketPrinter`) con una implementación "simulada" activa hoy y
una implementación real ya escrita pero inactiva hasta instalar el hardware —
así el resto del sistema (reglas de negocio, reportes, consola, auditoría) no
depende de tener cámaras físicas conectadas para funcionar y probarse.

## Poner en marcha (desarrollo)

Requisitos: Python 3.11+, Node 20+.

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python seed.py          # opcional: crea cámaras/visitas/cobros de ejemplo
uvicorn app.main:app --reload --port 8000
```

Al arrancar por primera vez se crean automáticamente:
- Usuario administrador `admin` / `admin123` (defínelo con la variable de
  entorno `PARKING_ADMIN_PASSWORD` **antes** del primer arranque en
  producción).
- Dos cámaras de ejemplo: "Entrada Principal" y "Salida Principal".
- Configuración por defecto (umbral de reingreso: 10 minutos).

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # ajusta VITE_API_BASE_URL si el backend no está en localhost:8000
npm run dev
```

Abre `http://localhost:5173` e inicia sesión con `admin` / `admin123`.

## Uso de la consola

- **Panel**: vehículos dentro ahora mismo, entradas/salidas/tickets/reingresos/anomalías de hoy.
- **Registros**: historial de visitas con filtros por placa/estado/fecha; cada
  fila abre el detalle con la línea de tiempo de detecciones y sus fotos.
- **Simulador de cámara**: como todavía no hay cámaras conectadas, esta
  pantalla deja enviar una lectura de placa (con foto opcional) tal como lo
  haría una cámara real, para probar las reglas y generar actividad de
  demostración.
- **Cámaras**: alta/baja de cámaras y su rol (Entrada/Salida), con el campo
  de URL de transmisión (RTSP) ya listo para cuando se conecten físicamente.
- **Reportes**: descarga en Excel por día o por rango de fechas (una fila por
  vehículo/estadía, ya con la regla de reingreso aplicada).
- **Tickets y auditoría**: registrar lo cobrado en caja y comparar contra las
  entradas/salidas del sistema — muestra qué entró y no se cobró, y qué se
  cobró sin una entrada correspondiente.
- **Configuración**: nombre del estacionamiento, minutos del umbral de
  reingreso, y datos de la impresora térmica.

## Probar el reconocimiento con un video

Dentro de **Simulador de cámara** hay una sección "Analizar video": subís un
video corto (por ejemplo grabado con el celular apuntando a un auto) y el
sistema extrae varios fotogramas e intenta leer la placa automáticamente,
usando OpenCV (para ubicar la zona con forma de placa) + Tesseract OCR de
código abierto — implementado en
`backend/app/services/alpr/tesseract_engine.py` y
`backend/app/services/video_service.py`.

Es importante entender qué es y qué no es esta función:

- **Es** una forma de probar la idea de "lectura automática" con tus propios
  videos antes de invertir en una cámara ALPR, sin necesitar hardware.
- **No es** tan precisa como una cámara ALPR entrenada específicamente para
  placas (como OpenALPR, ver más abajo): un OCR genérico acierta bien con
  buena luz, ángulo de frente y buena resolución, y falla más con reflejos,
  ángulos pronunciados o poca nitidez.
- Por eso la consola siempre te muestra varios fotogramas con sus lecturas
  candidatas (y su nivel de confianza) para que elijas y confirmes vos cuál
  usar — nunca se manda una placa directamente sin que la veas.

Requiere el binario `tesseract-ocr` instalado en el servidor (no alcanza con
el paquete de Python `pytesseract`):

```bash
apt-get install tesseract-ocr tesseract-ocr-spa   # español; agregá el paquete de tu idioma
```

Si no está instalado, la consola muestra un aviso claro en vez de fallar.

## Conectar hardware real

### Cámaras (reconocimiento de placas)

El sistema no depende de una marca de cámara: cualquier cámara IP estándar
que exponga un stream RTSP (o una cámara USB) sirve, porque el reconocimiento
ocurre en software (OpenALPR u otro motor) sobre los frames del video, no en
la cámara misma.

1. Instala OpenALPR (o el motor ALPR que prefieran) en la máquina que tendrá
   acceso de red a las cámaras.
2. `pip install -r backend/requirements-hardware.txt` (agrega OpenCV; ver
   comentario sobre `openalpr` en ese archivo).
3. Define `PARKING_ALPR_ENGINE=openalpr` y las variables de configuración de
   OpenALPR — ver `backend/app/services/alpr/openalpr_engine.py`.
4. Ejecuta `backend/scripts/camera_worker.py` (un proceso por cámara, o
   adaptarlo para varias) apuntando al stream RTSP y al backend. Este script
   es una referencia funcional, no un servicio de producción terminado:
   agrégale reconexión automática y ejecútalo bajo un supervisor de procesos.

Mientras tanto, la pantalla **Simulador de cámara** de la consola cumple ese
rol para pruebas y demostraciones.

### Lector (RFID/tarjetas), para más adelante

El modelo de datos no asume que la única fuente de "quién entra" sea la
cámara: `DetectionEvent` guarda cualquier lectura de placa con su cámara y
resultado. Agregar un lector de proximidad más adelante implica un nuevo tipo
de evento de entrada que reutiliza exactamente la misma lógica de
`visit_service` (mismo umbral de reingreso, mismo ticket, mismo reporte).

### Impresora de tickets (ESC/POS)

1. `pip install -r backend/requirements-hardware.txt` (agrega
   `python-escpos` y `pyusb`).
2. En Configuración → Impresora de tickets: habilítala, elige "Red" (IP:puerto,
   normalmente `9100`) o "USB" (`vendor_id:product_id` en hex), y guarda.
3. Prueba con el Simulador de cámara: cada "entrada nueva" dispara la
   impresión real. Si algo falla en la impresora, el sistema no se detiene —
   cae de vuelta al modo simulado y lo deja registrado en los logs del
   backend (`app.services.printer`), para que nunca se bloquee el flujo de
   vehículos entrando.

### Reductor de velocidad

Es una medida física recomendada dado que el estacionamiento no tiene
barrera; no requiere integración con el sistema.

## Auditoría de tickets

El estacionamiento hoy llena tickets a mano; esta consola no reemplaza esa
operación de un día para otro, sino que permite **cruzarla contra lo que el
sistema detectó**. En "Tickets y auditoría":

- El personal registra cada cobro (placa, monto, N° de ticket de papel si
  aplica).
- El sistema empareja automáticamente cada cobro con la visita de esa placa
  cuya salida ocurrió cerca en el tiempo (ventana de tolerancia de ~20
  minutos, pensada para el tiempo entre que el vehículo sale y se paga en
  caja).
- El reporte de auditoría del día muestra:
  - **Entradas sin cobro registrado** → posible fuga de ingresos o ticket que
    falta capturar.
  - **Cobros sin una entrada correspondiente** → posible error de captura
    (placa mal tecleada, ticket de otro día, etc.).

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `PARKING_DATABASE_URL` | sqlite en `backend/data/parking.db` | Cadena de conexión (cambiar a Postgres en producción si crece el volumen) |
| `PARKING_SECRET_KEY` | `dev-secret-change-me` | Firma de tokens JWT — **cambiar en producción** |
| `PARKING_ADMIN_PASSWORD` | `admin123` | Contraseña del usuario admin creado en el primer arranque |
| `PARKING_PHOTO_STORAGE_DIR` | `backend/storage/photos` | Carpeta donde se guardan las fotos con marca de fecha/hora |
| `PARKING_ALPR_ENGINE` | `mock` | `mock` (por defecto) u `openalpr` |
| `VITE_API_BASE_URL` (frontend) | `http://localhost:8000` | URL del backend |

## Pruebas

```bash
cd backend
source venv/bin/activate
python -m pytest -q
```

Cubren específicamente la lógica que más importa: reingreso dentro/fuera del
umbral configurable, anomalías, generación de reportes Excel y conciliación
de auditoría.

## Roadmap sugerido

- Conectar cámaras reales (ver arriba) y correr el `camera_worker.py` en
  producción con supervisión de procesos.
- Conectar la impresora térmica física.
- Migrar de SQLite a Postgres si el volumen de vehículos/día lo justifica.
- Lector de proximidad/RFID como método de entrada adicional (el modelo de
  datos ya lo soporta, ver arriba).
- Notificaciones (ej. cuando una anomalía se registra) por correo o Slack.
