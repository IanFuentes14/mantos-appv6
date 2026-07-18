# Mantos App

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
- Modulo Izajes con formulas, calculo de peso y checklist documental.

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

## Notas

Los APK, ZIP, `node_modules`, `dist` y carpetas de compilacion Android se excluyen del repositorio porque son artefactos generados.
