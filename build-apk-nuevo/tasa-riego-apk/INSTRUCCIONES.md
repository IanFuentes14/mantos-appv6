# Actualización APK v1.2 - Compartir CSV por WhatsApp

## ¿Qué cambió?
- Botón "Compartir CSV": abre el menú nativo de Android para compartir
- Botón "WhatsApp": comparte directo a WhatsApp
- El archivo CSV se puede abrir en Excel desde cualquier dispositivo

---

## Pasos para actualizar (en CMD desde la carpeta del proyecto)

cd C:\Users\valff\OneDrive\Escritorio\tasa-riego-apk\tasa-riego-apk

### 1. Instalar nuevas dependencias
npm install

### 2. Sincronizar con Android
npx cap sync android

### 3. Abrir Android Studio
npx cap open android

---

## En Android Studio: compilar el APK

Build → Build Bundle(s) / APK(s) → Build APK(s)

El APK queda en:
android/app/build/outputs/apk/debug/app-debug.apk

---

## Instalar en el celular

1. Desinstala la versión anterior
2. Copia el nuevo app-debug.apk al celular
3. Instala y listo

Al tocar "WhatsApp" en Historial, se abrirá WhatsApp
con el archivo CSV adjunto listo para enviar.
