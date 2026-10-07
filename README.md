# Mantos App - Version 4

Aplicacion operacional para registrar tasas de riego, gestionar documentacion de conduccion y consultar un glosario tecnico asociado a lixiviacion por riego.

## Stack

- React + Vite
- Tailwind CSS
- Supabase Database
- Supabase Storage
- Supabase Auth para el panel administrador

## Funcionalidades principales

- Acceso operativo offline desde la pantalla principal.
- Registro de mediciones de tasa de riego con cola local.
- Carga de documentacion de conduccion con imagenes sincronizables.
- Sincronizacion hacia Supabase cuando el dispositivo recupera conexion.
- Panel administrador protegido por login.
- Historial administrativo de tasas de riego.
- Revision de conductores que subieron documentacion cada dia.
- Glosario tecnico con modo de prueba.
- Modulo Izajes con formulas desplegables, explicaciones operacionales y calculo de peso.
- Tablas de carga F660 con visualizacion ampliable.
- Checklist de documentacion previa a maniobra.
- Acceso a encuestas operacionales externas.
- Proyecto Android con icono corporativo adaptativo de Mantos Group.

## Configuracion local

1. Instalar dependencias:

```bash
npm install
```

2. Crear un archivo `.env` usando `.env.example` como base:

```bash
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key
```

3. Ejecutar el proyecto:

```bash
npm run dev
```

## Configuracion de Supabase

1. Ejecutar el archivo `supabase/schema.sql` en el SQL Editor de Supabase.
2. Crear un usuario administrador en Supabase Auth. Ese correo y contrasena seran el acceso unico para la administracion.
3. Mantener privado el bucket `conduction-documents`.

Las politicas RLS incluidas permiten que la app en terreno inserte registros y cargue imagenes, pero solo usuarios autenticados pueden ver el historial de tasas de riego y las imagenes subidas.

## Proyecto Android

El contenedor Android se encuentra en `build-apk-nuevo/tasa-riego-apk`.

```bash
cd build-apk-nuevo/tasa-riego-apk
npm install
npx cap sync android
```

El repositorio conserva el codigo Android y los recursos del icono. Las dependencias, caches, contenido web copiado y archivos APK se excluyen del control de versiones.

## Notas

Los APK, ZIP, `node_modules`, `dist` y carpetas de compilacion Android se excluyen del repositorio porque son artefactos generados.

## Generar APK de prueba (version 6)

La version 6 esta publicada en `IanFuentes14/mantos-appv4`, commit `c53c01f`.
El nombre del repositorio y las versiones declaradas en package.json/Android conservan nombres anteriores.

Desde la raiz, en PowerShell:

```powershell
./scripts/build-apk.ps1
```

El script compila React, reemplaza los recursos web generados, sincroniza Capacitor y ejecuta Gradle.
El APK queda en `output/mantos-group-v6-sin-conflicto.apk` y esta firmado para pruebas.
Se instala como `Mantos Group v6`, con identificador `cl.tasariego.app.v6`, junto a las versiones anteriores.
Los registros locales de la app anterior permanecen en esa app y no se transfieren automaticamente.
Los APK anteriores de este proyecto tienen una firma distinta a la clave disponible en este equipo.
Actualizar su paquete original exige recuperar esa clave; cambiar solo el numero de version no resuelve el conflicto.
El parametro `-OriginalPackage` genera el paquete original para escenarios donde la firma instalada sea compatible.
Requiere las dependencias instaladas en ambas carpetas, Node, Java 17 y Android SDK 34.
Puede indicar las rutas con `-JavaHome <carpeta>` y `-AndroidSdk <carpeta>`.
Tambien detecta Java 17 portatil en `output/tools` y el SDK instalado por Android Studio.
Para distribucion de produccion se necesita configurar una clave de firma release.
