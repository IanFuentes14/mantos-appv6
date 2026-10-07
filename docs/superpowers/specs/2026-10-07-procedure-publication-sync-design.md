# Publicación y sincronización offline de procedimientos

## Objetivo

Permitir que administradores autorizados creen, reemplacen y retiren documentos PDF de procedimientos desde el panel, y que las aplicaciones de terreno sincronicen esas publicaciones para consultar la versión vigente sin conexión.

## Contexto y límites

- La app Mantos Group v6 es React + Vite + Capacitor para Android y usa Supabase Auth, Postgres y Storage.
- El panel ya inicia sesión con usuario y contraseña de Supabase. La función Edge `delete-local-record` determina la autorización administrativa con `ADMIN_EMAILS` y usa `admin@mantos.app` como valor de respaldo.
- Los operarios se autentican en línea con una sesión anónima de Supabase. El acceso offline requiere que el operador ya se haya validado en ese dispositivo.
- Procedimientos ya tiene cuatro categorías estables: `operacionales`, `seguridad`, `equipos` y `administrativos`. Hoy sus documentos vienen de una lista local y abren archivos PDF locales.
- La función pedida distribuye PDF y metadatos del catálogo. No agrega categorías, edición de cuentas, notificaciones push ni trabajo de sincronización con la app cerrada.
- Mientras Mantos está abierta y recupera conexión, o cuando vuelve a primer plano/se inicia, consulta novedades. La plataforma puede suspender una app Android cerrada; la actualización en segundo plano fuera de la app no forma parte de esta entrega.
- La publicación y la descarga usan la sesión del proyecto Supabase existente; una sesión operativa anónima puede leer el catálogo y sus archivos, pero no cambiarlos.

## Solución

Se mantiene un catálogo compartido en Postgres y un bucket privado de Storage. El cliente puede leer procedimientos activos y sus tombstones de retiro bajo RLS. Toda acción de publicación pasa por la función Edge `manage-procedures`, que valida el JWT consultando Auth y compara el correo con la lista `ADMIN_EMAILS` del servidor (mismo valor de respaldo que `delete-local-record`). La clave service-role solo vive en la función Edge.

La función emite un permiso de carga temporal y limitado a un objeto versionado. El administrador transmite el PDF con ese permiso directamente a Storage, y después confirma la publicación en la Edge Function. La versión vigente del catálogo no cambia hasta confirmar la carga del objeto. Esto evita reemplazar la versión publicada si la conexión se corta antes de terminar una carga. Los permisos temporales no autorizan cambios de metadatos ni de objetos ajenos.

### Crear, reemplazar y retirar

1. El panel de procedimientos permite escoger una de las cuatro categorías, ingresar título y descripción y adjuntar un PDF. Los archivos aceptados deben ser PDFs; el servidor y el bucket verifican el límite configurado para subir.
2. Crear o reemplazar conserva como borrador local los metadatos y el PDF en IndexedDB. «Sincronizar» puede iniciarse desde la gestión de procedimientos o desde el menú principal. El indicador de pendientes incluye estos borradores.
3. Al sincronizar, el cliente pide a `manage-procedures` una carga temporal. La función autoriza el administrador y devuelve un identificador y una ruta de objeto que el cliente no puede escoger libremente. El cliente carga el PDF directamente con Supabase Storage y llama a la función para confirmar la versión.
4. La confirmación actualiza de forma idempotente la fila del catálogo: identificador estable, categoría, título, descripción, ruta versionada, número de versión, SHA-256, fecha, correo publicador y estado. Solo una confirmación exitosa elimina el borrador de la cola. Los reintentos no crean versiones duplicadas.
5. El reemplazo conserva la copia anterior publicada hasta completar la carga y la confirmación nuevas. Cada objeto usa una ruta inmutable por procedimiento y versión.
6. Retirar marca una baja lógica en el catálogo en lugar de borrar la fila. Así todos los dispositivos pueden enterarse del retiro y borrar su caché en su próxima sincronización exitosa. Un dispositivo que sigue sin conexión conserva su PDF hasta reconectarse.

### Sincronización de los dispositivos de terreno

- Al iniciar con conexión, recuperar la conexión, volver a primer plano, abrir Procedimientos o pulsar «Sincronizar», consultar el catálogo de activos y bajas.
- Comparar el identificador, versión y hash SHA-256 con el catálogo local. Descargar únicamente PDFs nuevos o modificados.
- Leer desde Storage privada usando la sesión autenticada del operario y guardar en IndexedDB el Blob PDF junto a los metadatos. Verificar el SHA-256 del Blob antes de publicar la nueva copia local.
- Mantener intacta la copia offline anterior hasta que la versión nueva haya terminado de descargarse y verificarse. Después reemplazar la entrada en una operación local; al recibir una baja, eliminar su entrada.
- Mostrar por documento la versión/fecha de actualización y si está disponible localmente. Los estados de la pantalla explican falta de conexión, descarga, actualización y error.
- Al abrir un procedimiento, usar la copia de IndexedDB. Si no existe en el dispositivo y hay conexión, descargarla y almacenarla antes de abrirla; sin conexión, explicitar que ese PDF aún no está disponible en el teléfono.

### Datos y control de acceso

