# Supabase Free + Vercel

El panel es `/admin.html`. Supabase guarda la cuenta del único cliente, los textos y las imágenes. Los videos se suben a YouTube como **No listado**, con reproducción insertada habilitada, y se publica su enlace desde el panel. Un enlace no listado puede compartirse; no es un video privado.

## Activar el proyecto

1. Crear un proyecto Supabase Free. Ejecutar **supabase-free.sql** en SQL Editor. Sirve para una instalación nueva o para migrar las tablas anteriores sin borrar trabajos; puede ejecutarse nuevamente. No ejecutar también `supabase-setup.sql`, que corresponde al esquema anterior.
2. En Authentication > Users, crear el cliente con un email real, una contraseña de al menos 12 caracteres y el email confirmado. Copiar su UUID y ejecutar:

```sql
insert into public.portfolio_admins(user_id)
values ('UUID-DEL-CLIENTE') on conflict(user_id) do nothing;
```

Para la cuenta inicial, crearla con **Auto Confirm User** activado y ejecutar **supabase-owner.sql** usando el email elegido. Este script busca el UUID por email y la autoriza; no pide copiar contraseñas ni UUID. No reemplaza a otro propietario autorizado. La copia local ya tiene el email acordado; la versión del repositorio utiliza un email de ejemplo que debe reemplazarse.

3. En Authentication, desactivar **Allow new users to sign up**. Configurar la longitud mínima de contraseña en 12. En URL Configuration, usar `https://rlynn.vercel.app` como Site URL y agregar `https://rlynn.vercel.app/admin.html` a Redirect URLs. Agregar únicamente dominios y previews que realmente se utilicen.
4. Copiar Project URL y la clave **publishable** (o anon heredada) a `backend-config.js`, en `url` y `publishableKey`. Son datos públicos del navegador; nunca usar `service_role` ni claves secretas en este archivo.
5. Desplegar estos archivos en el proyecto existente de Vercel. El sitio es estático; no necesita ejecutar Python en Vercel. Mantener el preset Other, sin build, y la raíz del proyecto como directorio de salida. `vercel.json` agrega los encabezados de seguridad y evita cachear la configuración de conexión.
6. Abrir `/admin.html`, iniciar sesión y publicar una imagen y un enlace de YouTube. Desde un navegador sin sesión, comprobar que aparecen en el canal elegido con su texto y que desaparecen los placeholders. Guardar otro trabajo como borrador y confirmar que solo lo ve el cliente.

## Cuenta y privacidad

Para empezar con tu correo y luego entregar el acceso al cliente, crear cada cuenta desde Authentication > Users. Autorizar inicialmente tu UUID con el SQL anterior. Cuando el cliente tenga su cuenta, reemplazar el propietario sin borrar los trabajos:

```sql
update public.portfolio_admins
set user_id = 'UUID-DEL-CLIENTE'
where user_id = 'UUID-DE-TU-CUENTA';
```

Debe actualizar exactamente una fila. Tu cuenta deja de tener permisos de administración y el cliente conserva todos los trabajos existentes.

El cliente puede editar título y texto, publicar u ocultar trabajos, eliminarlos, cambiar su contraseña y cerrar otras sesiones. Sin «Recordarme», la sesión se guarda en la pestaña; con esa opción, persiste en el dispositivo. El cierre de otras sesiones invalida su renovación; los tokens ya emitidos pueden seguir siendo válidos hasta su vencimiento.

Las imágenes están en un bucket privado. Las políticas permiten acceso público únicamente a archivos de trabajos publicados. La galería solicita URLs temporales que duran una hora; un enlace ya emitido puede funcionar hasta que expire aunque el trabajo pase a borrador. Los textos se muestran como texto, sin ejecutar HTML.

La recuperación por email está deshabilitada inicialmente (`passwordRecoveryEnabled: false`). El SMTP predeterminado de Supabase restringe los destinatarios; para el email real del cliente, configurar SMTP propio y entonces activar la opción. Mientras tanto, el administrador puede restablecer la contraseña desde Supabase. Esto no impide el login normal.

## Límites y trabajos existentes

GitHub Actions ejecuta `Supabase health` tres veces al día. Consulta como visitante un máximo de un ID publicado, sin escribir datos. Configurar las variables del repositorio `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` con los mismos valores públicos del frontend. Puede ejecutarse manualmente desde Actions. Ayuda a mantener actividad de base y detectar errores, pero Supabase Free puede pausar proyectos con poca actividad; no garantiza disponibilidad. Si llega una advertencia de Supabase, revisar el proyecto en el dashboard. En repositorios públicos, GitHub puede deshabilitar los schedules después de 60 días sin actividad del repositorio; comprobarlos y reactivarlos si ocurre.

Supabase Free incluye 1 GB de Storage y admite hasta 50 MB por archivo. El panel acepta JPG, PNG, WebP y GIF; los videos nuevos no ocupan ese espacio porque usan YouTube. No se habilita ningún plan pago. Controlar también las cuotas de transferencia y las condiciones vigentes del plan en el dashboard.

El servidor local continúa disponible en `/cliente`, con su cuenta y archivos originales. Las cuentas y archivos locales no se migran solos. Para publicar sus videos en Vercel, subirlos a YouTube y crear sus fichas en el panel. Para las imágenes, volver a subirlas desde el panel cloud. La migración SQL conserva trabajos que ya existían en Supabase, incluidos videos anteriores.

## Verificación de desarrollo

```powershell
node --test tests-client/test_youtube.js
node tests-client/test_cloud_sql.cjs
.\.venv\Scripts\python.exe -m unittest discover -s tests-client -p test_portal.py
.\.venv\Scripts\python.exe tests-client/browser_smoke.py
.\.venv\Scripts\python.exe tests-client/browser_cloud.py
```

La prueba SQL utiliza PostgreSQL local mediante PGlite; instalarlo según el encabezado del archivo de prueba o indicar `PGLITE_MODULE`. La prueba cloud utiliza el SDK real con respuestas de Supabase simuladas; la validación de conexión, cuenta y cuotas requiere el proyecto remoto real.

Documentación: [límites de archivos](https://supabase.com/docs/guides/storage/uploads/file-limits), [planes](https://supabase.com/pricing), [claves públicas](https://supabase.com/docs/guides/getting-started/api-keys), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [cierre de sesiones](https://supabase.com/docs/guides/auth/signout).
