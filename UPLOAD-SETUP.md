# Activar las subidas del cliente

El panel está en `admin.html`. El sitio sigue siendo estático y puede alojarse en GitHub Pages; Supabase guarda los trabajos y controla quién puede publicarlos.

1. Crear un proyecto de Supabase dedicado a este sitio.
2. Ejecutar `supabase-setup.sql` una vez en el SQL Editor. Crea las tablas, el bucket público `portfolio` y los permisos. Solo los administradores autorizados pueden subir y publicar; las imágenes y videos publicados son públicos.
3. En Authentication > Users, crear el usuario del cliente con email y contraseña. Desactivar el registro público si no se necesita. Copiar su UUID y ejecutar:

```sql
insert into public.portfolio_admins (user_id) values ('UUID-DEL-CLIENTE');
```

4. Copiar la URL del proyecto y su clave **publishable** (o la clave heredada **anon**) en `backend-config.js`. Estas son configuraciones públicas del navegador. Nunca usar una clave `service_role` ni una clave secreta.
5. Publicar los archivos del sitio en GitHub Pages y compartir el enlace a `admin.html` con el cliente. Entregar su contraseña por un medio privado.

El cliente entra, elige uno de los cuatro canales, escribe un título, selecciona el archivo y presiona **Subir y publicar**. La galería consulta los trabajos publicados sin necesitar nuevos commits ni despliegues.

Se admiten JPG, PNG, WebP, GIF, MP4 y WebM, hasta 50 MB por archivo. Los videos se reproducen con controles y sin autoplay. La subida usa TUS, muestra progreso y reintenta problemas transitorios de conexión. La publicación ocurre después de terminar la transferencia. Si guardar la ficha falla, se intenta retirar el archivo que quedó sin publicar.

Antes de entregar, verificar contra el proyecto real: acceso del cliente autorizado, rechazo de un usuario sin permiso, subida de una imagen y un video, aparición en el canal correcto desde otro navegador, rechazo de archivos mayores al límite y cierre de sesión. La configuración vacía mantiene el panel deshabilitado y la galería usa `works.json` como contenido local.

Dependencias locales: Supabase JS 2.117.3 y tus-js-client 4.3.1; ver sus licencias en `vendor/`.

Documentación oficial: [acceso a Storage](https://supabase.com/docs/guides/storage/security/access-control), [subidas TUS](https://supabase.com/docs/guides/storage/uploads/resumable-uploads) y [login con contraseña](https://supabase.com/docs/reference/javascript/auth-signinwithpassword).