- Tabla `public.procedures`: `id uuid`, categoría restringida a los cuatro slugs, `title`, `description`, `storage_path`, `version`, `sha256`, `is_active`, `updated_at`, `updated_by`, `created_at`.
- La baja es lógica (`is_active=false`) y sus filas siguen disponibles para que la sincronización borre caché. El catálogo solo muestra filas activas a personas.
- Bucket privado `procedure-pdfs`, con rutas versionadas y límite PDF configurado para el proyecto. Lectura autenticada para la sesión anónima operacional y el usuario de administración; ninguna escritura cliente directa.
- RLS restringe el catálogo a usuarios autenticados. La función Edge verifica Admin Emails antes de emitir permisos de carga, confirmar publicaciones, reemplazar y retirar. El endpoint exige JWT de Supabase. La aplicación no incluye claves de service-role.
- Antes de acceder a la pantalla de gestión, la app comprueba autorización con la función protegida. La autenticación válida en Supabase por sí sola no concede permiso para publicar.

### Fallos, reintentos y estado local

- Un archivo local queda en estado pendiente hasta recibir confirmación de la publicación. Si no hay conexión, el borrador permanece en IndexedDB y el recuento muestra los pendientes.
- Si la carga falla, el catálogo publicado no cambia y el borrador permanece para reintento.
- Si la nueva descarga falla, no reemplazar ni descartar la copia offline válida anterior. Registrar el error junto a esa descarga e intentar de nuevo en la siguiente sincronización.
- Si no hay cuota suficiente de IndexedDB o no hay PDF cacheado, informar claramente que el documento necesita conexión y no mostrar un estado de disponibilidad offline falso.
- Los errores 401/403 de autorización no se tratan como errores de red y no autorizan una operación en el cliente.
- La lista de archivos cacheados se comparte entre sesiones del mismo dispositivo. Retirar un documento lo elimina localmente solo después de recibir el cambio desde el servidor.

## Archivos y responsabilidades previstos

- `supabase/migrations/<timestamp>_procedures_catalog.sql`: tabla, bucket privado y políticas RLS para el catálogo y la lectura Storage.
- `supabase/functions/_shared/admin-auth.ts`: validación compartida de correos administrativos, usada por las funciones Edge existentes que necesiten proteger acciones administrativas.
- `supabase/functions/manage-procedures/index.ts`: autorizar, preparar la carga, confirmar versión, retirar; usar únicamente secretos de Supabase Edge.
- `src/lib/proceduresStore.js`: IndexedDB para catálogo local, blobs cacheados y cola de publicaciones, con escritura atómica del estado local.
- `src/lib/procedureSync.js`: comparar manifiestos, descargar/verificar, confirmar/publicar y conservar los errores reintentables.
- `src/components/admin/AdminProcedures.jsx`: formulario de gestión, borradores y estados de publicación dentro del panel existente.
- `src/components/ProceduresScreen.jsx`: categorías actuales, documentos activos, estado de descarga, apertura y mensaje offline.
- `src/App.jsx`: conectar los nuevos módulos a roles, contador de pendientes, sincronización manual y eventos de conectividad/primer plano sin cambiar cálculos ni los flujos de otros módulos.
- `src/design.css`: extender los componentes reutilizando los tokens visuales existentes.
- `README.md`: crear bucket/migración, habilitar Edge Function y su secreto `ADMIN_EMAILS`, y describir la publicación y sincronización de PDFs.

## Criterios de aceptación

1. Un usuario operativo con sesión anónima lee el catálogo y baja procedimientos, pero no puede preparar cargas, confirmar cambios ni retirar filas.
2. Solo una dirección permitida por `ADMIN_EMAILS` puede crear, reemplazar o retirar un PDF, tanto a través de la interfaz como invocando la Edge Function directamente.
3. Una publicación nueva no se ve como vigente hasta que el archivo PDF está en Storage y su metadato confirmado.
4. Una carga o desconexión interrumpida deja un borrador reintentable y no rompe el último documento publicado.
5. Sincronizar un usuario descarga nuevas versiones, verifica el hash y las deja disponibles al apagar la conexión.
6. Tras recibir un tombstone, el dispositivo deja de mostrar y elimina de su caché el PDF retirado; un error de sincronización conserva la vista y los archivos actuales.
7. Los documentos quedan en sus categorías actuales y cualquier medición, cálculo, encuesta u otra sección conserva su operación.

## Entrega y operación

La entrega de producto requiere publicar la migración y desplegar `manage-procedures` en el proyecto Supabase configurado para Mantos, con `ADMIN_EMAILS` y la clave service-role solo como secretos de función. También hay que regenerar Mantos Group v6 para que la app incluya estas pantallas y sincronización. El despliegue del backend y la APK son pasos separados: el código y los pasos de configuración pueden estar listos aunque el proyecto Supabase no se actualice desde este repositorio.

## Referencias oficiales

- Supabase: validar JWT de sesión en Edge Functions y usar el contexto autenticado: https://supabase.com/docs/guides/functions/auth-legacy-jwt
- Supabase: permisos temporales de carga de Storage: https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl
- Supabase: descargas desde Storage privada con autorización: https://supabase.com/docs/guides/storage/serving/downloads
