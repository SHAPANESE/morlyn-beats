# Portal local de Morlyn Beats

El servidor local integra el portfolio existente y un panel para una sola cuenta en `/admin.html` (también `/cliente`). Cuenta, sesiones y archivos se guardan en `D:\OWN\.morlyn-beats-client-data\`, fuera de la raíz pública. Este modo no requiere Supabase.

## Ejecutar

```powershell
cd D:\OWN\morlyn-beats
uv venv .venv
uv pip install --python .venv/Scripts/python.exe -r requirements-client.txt
.\.venv\Scripts\python.exe client_server.py serve
```

Sitio completo: http://localhost:4174/

Panel local: http://localhost:4174/cliente

`/admin.html` abre el panel Supabase cuando hay URL y clave pública configuradas.

La cuenta existente fue trasladada desde el portal anterior. No hay registro público. En una instalación nueva, crear la cuenta con `client_server.py init`; si ya existe, el comando no la reemplaza.

## Archivos y textos

Elegir canal 01 (TV), 02 (redes), 03 (3D) o 04 (motion graphics), subir archivos y agregar un texto opcional de hasta 5000 caracteres. «Mostrar en el portfolio al terminar» está marcado de entrada: «Subir y publicar» deja el trabajo visible en su sección al terminar. Desmarcarlo para guardar un borrador privado. Después de publicar aparece un enlace para abrir la sección. En cargas múltiples, el texto se aplica a todos; se puede editar después por archivo. También se puede publicar o despublicar desde Editar. Los archivos locales de `works.json` siguen disponibles.

Imágenes JPG/PNG/WebP: hasta 200 MB y 24 megapíxeles, convertidas a WebP sin metadatos de origen. Videos MP4/MOV/WebM: hasta 1 GB y 30 minutos, convertidos a MP4 H.264/AAC. Espacio total de 20 GB; `MORLYN_STORAGE_GB` y `MORLYN_VIDEO_MINUTES` permiten ajustar capacidad y duración antes de iniciar. No se conserva el original. La conversión puede tardar varios minutos.

El servidor estático de la otra sesión puede seguir en 4173. `backend.js` conecta esa vista al API público del servidor 4174; su `admin.html` redirige al panel operativo. Se admite acceso desde localhost o 127.0.0.1. En producción usar el servidor completo detrás de HTTPS; no usar localhost:4174 como backend de un sitio remoto.

## Seguridad y recuperación

Contraseñas con scrypt, tokens aleatorios por dispositivo almacenados como hash, cookies HttpOnly/SameSite=Strict y protección CSRF en escrituras. Sesión normal: 12 horas y 2 horas de inactividad; Recordarme: 30 días y 7 días de inactividad. Se puede cambiar contraseña, cerrar otro dispositivo o cerrar todas las otras sesiones. Cambiar o recuperar la contraseña revoca los accesos anteriores.

Para recuperar una contraseña, generar un código de un solo uso desde el servidor y entregarlo por un canal privado:

```powershell
.\.venv\Scripts\python.exe client_server.py recovery
```

El cliente ingresa el código en «Olvidé mi contraseña». Vence en 30 minutos. No hay correo de recuperación automático.

## Supabase y publicación

`backend-config.js` tiene la URL y clave pública del proyecto Supabase. Sus galerías y `/admin.html` usan ese proyecto; falta ejecutar `supabase-free.sql` y habilitar la cuenta del cliente para completar la activación. Es un almacenamiento diferente y las credenciales locales no son cuentas de Supabase. Ver [UPLOAD-SETUP.md](UPLOAD-SETUP.md). Este cambio no publica el sitio en Vercel.

Para desplegar este servidor: configurar HTTPS, disco persistente, proxy con cuerpos de al menos 1025 MB y timeout de 30 minutos. Establecer `MORLYN_HTTPS=1`, `MORLYN_HOSTS=dominio.real` y servir con `--host 0.0.0.0`. Usar una única instancia para este cliente, con CPU/memoria limitadas para conversiones. `MORLYN_DATA_DIR` permite elegir otro directorio privado. Respaldar datos completos con el servidor detenido. No exponer la carpeta de datos ni backups.

API pública: `GET /api/public/media` entrega solo trabajos publicados con `id`, `title`, `description`, `section`, `kind`, `url`, `size` y `created`. `section` coincide con el canal de dos dígitos; `url` entrega el archivo con soporte Range para videos. La previsualización de 4173 consume únicamente esta API pública; el login y las cargas ocurren en 4174.

## Pruebas

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests-client -v
uv pip install --python .venv/Scripts/python.exe -r requirements-client-test.txt
.\.venv\Scripts\python.exe tests-client/browser_smoke.py
```

Los tests usan cuentas y archivos temporales. El test de navegador requiere Edge instalado o Chromium de Playwright (`python -m playwright install chromium`).

Cuando un canal tiene trabajos publicados, estos reemplazan las muestras locales y los placeholders. La galería vuelve a consultar al regresar a la pestaña y recibe avisos del panel en el mismo origen. Las secciones sin trabajos siguen mostrando su estado de muestra.
