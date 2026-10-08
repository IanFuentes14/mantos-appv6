# Activar los procedimientos de Mantos

El código de la app incluye gestión administrativa de PDFs, borradores locales y descarga verificada para consulta offline. La publicación real requiere activar la tabla, el bucket privado y la función del servidor en el mismo proyecto de Supabase configurado en `.env`.

## Activación asistida

1. Crear un token de acceso a la cuenta en https://supabase.com/dashboard/account/tokens, con acceso al proyecto de Mantos.
2. Copiar `.env.deploy.example` a `.env.deploy` y completar `SUPABASE_ACCESS_TOKEN` únicamente en ese archivo privado. Está excluido de Git y nunca se integra en la app.
3. Ejecutar `node scripts/deploy-procedures.mjs`. Configura exclusivamente el catálogo de procedimientos, sus permisos, el bucket `procedure-pdfs` y `manage-procedures`. No modifica cuentas, mediciones ni encuestas.

## Activación manual desde Supabase

1. Abrir SQL Editor del proyecto y ejecutar en orden `supabase/migrations/202610080001_procedures.sql` y `supabase/migrations/202610080002_procedure_pdf_50mb.sql` completos.
2. En Edge Functions, crear `manage-procedures` y pegar el contenido de `supabase/functions/manage-procedures/index.ts`.
3. Desplegar la función. Puede desactivar la verificación JWT del gateway: el propio endpoint valida el token con Auth y exige un usuario no anónimo cuyo correo esté en `ADMIN_EMAILS`.
4. Conservar el secreto `ADMIN_EMAILS` existente, compartido con el borrado administrativo. Si no está configurado, el servidor permite solamente `admin@mantos.app`. Las variables `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` son las variables de servidor proporcionadas por Supabase; nunca agregarlas al frontend.

## Funcionamiento

- PDFs de hasta 50 MB, en cuatro categorías. La confirmación verifica la firma PDF, el tamaño y el SHA-256.
- Guardar pendiente conserva el PDF en IndexedDB. La sincronización publica el archivo y sus metadatos; un fallo conserva el borrador para reintento.
- Reemplazar mantiene la versión anterior hasta confirmar la nueva. Las cargas se identifican de forma idempotente y un reemplazo rechaza una versión de catálogo que haya cambiado.
- Retirar requiere conexión y confirmación. El catálogo conserva la baja para que los dispositivos borren su copia al sincronizar.
- Los usuarios descargan al entrar, recuperar conexión, volver a primer plano y mediante el botón de actualización. Con la app visible, se revisan novedades cada minuto. La app cerrada no descarga en segundo plano.
- Si falla una descarga, la copia offline anterior permanece disponible. Un PDF nuevo fallido aparece como descarga pendiente.
- En Android, el PDF cacheado se entrega al selector del sistema mediante Filesystem y Share. El usuario elige su visor de PDF.

Antes de una entrega instalada, generar la APK únicamente cuando el usuario la solicite. Los cambios de este módulo no actualizan automáticamente GitHub.

Referencia del despliegue: https://supabase.com/changelog/33720-deploy-and-update-edge-functions-using-the-management-api
